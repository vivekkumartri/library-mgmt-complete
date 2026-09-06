import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api, { apiErrorMessage } from '../services/api';
import { Loading, ErrorState } from '../components/AsyncState';
import SignaturePad from '../components/SignaturePad';
import CameraCapture from '../components/CameraCapture';
import EndAllocationDrawer from '../components/EndAllocationDrawer';

const URGENCY_LABEL = {
  overdue: 'Payment overdue',
  due_today: 'Payment due today',
  due_soon: 'Payment due soon',
  ok: 'Paid up',
};
const URGENCY_BADGE_CLASS = {
  overdue: 'badge-danger',
  due_today: 'badge-danger',
  due_soon: 'badge-warning',
  ok: 'badge-success',
};

export default function StudentProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [student, setStudent] = useState(null);
  const [allocations, setAllocations] = useState([]);
  const [billing, setBilling] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [vacations, setVacations] = useState([]);
  const [payments, setPayments] = useState([]);
  const [paymentStatus, setPaymentStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showSignaturePad, setShowSignaturePad] = useState(false);
  const [feeHistory, setFeeHistory] = useState([]);
  const [currentFee, setCurrentFee] = useState(null);
  const [showChangeFee, setShowChangeFee] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [endingAllocation, setEndingAllocation] = useState(null);
  const [showAddVacation, setShowAddVacation] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [copiedField, setCopiedField] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [s, a, b, att, v, p, fp, ps] = await Promise.all([
        api.get(`/students/${id}`),
        api.get('/allocations', { params: { studentId: id } }),
        api.get('/billing', { params: { studentId: id } }),
        api.get('/attendance', { params: { studentId: id } }),
        api.get(`/students/${id}/vacations`),
        api.get('/payments', { params: { studentId: id } }),
        api.get(`/students/${id}/fee-plans`),
        api.get(`/students/${id}/payment-status`),
      ]);
      setStudent(s.data.student);
      setAllocations(a.data.allocations);
      setBilling(b.data.billing);
      setAttendance(att.data.attendance);
      setVacations(v.data.vacations);
      setPayments(p.data.payments);
      setFeeHistory(fp.data.history);
      setCurrentFee(fp.data.current);
      setPaymentStatus(ps.data);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function resetPassword() {
    if (!window.confirm('Generate a new password for this student? The old one will stop working.')) return;
    try {
      const res = await api.post(`/students/${id}/reset-password`);
      setNewPassword(res.data.newPassword);
    } catch (err) {
      setNotice(apiErrorMessage(err));
    }
  }

  function copyToClipboard(text, field) {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    setCopiedField(field);
    setTimeout(() => setCopiedField(''), 1500);
  }

  async function deactivate() {
    if (!window.confirm('Deactivate this student account? They will no longer be able to log in.')) return;
    try {
      await api.post(`/students/${id}/deactivate`);
      load();
    } catch (err) {
      setNotice(apiErrorMessage(err));
    }
  }

  async function reactivate() {
    if (!window.confirm('Reactivate this student? They will move back to Active Students.')) return;
    try {
      await api.post(`/students/${id}/reactivate`);
      load();
    } catch (err) {
      setNotice(apiErrorMessage(err));
    }
  }

  async function deleteStudent() {
    if (
      !window.confirm(
        `Permanently delete ${student.full_name} (${student.student_id})? This cannot be undone. Use Deactivate instead if you want to keep their records.`
      )
    ) {
      return;
    }
    try {
      await api.delete(`/students/${id}`);
      navigate('/students');
    } catch (err) {
      setNotice(apiErrorMessage(err));
    }
  }

  async function uploadPhoto(blob) {
    const fd = new FormData();
    fd.append('photo', blob, 'photo.jpg');
    try {
      await api.post(`/students/${id}/photo`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setNotice('Photo uploaded.');
      setShowCamera(false);
      load();
    } catch (err) {
      setNotice(apiErrorMessage(err));
    }
  }

  if (loading) return <Loading />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!student) return null;

  return (
    <div>
      <div className="topbar">
        <h2 style={{ margin: 0 }}>{student.full_name}</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {paymentStatus?.urgency && (
            <span className={`badge ${URGENCY_BADGE_CLASS[paymentStatus.urgency]}`}>{URGENCY_LABEL[paymentStatus.urgency]}</span>
          )}
          <span className={`badge ${student.status === 'active' ? 'badge-success' : 'badge-neutral'}`}>{student.status}</span>
        </div>
      </div>

      {paymentStatus?.dueDate && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="stat-label">Payment due date</div>
          <div className="stat-value">{paymentStatus.dueDate}</div>
          <p style={{ fontSize: 13, color: 'var(--color-ink-soft)', margin: '4px 0 0' }}>
            Worked out automatically from their joining date and monthly fee — no billing record required.
            {paymentStatus.balance > 0 ? ` Currently ₹${paymentStatus.balance} due.` : ' Nothing currently due.'}
          </p>
        </div>
      )}

      {notice && (
        <div className="card" style={{ marginBottom: 16, background: 'var(--color-info-soft)' }}>
          {notice}
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Login details</h3>
        <p style={{ fontSize: 13, color: 'var(--color-ink-soft)', marginTop: 0 }}>
          The student logs in to the student portal with their Student ID as the login ID and a password.
        </p>
        <div className="list-item">
          <div>
            <span style={{ color: 'var(--color-ink-soft)' }}>Login ID</span>
            <div style={{ fontSize: 18, fontWeight: 600 }}>{student.student_id}</div>
          </div>
          <button className="btn btn-outline" onClick={() => copyToClipboard(student.student_id, 'id')}>
            {copiedField === 'id' ? 'Copied!' : 'Copy'}
          </button>
        </div>
        {newPassword ? (
          <div className="list-item" style={{ background: 'var(--color-success-soft)', borderRadius: 8, marginTop: 8 }}>
            <div>
              <span style={{ color: 'var(--color-ink-soft)' }}>New password</span>
              <div style={{ fontSize: 18, fontWeight: 600 }}>{newPassword}</div>
              <div style={{ fontSize: 12, color: 'var(--color-ink-soft)' }}>
                Shown only once — share it with the student now. It cannot be viewed again after you leave this page.
              </div>
            </div>
            <button className="btn btn-outline" onClick={() => copyToClipboard(newPassword, 'password')}>
              {copiedField === 'password' ? 'Copied!' : 'Copy'}
            </button>
          </div>
        ) : (
          <p style={{ fontSize: 13, color: 'var(--color-ink-soft)', marginTop: 8 }}>
            Passwords are stored securely and can't be viewed after creation. To find out (or set) a student's password, generate a new one below and share it with them.
          </p>
        )}
        <div style={{ marginTop: 12 }}>
          <button className="btn btn-primary" onClick={resetPassword}>
            {newPassword ? 'Generate another password' : 'Generate / view password'}
          </button>
        </div>
      </div>

      <div className="card-grid cols-2">
        <div className="card">
          <h3>Profile</h3>
          <Row label="Student ID" value={student.student_id} />
          <Row label="Mobile" value={student.mobile} />
          <Row label="Email" value={student.email} />
          <Row label="Joining date" value={student.joining_date} />
          <Row label="Address" value={student.address} />
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <button className="btn btn-outline" onClick={() => setShowCamera((v) => !v)}>
              {student.photo_drive_file_id ? 'Retake photo' : 'Capture photo'}
            </button>
            <button className="btn btn-outline" onClick={() => setShowSignaturePad((v) => !v)}>
              {student.signature_drive_file_id ? 'Retake signature' : 'Capture signature'}
            </button>
            {student.status === 'active' && (
              <button className="btn btn-danger" onClick={deactivate}>
                Deactivate
              </button>
            )}
            {student.status === 'past' && (
              <button className="btn btn-primary" onClick={reactivate}>
                Reactivate student
              </button>
            )}
            {allocations.length === 0 && payments.length === 0 && attendance.length === 0 && (
              <button className="btn btn-danger" onClick={deleteStudent}>
                Delete permanently
              </button>
            )}
          </div>
          {allocations.length === 0 && payments.length === 0 && attendance.length === 0 && (
            <p style={{ fontSize: 12, color: 'var(--color-ink-soft)', marginTop: 8 }}>
              No allocation, payment, or attendance history yet — this student can still be permanently deleted. Once any
              of those exist, only Deactivate will be available.
            </p>
          )}
          {student.status === 'past' && student.leaving_date && (
            <p style={{ fontSize: 13, color: 'var(--color-ink-soft)', marginTop: 8 }}>Left on {student.leaving_date}</p>
          )}
          {showCamera && (
            <div style={{ marginTop: 16 }}>
              <CameraCapture label="Student photo" onCapture={uploadPhoto} />
            </div>
          )}
          {showChangeFee && (
            <ChangeFeeDrawer
              studentId={student.student_id}
              currentFee={currentFee}
              onClose={() => setShowChangeFee(false)}
              onDone={() => {
                setShowChangeFee(false);
                setNotice('Fee plan updated.');
                load();
              }}
            />
          )}
          {showSignaturePad && (
            <div style={{ marginTop: 16 }}>
              <SignaturePad
                studentId={student.student_id}
                onSaved={() => {
                  setShowSignaturePad(false);
                  setNotice('Signature saved.');
                  load();
                }}
                onCancel={() => setShowSignaturePad(false)}
              />
            </div>
          )}
        </div>

        <div className="card">
          <h3>Seat allocations</h3>
          {allocations.length === 0 && <p style={{ color: 'var(--color-ink-soft)' }}>No allocations yet.</p>}
          {allocations.map((a) => (
            <div className="list-item" key={a.allocation_id}>
              <div>
                <strong>
                  {a.start_time} – {a.end_time}
                </strong>
                <div style={{ fontSize: 13, color: 'var(--color-ink-soft)' }}>
                  {a.start_date} → {a.actual_end_date || 'ongoing'}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className={`badge ${a.status === 'active' ? 'badge-success' : 'badge-neutral'}`}>{a.status}</span>
                {(a.status === 'active' || a.status === 'scheduled') && (
                  <button className="btn btn-outline" onClick={() => setEndingAllocation(a)}>
                    End allocation
                  </button>
                )}
              </div>
            </div>
          ))}
          {endingAllocation && (
            <EndAllocationDrawer
              allocation={endingAllocation}
              studentName={student.full_name}
              onClose={() => setEndingAllocation(null)}
              onDone={() => {
                setEndingAllocation(null);
                setNotice('Allocation ended.');
                load();
              }}
            />
          )}
        </div>

        <div className="card">
          <div className="topbar" style={{ marginBottom: 8 }}>
            <h3 style={{ margin: 0 }}>Fee plan</h3>
            <button className="btn btn-outline" onClick={() => setShowChangeFee(true)}>
              Change fee
            </button>
          </div>
          {currentFee ? (
            <p style={{ margin: '0 0 8px' }}>
              ₹{currentFee.monthly_fee}/month
              {Number(currentFee.discount) > 0 ? ` (₹${currentFee.discount} discount)` : ''} — effective since {currentFee.effective_from}
            </p>
          ) : (
            <p style={{ color: 'var(--color-ink-soft)', margin: '0 0 8px' }}>No fee plan set yet.</p>
          )}
          {feeHistory.length > 1 && (
            <details>
              <summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--color-ink-soft)' }}>Fee history ({feeHistory.length})</summary>
              {feeHistory.map((f) => (
                <div className="list-item" key={f.fee_plan_id}>
                  <span>₹{f.monthly_fee}{Number(f.discount) > 0 ? ` (−₹${f.discount})` : ''}</span>
                  <span style={{ color: 'var(--color-ink-soft)', fontSize: 13 }}>
                    {f.effective_from} → {f.effective_to || 'ongoing'}
                  </span>
                </div>
              ))}
            </details>
          )}
          <p style={{ fontSize: 12, color: 'var(--color-ink-soft)', marginTop: 8, marginBottom: 0 }}>
            Changing the fee here never edits past billing months — each month's invoice keeps the amount it was created with.
          </p>
        </div>

        <div className="card">
          <h3>Billing</h3>
          {billing.length === 0 && <p style={{ color: 'var(--color-ink-soft)' }}>No billing records yet.</p>}
          {billing.map((b) => (
            <div className="list-item" key={b.billing_id}>
              <div>
                <strong>{b.billing_month}</strong>
                <div style={{ fontSize: 13, color: 'var(--color-ink-soft)' }}>
                  ₹{b.payable} payable · ₹{b.paid} paid
                </div>
              </div>
              <span className={`badge ${b.status === 'paid' ? 'badge-success' : b.status === 'overdue' ? 'badge-danger' : 'badge-warning'}`}>
                {b.status.replace('_', ' ')}
              </span>
            </div>
          ))}
        </div>

        <div className="card">
          <h3>Attendance</h3>
          {attendance.length === 0 && <p style={{ color: 'var(--color-ink-soft)' }}>No attendance recorded yet.</p>}
          {attendance.slice(0, 10).map((a) => (
            <div className="list-item" key={a.attendance_id}>
              <div>
                <span>{a.date}</span>
                {a.marked_at && (
                  <div style={{ fontSize: 12, color: 'var(--color-ink-soft)' }}>
                    Marked at {new Date(a.marked_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                )}
              </div>
              <span className={`badge ${a.status === 'present' ? 'badge-success' : 'badge-danger'}`}>{a.status}</span>
            </div>
          ))}
        </div>

        <div className="card">
          <div className="topbar" style={{ marginBottom: 8 }}>
            <h3 style={{ margin: 0 }}>Vacation history</h3>
            <button className="btn btn-outline" onClick={() => setShowAddVacation(true)}>
              Add vacation
            </button>
          </div>
          {vacations.length === 0 && <p style={{ color: 'var(--color-ink-soft)' }}>No vacation periods recorded.</p>}
          {vacations
            .slice()
            .sort((a, b) => (a.start_date < b.start_date ? 1 : -1))
            .map((v) => (
              <div className="list-item" key={v.vacation_id}>
                <span>
                  {v.start_date} → {v.end_date}
                </span>
                <span style={{ color: 'var(--color-ink-soft)' }}>{v.reason || '—'}</span>
              </div>
            ))}
          {showAddVacation && (
            <AddVacationDrawer
              studentId={student.student_id}
              onClose={() => setShowAddVacation(false)}
              onDone={() => {
                setShowAddVacation(false);
                setNotice('Vacation period recorded.');
                load();
              }}
            />
          )}
        </div>

        <div className="card">
          <h3>Receipts</h3>
          {payments.length === 0 && <p style={{ color: 'var(--color-ink-soft)' }}>No payments recorded yet.</p>}
          {payments.map((p) => (
            <div className="list-item" key={p.payment_id}>
              <div>
                <strong>{p.receipt_number}</strong>
                <div style={{ fontSize: 13, color: 'var(--color-ink-soft)' }}>
                  {p.payment_date} · ₹{p.amount} · {p.payment_method.toUpperCase()}
                  {p.status === 'void' ? ' · VOID' : ''}
                </div>
              </div>
              <a className="btn btn-outline" href={`${import.meta.env.VITE_API_BASE_URL || '/api'}/payments/${p.payment_id}/receipt.pdf`} target="_blank" rel="noreferrer">
                View PDF
              </a>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="list-item">
      <span style={{ color: 'var(--color-ink-soft)' }}>{label}</span>
      <span>{value || '—'}</span>
    </div>
  );
}

function AddVacationDrawer({ studentId, onClose, onDone }) {
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!startDate || !endDate) {
      setError('Start and end date are required.');
      return;
    }
    if (endDate < startDate) {
      setError('End date must be on or after the start date.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.post(`/students/${studentId}/vacations`, { startDate, endDate, reason, notes });
      onDone();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <h3>Add vacation period</h3>
        <p style={{ fontSize: 13, color: 'var(--color-ink-soft)' }}>
          This adds a new record to this student's vacation history — past vacation periods are never overwritten.
        </p>
        <div style={{ display: 'flex', gap: 12 }}>
          <div className="field" style={{ flex: 1 }}>
            <label>Start date</label>
            <input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>End date</label>
            <input className="input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label>Reason</label>
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Exams, travel, medical" />
        </div>
        <div className="field">
          <label>Notes</label>
          <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        {error && <p style={{ color: 'var(--color-danger)', fontSize: 13 }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button className="btn btn-primary" disabled={busy} onClick={submit}>
            Save vacation
          </button>
          <button className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function ChangeFeeDrawer({ studentId, currentFee, onClose, onDone }) {
  const [monthlyFee, setMonthlyFee] = useState(currentFee ? String(currentFee.monthly_fee) : '');
  const [discount, setDiscount] = useState(currentFee ? String(currentFee.discount || 0) : '0');
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!monthlyFee) {
      setError('Monthly fee is required.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.post(`/students/${studentId}/fee-plans`, {
        monthlyFee: Number(monthlyFee),
        discount: Number(discount || 0),
        effectiveFrom,
      });
      onDone();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <h3>Change fee</h3>
        <p style={{ fontSize: 13, color: 'var(--color-ink-soft)' }}>
          This starts a new fee plan from the effective date below. Billing months already created keep their original amount — only future billing you create will use this new fee.
        </p>
        <div style={{ display: 'flex', gap: 12 }}>
          <div className="field" style={{ flex: 1 }}>
            <label>Monthly fee (₹)</label>
            <input className="input" type="number" value={monthlyFee} onChange={(e) => setMonthlyFee(e.target.value)} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Discount (₹)</label>
            <input className="input" type="number" value={discount} onChange={(e) => setDiscount(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label>Effective from</label>
          <input className="input" type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
        </div>
        {error && <p style={{ color: 'var(--color-danger)', fontSize: 13 }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button className="btn btn-primary" disabled={busy} onClick={submit}>
            Save fee plan
          </button>
          <button className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
