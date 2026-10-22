import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api, { apiErrorMessage } from '../services/api';
import AllocateForm from './AllocateForm';
import EndAllocationDrawer from './EndAllocationDrawer';
import { formatDate } from '../utils/formatDate';
import { openWhatsappReminder, openSmsReminder, openEmailReminder } from '../utils/reminders';
import { queueAction } from '../utils/offlineQueue';

function StudentPhoto({ studentId }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let objUrl;
    api.get(`/students/${studentId}/photo`, { responseType: 'blob' })
      .then((res) => {
        objUrl = URL.createObjectURL(res.data);
        setUrl(objUrl);
      })
      .catch(() => {});
    return () => { if (objUrl) URL.revokeObjectURL(objUrl); };
  }, [studentId]);
  if (!url) return null;
  return (
    <img
      src={url}
      alt="Student photo"
      style={{ width: 56, height: 56, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: '2px solid var(--color-border)' }}
    />
  );
}

const URGENCY_LABEL = {
  overdue: 'Payment overdue',
  due_today: 'Payment due today',
  due_soon: 'Payment due soon',
};
const URGENCY_BADGE_CLASS = {
  overdue: 'badge-danger',
  due_today: 'badge-danger',
  due_soon: 'badge-warning',
};

const TODAY = new Date().toISOString().slice(0, 10);

