import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import api, { apiErrorMessage } from '../services/api';
import { Loading, ErrorState, EmptyState } from '../components/AsyncState';
import SeatDetailDrawer from '../components/SeatDetailDrawer';

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
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13 }}>
              <LegendDot cls="available" label={t('seats.available')} />
              <LegendDot cls="occupied" label={t('seats.occupied')} />
              <LegendDot cls="partial" label="Multiple students" />
              <LegendDot cls="conflict" label={t('seats.conflict')} />
              <LegendDot cls="disabled" label={t('seats.disabled')} />
            </div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13, marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--color-border)' }}>
              <span style={{ color: 'var(--color-ink-soft)' }}>Occupied seat color = payment status:</span>
              <LegendDot cls="occupied" label="Paid up / not due yet" />
              <LegendDot cls="occupied urgency-due_soon" label="Due within 7 days" />
              <LegendDot cls="occupied urgency-due_today" label="Due today" />
              <LegendDot cls="occupied urgency-overdue" label="Overdue" />
            </div>
          </div>

          <div className="card" style={{ marginBottom: 16, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              className="input"
              style={{ maxWidth: 200 }}
              placeholder={t('seats.lookupPlaceholder', 'Find seat #')}
              value={seatQuery}
              onChange={(e) => setSeatQuery(e.target.value)}
              aria-label={t('seats.lookupPlaceholder', 'Find seat #')}
            />
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {STATUS_FILTERS.map((s) => (
                <button
                  key={s}
                  className={`btn ${statusFilter === s ? 'btn-primary' : 'btn-outline'}`}
                  style={{ padding: '0 10px', height: 32, fontSize: 12 }}
                  onClick={() => setStatusFilter(s)}
                >
                  {s === 'all' ? t('common.all', 'All') : t(`seats.${s}`, s)}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 'auto' }}>
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
                className="seat-grid"
                style={{
                  '--cols': currentFloor?.columns || 4,
                  transform: `scale(${zoom})`,
                  transformOrigin: 'top left',
                  width: zoom > 1 ? `${100 / zoom}%` : '100%',
                }}
              >
                {visibleSeats.map((seat) => {
                  const status = seatStatusClass(seat);
                  const urgency = seatPaymentUrgency(seat);
                  const colorCls = seatColorClass(seat);
                  const dueDate = seatDueDate(seat);
                  const timeline = seat.timeline || [];
                  // Quick-mark only makes sense when there's exactly one
                  // student on this seat right now — with more than one
                  // (a shared/partial seat) it's ambiguous which student
                  // "Present" would apply to, so those still go through
                  // the seat detail drawer instead.
                  const soleOccupant = timeline.length === 1 ? timeline[0] : null;
                  const label =
                    status === 'occupied' || status === 'partial'
                      ? `Seat ${seat.seat_number}, ${status}${urgency !== 'ok' ? `, payment ${urgency.replace('_', ' ')}` : ''}`
                      : `Seat ${seat.seat_number}, ${status}`;
                  return (
                    <div key={seat.seat_id} className={`seat-cell ${colorCls}${timeline.length > 0 ? ' has-occupant' : ''}`} title={label}>
                      <button type="button" className="seat-number-btn" onClick={() => setSelectedSeat(seat)} aria-label={label}>
                        {seat.seat_number}
                      </button>
                      {timeline.length > 0 && (
                        <>
                          <div className="seat-due-date">{dueDate ? `Due ${dueDate}` : 'No dues'}</div>
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
            )}
          </div>
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

function LegendDot({ cls, label }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span className={`seat-cell ${cls}`} style={{ width: 18, height: 18, minHeight: 0, aspectRatio: 'auto' }} />
      {label}
    </span>
  );
}
