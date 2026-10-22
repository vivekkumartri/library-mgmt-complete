import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import api, { apiErrorMessage } from '../services/api';
import { Loading, ErrorState, EmptyState } from '../components/AsyncState';
import SeatDetailDrawer from '../components/SeatDetailDrawer';
import ChairIcon from '../components/icons/ChairIcon';
import { CalendarIcon, SearchIcon, AlertIcon, ClockIcon, BanIcon } from '../components/icons/MiniIcons';
import { formatDate } from '../utils/formatDate';

/** The chair-icon color for each status/urgency class — one place so the
 * legend, every seat card, and the summary strip's icons all agree. */
const STATUS_ICON_COLOR = {
  available: 'var(--color-success)',
  occupied: 'var(--color-info)',
  partial: 'var(--color-warning)',
  disabled: 'var(--color-ink-soft)',
  conflict: 'var(--color-danger)',
  'urgency-due_soon': 'var(--color-warning)',
  'urgency-due_today': 'var(--color-due-today)',
  'urgency-overdue': 'var(--color-danger)',
};

function seatIconColor(colorCls) {
  // colorCls is e.g. "occupied urgency-overdue" — the urgency tier (if any)
  // always wins over the plain structural color, same precedence the fill
  // color itself already uses.
  const classes = colorCls.split(' ');
  const urgencyClass = classes.find((c) => c.startsWith('urgency-'));
  return STATUS_ICON_COLOR[urgencyClass] || STATUS_ICON_COLOR[classes[0]] || 'var(--color-ink-soft)';
}

const URGENCY_RANK = { overdue: 3, due_today: 2, due_soon: 1, ok: 0 };

/** The most urgent payment status across everyone currently on this seat. */
export function seatPaymentUrgency(seat) {
  let worst = 'ok';
  for (const a of seat.timeline || []) {
    const u = a.paymentUrgency || 'ok';
    if (URGENCY_RANK[u] > URGENCY_RANK[worst]) worst = u;
  }
  return worst;
}

/**
 * The due date that goes with seatPaymentUrgency() — the due date of
 * whichever allocation is driving the worst-case urgency, so the date
 * shown next to a seat always matches the color/urgency label next to it.
 */
export function seatDueDate(seat) {
  let worst = 'ok';
  let dueDate = null;
  for (const a of seat.timeline || []) {
    const u = a.paymentUrgency || 'ok';
    if (URGENCY_RANK[u] >= URGENCY_RANK[worst]) {
      worst = u;
      dueDate = a.paymentDueDate || dueDate;
    }
  }
  return dueDate;
}

/**
 * A seat's structural status (available/occupied/shared/scheduling
 * conflict/disabled) — unaffected by payment. Kept separate from
 * seatPaymentUrgency() so scheduling conflicts (a real double-booking) and
 * payment risk (a billing concern) never get confused with each other:
 * a seat cell's border communicates structure, its fill color communicates
 * payment urgency (see seatColorClass below).
 */
export function seatStatusClass(seat) {
  if (seat.status === 'disabled') return 'disabled';
  const activeCount = (seat.timeline || []).length;
  if (activeCount === 0) return 'available';
  // naive overlap check across the timeline for a visual conflict hint
  const times = seat.timeline
    .map((a) => [a.startTime, a.endTime])
    .sort((a, b) => a[0].localeCompare(b[0]));
  for (let i = 1; i < times.length; i++) {
    if (times[i][0] < times[i - 1][1]) return 'conflict';
  }
  return activeCount > 1 ? 'partial' : 'occupied';
}

/**
 * The class that actually drives a seat cell's fill color. Available,
 * disabled and scheduling-conflict seats keep their own fixed color
 * (there's no "payment status" for an empty or disabled seat, and a
 * scheduling conflict is already the more urgent thing to flag); an
 * occupied/shared seat's color instead reflects the worst-case payment
 * urgency among whoever is allocated there — overdue (red) > due today
 * (orange) > due within 7 days (amber) > paid up / no due yet (the normal
 * occupied blue).
 */
export function seatColorClass(seat) {
  const status = seatStatusClass(seat);
  if (status !== 'occupied' && status !== 'partial') return status;
  const urgency = seatPaymentUrgency(seat);
  if (urgency === 'ok') return status; // normal occupied/partial color
  return `${status} urgency-${urgency}`;
}

const STATUS_FILTERS = ['all', 'available', 'occupied', 'partial', 'conflict', 'disabled'];
const ZOOM_MIN = 0.6;
const ZOOM_MAX = 2.2;
const ZOOM_STEP = 0.2;