export default function SeatDetailDrawer({ seat, floor, onClose, onChanged }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [showAllocate, setShowAllocate] = useState(false);
  const [endingAllocation, setEndingAllocation] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  // Optimistic today's-attendance marks per student, keyed by studentId, so
  // the seat map can be used as a quick attendance-marking surface without
  // navigating away to the Attendance page (mirrors Attendance.jsx's own
  // present/absent buttons and POST /attendance call).
  const [attendanceMarks, setAttendanceMarks] = useState({});
  const [librarySettings, setLibrarySettings] = useState(null);

  useEffect(() => {
    api.get('/settings').then((res) => setLibrarySettings(res.data.settings)).catch(() => {});
  }, []);

  function reminderInfoFor(a) {
    return {
      fullName: a.studentName || a.studentId,
      studentId: a.studentId,
      mobile: a.studentMobile,
      email: a.studentEmail,
      joiningDate: a.studentJoiningDate || a.startDate,
      seatLabel: `${floor?.floor_name ? `${floor.floor_name}, ` : ''}Seat ${seat.seat_number} (${a.startTime} – ${a.endTime})`,
      lastPaymentText: a.lastPaymentDate ? `Last paid ${formatDate(a.lastPaymentDate)}` : null,
      balance: a.paymentAmountDue,
      dueDate: a.paymentDueDate,
      libraryName: librarySettings?.library_name,
      libraryAddress: librarySettings?.library_address,
      libraryPhone: librarySettings?.library_phone,
    };
  }

  function sendReminderWhatsapp(a) {
    if (!openWhatsappReminder(reminderInfoFor(a), librarySettings)) setError('This student has no mobile number on file.');
  }

  function sendReminderSms(a) {
    if (!openSmsReminder(reminderInfoFor(a), librarySettings)) setError('This student has no mobile number on file.');
  }

  function sendReminderEmail(a) {
    if (!openEmailReminder(reminderInfoFor(a), librarySettings)) setError('This student has no email address on file.');
  }

  async function markAttendance(studentId, status) {
    const previous = attendanceMarks[studentId];
    setAttendanceMarks((m) => ({ ...m, [studentId]: status }));
    setError('');
    setBusyId(`attendance-${studentId}`);
    try {
      await api.post('/attendance', { studentId, date: TODAY, status });
    } catch (err) {
      // Same reasoning as Attendance.jsx — no response at all means this
      // never reached the server, so queue it rather than treating it as
      // a real rejection; attendance marks are safe to retry since the
      // backend dedupes by student+date.
      if (!err?.response) {
        queueAction({
          kind: 'attendance',
          url: '/attendance',
          body: { studentId, date: TODAY, status },
          label: `${status === 'present' ? 'Present' : 'Absent'} — ${studentId} (${TODAY})`,
        });
        return;
      }
      setAttendanceMarks((m) => ({ ...m, [studentId]: previous }));
      setError(apiErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function toggleDisabled() {
    setError('');
    setBusyId('toggle');
    try {
      const nextStatus = seat.status === 'disabled' ? 'available' : 'disabled';
      const reason = nextStatus === 'disabled' ? window.prompt('Reason for disabling this seat?', 'Maintenance') : undefined;
      if (nextStatus === 'disabled' && reason === null) {
        setBusyId(null);
        return;
      }
      await api.patch(`/seats/${seat.seat_id}`, { status: nextStatus, disabledReason: reason });
      onChanged();
      onClose();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        {endingAllocation ? (
          <EndAllocationDrawer
            allocation={{
              allocation_id: endingAllocation.allocationId,
              start_time: endingAllocation.startTime,
              end_time: endingAllocation.endTime,
              start_date: endingAllocation.startDate || '',
            }}
            studentName={endingAllocation.studentId}
            onClose={() => setEndingAllocation(null)}
            onDone={() => {
              setEndingAllocation(null);
              onChanged();
              onClose();
            }}
          />
        ) : !showAllocate ? (
          <>
            <div className="topbar">
              <h3 style={{ margin: 0 }}>
                {floor?.floor_name} — Seat {seat.seat_number}
              </h3>
              <button className="btn btn-outline" onClick={onClose}>
                {t('common.close')}
              </button>
            </div>

            <span className={`badge ${seat.status === 'disabled' ? 'badge-danger' : 'badge-success'}`}>
              {seat.status === 'disabled' ? t('seats.disabled') : t('seats.available').toUpperCase()}
            </span>

            <h4 style={{ marginTop: 20 }}>Allocation timeline</h4>
            {(!seat.timeline || seat.timeline.length === 0) && <p style={{ color: 'var(--color-ink-soft)' }}>No active allocations.</p>}
            {(seat.timeline || []).map((a) => (
              <div className="list-item" key={a.allocationId} style={{ alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', gap: 10, flex: 1 }}>
                  {a.hasPhoto && <StudentPhoto studentId={a.studentId} />}
                  <div>
                  <strong>{a.studentName || a.studentId}</strong>
                  <div style={{ fontSize: 13, color: 'var(--color-ink-soft)' }}>
                    {a.studentId}
                    {a.studentMobile ? ` · ${a.studentMobile}` : ''}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--color-ink-soft)' }}>
                    {a.startTime} – {a.endTime} · ₹{a.monthlyFee}/month
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--color-ink-soft)' }}>
                    Joined {formatDate(a.startDate)}
                    {a.lastPaymentDate ? ` · Last payment ${formatDate(a.lastPaymentDate)}` : ' · No payments yet'}
                  </div>
                  {a.paymentUrgency && a.paymentUrgency !== 'ok' && (
                    <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span className={`badge ${URGENCY_BADGE_CLASS[a.paymentUrgency]}`}>
                        {URGENCY_LABEL[a.paymentUrgency]}
                        {a.paymentDueDate ? ` (${formatDate(a.paymentDueDate)})` : ''}
                      </span>
                      {a.paymentAmountDue ? (
                        <span style={{ fontSize: 12, color: 'var(--color-ink-soft)' }}>₹{a.paymentAmountDue} due</span>
                      ) : null}
                    </div>
                  )}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      className="btn"
                      style={{
                        padding: '0 10px', height: 32, fontSize: 12,
                        background: attendanceMarks[a.studentId] === 'present' ? 'var(--color-success)' : undefined,
                        color: attendanceMarks[a.studentId] === 'present' ? 'white' : undefined,
                      }}
                      disabled={busyId === `attendance-${a.studentId}`}
                      onClick={() => markAttendance(a.studentId, 'present')}
                      title={`Mark ${a.studentName || a.studentId} present today`}
                    >
                      {t('attendance.present')}
                    </button>
                    <button
                      className="btn"
                      style={{
                        padding: '0 10px', height: 32, fontSize: 12,
                        background: attendanceMarks[a.studentId] === 'absent' ? 'var(--color-danger)' : undefined,
                        color: attendanceMarks[a.studentId] === 'absent' ? 'white' : undefined,
                      }}
                      disabled={busyId === `attendance-${a.studentId}`}
                      onClick={() => markAttendance(a.studentId, 'absent')}
                      title={`Mark ${a.studentName || a.studentId} absent today`}
                    >
                      {t('attendance.absent')}
                    </button>
                  </div>
                  <button className="btn btn-outline" onClick={() => navigate(`/students/${a.studentId}`)}>
                    {t('common.view')}
                  </button>
                  {a.studentMobile && (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        className="btn btn-outline"
                        style={{ padding: '0 10px', height: 32, fontSize: 12 }}
                        onClick={() => sendReminderWhatsapp(a)}
                        title={`Send ${a.studentName || a.studentId} a payment reminder via WhatsApp`}
                      >
                        WhatsApp
                      </button>
                      <button
                        className="btn btn-outline"
                        style={{ padding: '0 10px', height: 32, fontSize: 12 }}
                        onClick={() => sendReminderSms(a)}
                        title={`Send ${a.studentName || a.studentId} a payment reminder via SMS`}
                      >
                        SMS
                      </button>
                    </div>
                  )}
                  {a.studentEmail && (
                    <button
                      className="btn btn-outline"
                      style={{ padding: '0 10px', height: 32, fontSize: 12 }}
                      onClick={() => sendReminderEmail(a)}
                      title={`Send ${a.studentName || a.studentId} a payment reminder via email`}
                    >
                      Email
                    </button>
                  )}
                  <button className="btn btn-outline" onClick={() => setEndingAllocation(a)}>
                    {t('seats.endAllocation')}
                  </button>
                </div>
              </div>
            ))}

            {error && <p style={{ color: 'var(--color-danger)', fontSize: 13 }}>{error}</p>}

            <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
              <button className="btn btn-primary" disabled={seat.status === 'disabled'} onClick={() => setShowAllocate(true)}>
                {t('seats.allocate')}
              </button>
              <button className="btn btn-outline" disabled={busyId === 'toggle'} onClick={toggleDisabled}>
                {seat.status === 'disabled' ? 'Enable seat' : 'Disable seat'}
              </button>
            </div>
          </>
        ) : (
          <AllocateForm
            seat={seat}
            floor={floor}
            onClose={() => setShowAllocate(false)}
            onDone={() => {
              setShowAllocate(false);
              onChanged();
              onClose();
            }}
          />
        )}
      </div>
    </div>
  );
}