export default function SeatMap() {
  const { t } = useTranslation();
  const [floors, setFloors] = useState([]);
  const [floorId, setFloorId] = useState('');
  const [seats, setSeats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedSeat, setSelectedSeat] = useState(null);
  const [seatQuery, setSeatQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [zoom, setZoom] = useState(1);
  // Optimistic today's-attendance marks per student, so a single-occupant
  // seat's quick Present/Absent tab reflects the click immediately without
  // waiting on a full seat reload (mirrors SeatDetailDrawer's own version
  // of this for the drawer's per-allocation buttons).
  const [attendanceMarks, setAttendanceMarks] = useState({});
  const [quickBusyId, setQuickBusyId] = useState(null);
  const [quickError, setQuickError] = useState('');

  async function markQuickAttendance(studentId, status) {
    const previous = attendanceMarks[studentId];
    setAttendanceMarks((m) => ({ ...m, [studentId]: status }));
    setQuickError('');
    setQuickBusyId(studentId);
    try {
      await api.post('/attendance', { studentId, date: new Date().toISOString().slice(0, 10), status });
    } catch (err) {
      setAttendanceMarks((m) => ({ ...m, [studentId]: previous }));
      setQuickError(apiErrorMessage(err));
    } finally {
      setQuickBusyId(null);
    }
  }

  const loadFloors = useCallback(async () => {
    try {
      const res = await api.get('/floors');
      setFloors(res.data.floors);
      if (res.data.floors.length > 0) setFloorId(res.data.floors[0].floor_id);
      else setLoading(false);
    } catch (err) {
      setError(apiErrorMessage(err));
      setLoading(false);
    }
  }, []);

  const loadSeats = useCallback(async (fid) => {
    if (!fid) return;
    setLoading(true);
    setError('');
    try {
      const res = await api.get(`/floors/${fid}/seats`);
      setSeats(res.data.seats);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFloors();
  }, [loadFloors]);

  useEffect(() => {
    if (floorId) loadSeats(floorId);
  }, [floorId, loadSeats]);

  const currentFloor = floors.find((f) => f.floor_id === floorId);

  // Reset zoom/pan-affecting filters when switching floors, so a large
  // floor's zoomed-in view doesn't carry over confusingly to a small one.
  useEffect(() => {
    setSeatQuery('');
    setStatusFilter('all');
    setZoom(1);
  }, [floorId]);

  const visibleSeats = seats
    .slice()
    .sort((a, b) => Number(a.seat_number) - Number(b.seat_number))
    .filter((seat) => {
      if (seatQuery && !String(seat.seat_number).toLowerCase().includes(seatQuery.trim().toLowerCase())) return false;
      if (statusFilter !== 'all' && seatStatusClass(seat) !== statusFilter) return false;
      return true;
    });

  return (
    <div>
      <div className="topbar">
        <h2 style={{ margin: 0 }}>{t('nav.floors')}</h2>
        {floors.length > 0 && (
          <select className="input" style={{ width: 220 }} value={floorId} onChange={(e) => setFloorId(e.target.value)}>
            {floors.map((f) => (
              <option key={f.floor_id} value={f.floor_id}>
                {f.floor_name}
              </option>
            ))}
          </select>
        )}
      </div>

      {loading && <Loading />}
      {error && !loading && <ErrorState message={error} onRetry={() => loadSeats(floorId)} />}
      {!loading && !error && floors.length === 0 && <EmptyState message="No floors configured yet. Add one in Settings → Floors." />}

      {!loading && !error && floors.length > 0 && (
        <>
          <div className="card seat-legend-card" style={{ marginBottom: 16 }}>
            <div className="seat-legend-row">
              <LegendChip cls="available" label={t('seats.available')} />
              <LegendChip cls="occupied" label={t('seats.occupied')} />
              <LegendChip cls="partial" label="Multiple students" />
              <LegendChip cls="conflict" label={t('seats.conflict')} />
              <LegendChip cls="disabled" label={t('seats.disabled')} />
            </div>
            <div className="seat-legend-row seat-legend-row-payment">
              <span className="seat-legend-caption">Occupied seat color = payment status:</span>
              <LegendChip cls="occupied" label="Paid up / not due yet" />
              <LegendChip cls="occupied urgency-due_soon" label="Due within 7 days" />
              <LegendChip cls="occupied urgency-due_today" label="Due today" />
              <LegendChip cls="occupied urgency-overdue" label="Overdue" />
            </div>
          </div>

          <div className="card seat-toolbar" style={{ marginBottom: 16 }}>
            <div className="seat-search-field">
              <SearchIcon size={16} color="var(--color-ink-soft)" />
              <input
                className="seat-search-input"
                placeholder={t('seats.lookupPlaceholder', 'Find seat #')}
                value={seatQuery}
                onChange={(e) => setSeatQuery(e.target.value)}
                aria-label={t('seats.lookupPlaceholder', 'Find seat #')}
              />
            </div>
            <div className="seat-filter-pills">
              {STATUS_FILTERS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`seat-filter-pill ${statusFilter === s ? 'is-active' : ''}`}
                  onClick={() => setStatusFilter(s)}
                >
                  {s === 'all' ? t('common.all', 'All') : t(`seats.${s}`, s)}
                </button>
              ))}
            </div>
            <div className="seat-zoom-controls">
              <button
                className="btn btn-outline"
                style={{ width: 32, height: 32, padding: 0 }}
                onClick={() => setZoom((z) => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2)))}
                disabled={zoom <= ZOOM_MIN}
                aria-label={t('seats.zoomOut', 'Zoom out')}
              >
                −
              </button>
              <span style={{ fontSize: 12, color: 'var(--color-ink-soft)', minWidth: 36, textAlign: 'center' }}>
                {Math.round(zoom * 100)}%
              </span>
              <button
                className="btn btn-outline"
                style={{ width: 32, height: 32, padding: 0 }}
                onClick={() => setZoom((z) => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2)))}
                disabled={zoom >= ZOOM_MAX}
                aria-label={t('seats.zoomIn', 'Zoom in')}
              >
                +
              </button>
            </div>
          </div>

          {quickError && <p style={{ color: 'var(--color-danger)', fontSize: 13 }}>{quickError}</p>}

          <div className="card" style={{ overflow: 'auto', touchAction: 'pan-x pan-y' }}>
            {visibleSeats.length === 0 ? (
              <p style={{ color: 'var(--color-ink-soft)', margin: 0 }}>{t('common.noResults')}</p>
            ) : (
              <div
                className="seat-map-rows"
                style={{
                  transform: `scale(${zoom})`,
                  transformOrigin: 'top left',
                  width: zoom > 1 ? `${100 / zoom}%` : '100%',
                }}
              >
                {Object.entries(
                  visibleSeats.reduce((byRow, seat) => {
                    // Seats created before the per-row feature have no
                    // row_number stamped — fall back to a single row so
                    // they still render instead of disappearing.
                    const rowNumber = seat.row_number || 1;
                    (byRow[rowNumber] = byRow[rowNumber] || []).push(seat);
                    return byRow;
                  }, {})
                )
                  .sort((a, b) => Number(a[0]) - Number(b[0]))
                  .map(([rowNumber, rowSeats]) => (
                    <div className="seat-map-row" key={rowNumber}>
                      {rowSeats.map((seat) => {
                        const status = seatStatusClass(seat);
                        const urgency = seatPaymentUrgency(seat);
                        const colorCls = seatColorClass(seat);
                        const dueDate = seatDueDate(seat);
                        const timeline = seat.timeline || [];
                        // Quick-mark only makes sense when there's exactly
                        // one student on this seat right now — with more
                        // than one (a shared/partial seat) it's ambiguous
                        // which student "Present" would apply to, so those
                        // still go through the seat detail drawer instead.
                        const soleOccupant = timeline.length === 1 ? timeline[0] : null;
                        const label =
                          status === 'occupied' || status === 'partial'
                            ? `Seat ${seat.seat_number}, ${status}${urgency !== 'ok' ? `, payment ${urgency.replace('_', ' ')}` : ''}`
                            : `Seat ${seat.seat_number}, ${status}`;
                        return (
                          <div key={seat.seat_id} className={`seat-cell ${colorCls}${timeline.length > 0 ? ' has-occupant' : ''}`} title={label}>
                            <button type="button" className="seat-number-btn" onClick={() => setSelectedSeat(seat)} aria-label={label}>
                              <ChairIcon color={seatIconColor(colorCls)} size={timeline.length > 0 ? 22 : 26} />
                              <span className="seat-number-label">{seat.seat_number}</span>
                            </button>
                            {timeline.length > 0 && (
                              <>
                                <div className="seat-due-date">
                                  {dueDate ? (
                                    <>
                                      <CalendarIcon size={11} /> Due {formatDate(dueDate)}
                                    </>
                                  ) : (
                                    'No dues'
                                  )}
                                </div>
                                {soleOccupant ? (
                                  <div className="seat-quick-attendance">
                                    <button
                                      type="button"
                                      className={`seat-quick-btn ${attendanceMarks[soleOccupant.studentId] === 'present' ? 'is-present' : ''}`}
                                      disabled={quickBusyId === soleOccupant.studentId}
                                      onClick={(e) => { e.stopPropagation(); markQuickAttendance(soleOccupant.studentId, 'present'); }}
                                      title={`Mark ${soleOccupant.studentName || soleOccupant.studentId} present today`}
                                    >
                                      {t('attendance.present')}
                                    </button>
                                    <button
                                      type="button"
                                      className={`seat-quick-btn ${attendanceMarks[soleOccupant.studentId] === 'absent' ? 'is-absent' : ''}`}
                                      disabled={quickBusyId === soleOccupant.studentId}
                                      onClick={(e) => { e.stopPropagation(); markQuickAttendance(soleOccupant.studentId, 'absent'); }}
                                      title={`Mark ${soleOccupant.studentName || soleOccupant.studentId} absent today`}
                                    >
                                      {t('attendance.absent')}
                                    </button>
                                  </div>
                                ) : (
                                  <div className="seat-quick-note">{timeline.length} students</div>
                                )}
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ))}
              </div>
            )}
          </div>

          <SeatSummaryStrip seats={seats} />
        </>
      )}

      {selectedSeat && (
        <SeatDetailDrawer
          seat={selectedSeat}
          floor={currentFloor}
          onClose={() => setSelectedSeat(null)}
          onChanged={() => loadSeats(floorId)}
        />
      )}
    </div>
  );
}

function LegendChip({ cls, label }) {
  return (
    <span className="seat-legend-chip">
      <ChairIcon color={seatIconColor(cls)} size={16} />
      {label}
    </span>
  );
}

/**
 * The floor's overall counts at a glance, below the seat grid — always
 * reflects the whole floor (not whatever the search/filter above narrowed
 * the grid down to), since "how many seats are overdue on this floor" is a
 * different question from "how many of my current search results are".
 */
function SeatSummaryStrip({ seats }) {
  const disabled = seats.filter((s) => s.status === 'disabled');
  const enabled = seats.filter((s) => s.status !== 'disabled');
  const available = enabled.filter((s) => (s.timeline || []).length === 0);
  const occupied = enabled.filter((s) => (s.timeline || []).length > 0);
  const worstUrgency = (s) => seatPaymentUrgency(s);
  const dueSoon = occupied.filter((s) => worstUrgency(s) === 'due_soon').length;
  const dueToday = occupied.filter((s) => worstUrgency(s) === 'due_today').length;
  const overdue = occupied.filter((s) => worstUrgency(s) === 'overdue').length;

  return (
    <div className="card seat-summary-strip">
      <SummaryStat icon={<ChairIcon color="var(--color-ink-soft)" size={22} />} label="Total Seats" value={seats.length} />
      <SummaryStat icon={<ChairIcon color="var(--color-success)" size={22} />} label="Available" value={available.length} valueColor="var(--color-success)" />
      <SummaryStat icon={<ChairIcon color="var(--color-info)" size={22} />} label="Occupied" value={occupied.length} valueColor="var(--color-info)" />
      <SummaryStat icon={<ClockIcon color="var(--color-warning)" size={22} />} label="Due within 7 days" value={dueSoon} valueColor="var(--color-warning)" />
      <SummaryStat icon={<ClockIcon color="var(--color-due-today)" size={22} />} label="Due today" value={dueToday} valueColor="var(--color-due-today)" />
      <SummaryStat icon={<AlertIcon color="var(--color-danger)" size={22} />} label="Overdue" value={overdue} valueColor="var(--color-danger)" />
      <SummaryStat icon={<BanIcon color="var(--color-ink-soft)" size={22} />} label="Disabled" value={disabled.length} />
    </div>
  );
}

function SummaryStat({ icon, label, value, valueColor }) {
  return (
    <div className="seat-summary-stat">
      <span className="seat-summary-icon">{icon}</span>
      <div>
        <div className="seat-summary-label">{label}</div>
        <div className="seat-summary-value" style={valueColor ? { color: valueColor } : undefined}>{value}</div>
      </div>
    </div>
  );
}
