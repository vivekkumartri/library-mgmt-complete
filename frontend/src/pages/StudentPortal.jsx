import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import api, { apiErrorMessage, openReceipt } from '../services/api';
import { Loading, ErrorState } from '../components/AsyncState';
import ChangePasswordCard from '../components/ChangePasswordCard';
import { formatDate, formatMonth } from '../utils/formatDate';

export function StudentHome() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [notices, setNotices] = useState([]);
  const [allocation, setAllocation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [n, a] = await Promise.all([
        api.get('/notices'),
        api.get('/allocations', { params: { status: 'active' } }),
      ]);
      setNotices(n.data.notices);
      setAllocation(a.data.allocations[0] || null);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <Loading />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  return (
    <div>
      <h2>{t('studentPortal.welcome')}, {user?.name}</h2>

      {allocation ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="stat-label">{t('studentPortal.currentSeat')}</div>
          <div className="stat-value">
            {allocation.floor_name ? `${allocation.floor_name} · ` : ''}Seat {allocation.seat_number ?? allocation.seat_id}
          </div>
          <p style={{ color: 'var(--color-ink-soft)', marginTop: 4 }}>
            {allocation.start_time} – {allocation.end_time} · ₹{allocation.monthly_fee}/month
          </p>
        </div>
      ) : (
        <div className="card" style={{ marginBottom: 16, color: 'var(--color-ink-soft)' }}>{t('studentPortal.noAllocation')}</div>
      )}

      <h3>{t('nav.notices')}</h3>
      <div className="card">
        {notices.length === 0 && <p style={{ color: 'var(--color-ink-soft)' }}>No notices right now.</p>}
        {notices.map((n) => (
          <div className="list-item" key={n.notice_id}>
            <div>
              <strong>{n.title_en}</strong>
              <div style={{ fontSize: 13, color: 'var(--color-ink-soft)' }}>{n.description_en}</div>
            </div>
            {n.priority === 'high' && <span className="badge badge-danger">Important</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

export function StudentMySeat() {
  const { t } = useTranslation();
  const [allocations, setAllocations] = useState([]);
  const [vacations, setVacations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { user } = useAuth();

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [a, v] = await Promise.all([
        api.get('/allocations'),
        api.get(`/students/${user.id}/vacations`),
      ]);
      setAllocations(a.data.allocations);
      setVacations(v.data.vacations);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <Loading />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  return (
    <div>
      <h2>{t('studentPortal.mySeat')}</h2>
      <div className="card" style={{ marginBottom: 16 }}>
        {allocations.length === 0 && <p style={{ color: 'var(--color-ink-soft)' }}>No allocation history.</p>}
        {allocations.map((a) => (
          <div className="list-item" key={a.allocation_id}>
            <div>
              <strong>
                {a.floor_name ? `${a.floor_name} · ` : ''}Seat {a.seat_number ?? a.seat_id} ({a.start_time} – {a.end_time})
              </strong>
              <div style={{ fontSize: 13, color: 'var(--color-ink-soft)' }}>
                {formatDate(a.start_date)} → {a.actual_end_date ? formatDate(a.actual_end_date) : 'ongoing'}
              </div>
            </div>
            <span className={`badge ${a.status === 'active' ? 'badge-success' : 'badge-neutral'}`}>{a.status}</span>
          </div>
        ))}
      </div>

      <h3>{t('studentPortal.vacationHistory')}</h3>
      <div className="card">
        {vacations.length === 0 && <p style={{ color: 'var(--color-ink-soft)' }}>No vacation periods recorded.</p>}
        {vacations.map((v) => (
          <div className="list-item" key={v.vacation_id}>
            <span>
              {formatDate(v.start_date)} → {formatDate(v.end_date)}
            </span>
            <span style={{ color: 'var(--color-ink-soft)' }}>{v.reason}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function StudentFees() {
  const { t } = useTranslation();
  const [billing, setBilling] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [receiptError, setReceiptError] = useState('');
  const [receiptBusyId, setReceiptBusyId] = useState(null);

  async function viewReceipt(payment) {
    setReceiptError('');
    setReceiptBusyId(payment.payment_id);
    try {
      await openReceipt(payment.payment_id, `${payment.receipt_number}.pdf`);
    } catch (err) {
      setReceiptError(apiErrorMessage(err, 'Unable to open this receipt.'));
    } finally {
      setReceiptBusyId(null);
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [b, p] = await Promise.all([api.get('/billing'), api.get('/payments')]);
      setBilling(b.data.billing);
      setPayments(p.data.payments);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <Loading />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  // Same due_date-vs-today rule the admin dashboard's payment-due widget
  // uses: a bill can still say status 'pending' after its due_date has
  // passed, so don't trust status alone to find what's actually overdue.
  const today = new Date().toISOString().slice(0, 10);
  const unpaid = billing.filter((b) => ['pending', 'partially_paid', 'overdue'].includes(b.status) && b.due_date);
  const nextDue = unpaid.slice().sort((a, b) => a.due_date.localeCompare(b.due_date))[0] || null;
  const nextDueUrgency = nextDue ? (nextDue.due_date < today ? 'overdue' : nextDue.due_date === today ? 'due_today' : 'upcoming') : null;

  return (
    <div>
      <h2>{t('studentPortal.fees')}</h2>

      {nextDue && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="stat-label">Upcoming due date</div>
          <div className="stat-value">{formatDate(nextDue.due_date)}</div>
          <p style={{ color: 'var(--color-ink-soft)', marginTop: 4 }}>
            ₹{Math.max(0, Number(nextDue.payable) - Number(nextDue.paid))} due for {formatMonth(nextDue.billing_month)}
            {' '}
            <span className={`badge ${nextDueUrgency === 'overdue' ? 'badge-danger' : nextDueUrgency === 'due_today' ? 'badge-warning' : 'badge-neutral'}`}>
              {nextDueUrgency === 'overdue' ? 'overdue' : nextDueUrgency === 'due_today' ? 'due today' : 'upcoming'}
            </span>
          </p>
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        {billing.length === 0 && <p style={{ color: 'var(--color-ink-soft)' }}>No billing records yet.</p>}
        {billing.map((b) => (
          <div className="list-item" key={b.billing_id}>
            <div>
              <strong>{formatMonth(b.billing_month)}</strong>
              <div style={{ fontSize: 13, color: 'var(--color-ink-soft)' }}>
                ₹{b.payable} payable · ₹{b.paid} paid{b.due_date ? ` · due ${formatDate(b.due_date)}` : ''}
              </div>
            </div>
            <span className={`badge ${b.status === 'paid' ? 'badge-success' : b.status === 'overdue' ? 'badge-danger' : 'badge-warning'}`}>
              {b.status.replace('_', ' ')}
            </span>
          </div>
        ))}
      </div>

      <h3>{t('studentPortal.receipts')}</h3>
      {receiptError && <p style={{ color: 'var(--color-danger)', fontSize: 13 }}>{receiptError}</p>}
      <div className="card">
        {payments.length === 0 && <p style={{ color: 'var(--color-ink-soft)' }}>No payments yet.</p>}
        {payments.map((p) => (
          <div className="list-item" key={p.payment_id}>
            <div>
              <strong>{p.receipt_number}</strong>
              <div style={{ fontSize: 13, color: 'var(--color-ink-soft)' }}>
                {formatDate(p.payment_date)} · ₹{p.amount} · {p.payment_method.toUpperCase()}
              </div>
            </div>
            <button className="btn btn-outline" disabled={receiptBusyId === p.payment_id} onClick={() => viewReceipt(p)}>
              {receiptBusyId === p.payment_id ? 'Opening…' : 'View PDF'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

const SELF_EDIT_FIELDS = [
  ['fatherName', 'father_name', "Father's name"],
  ['motherName', 'mother_name', "Mother's name"],
  ['mobile', 'mobile', 'Mobile'],
  ['alternateMobile', 'alternate_mobile', 'Alternate mobile'],
  ['email', 'email', 'Email'],
  ['address', 'address', 'Address'],
  ['dateOfBirth', 'date_of_birth', 'Date of birth'],
  ['idProofDetails', 'id_proof_details', 'ID proof details'],
  ['emergencyContact', 'emergency_contact', 'Emergency contact'],
];

export function StudentProfileSelf() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [student, setStudent] = useState(null);
  const [editableFields, setEditableFields] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [s, ef] = await Promise.all([
        api.get(`/students/${user.id}`),
        api.get('/students/self/editable-fields'),
      ]);
      setStudent(s.data.student);
      setEditableFields(ef.data.fields);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <Loading />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!student) return null;

  return (
    <div>
      <div className="topbar">
        <h2 style={{ margin: 0 }}>{t('nav.profile')}</h2>
        {!editing && editableFields.length > 0 && (
          <button className="btn btn-outline" onClick={() => setEditing(true)}>
            Edit details
          </button>
        )}
      </div>

      {editing ? (
        <StudentProfileEditForm
          student={student}
          editableFields={editableFields}
          onCancel={() => setEditing(false)}
          onDone={(updated) => {
            setStudent(updated);
            setEditing(false);
          }}
        />
      ) : (
        <div className="card">
          <Row label="Student ID" value={student.student_id} />
          <Row label="Name" value={student.full_name} />
          <Row label="Father's name" value={student.father_name} />
          <Row label="Mother's name" value={student.mother_name} />
          <Row label="Mobile" value={student.mobile} />
          <Row label="Alternate mobile" value={student.alternate_mobile} />
          <Row label="Email" value={student.email} />
          <Row label="Address" value={student.address} />
          <Row label="Date of birth" value={formatDate(student.date_of_birth)} />
          <Row label="ID proof details" value={student.id_proof_details} />
          <Row label="Emergency contact" value={student.emergency_contact} />
          <Row label="Joining date" value={formatDate(student.joining_date)} />
          <Row label="Status" value={student.status} />
        </div>
      )}

      <p style={{ fontSize: 13, color: 'var(--color-ink-soft)', marginTop: 12 }}>
        {t('studentPortal.contactStaff')}
      </p>
      <div style={{ marginTop: 16 }}>
        <ChangePasswordCard />
      </div>
    </div>
  );
}

function StudentProfileEditForm({ student, editableFields, onCancel, onDone }) {
  // Only the fields the admin has turned on in Settings appear here at all —
  // the backend re-checks this too (student_self_edit_fields), this is just
  // to not show a field the student can't actually save.
  const fields = SELF_EDIT_FIELDS.filter(([bodyKey]) => editableFields.includes(bodyKey));
  const [form, setForm] = useState(() =>
    Object.fromEntries(fields.map(([bodyKey, column]) => [bodyKey, student[column] || '']))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function setField(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const res = await api.patch(`/students/${student.student_id}/self`, form);
      onDone(res.data.student);
    } catch (err) {
      setError(apiErrorMessage(err, 'Unable to save your details.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      {error && <p style={{ color: 'var(--color-danger)', fontSize: 13, marginTop: 0 }}>{error}</p>}
      {fields.map(([bodyKey, , label]) => (
        <div className="field" key={bodyKey}>
          <label>{label}</label>
          <input
            className="input"
            type={bodyKey === 'dateOfBirth' ? 'date' : 'text'}
            value={form[bodyKey]}
            onChange={(e) => setField(bodyKey, e.target.value)}
          />
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button type="button" className="btn btn-outline" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </form>
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

const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function parseJsonSetting(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value) ?? fallback;
  } catch {
    return fallback;
  }
}

export function StudentLibraryInfo() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/settings');
      setSettings(res.data.settings);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <Loading />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!settings) return null;

  const weeklyHolidays = parseJsonSetting(settings.weekly_holidays, []);
  const specialHolidays = parseJsonSetting(settings.special_holidays, []);

  return (
    <div>
      <h2>{t('studentPortal.libraryInfo')}</h2>
      <div className="card" style={{ marginBottom: 16 }}>
        <Row label="Library" value={settings.library_name} />
        <Row label="Address" value={settings.library_address} />
        <Row label="Phone" value={settings.library_phone} />
        <Row label="Email" value={settings.library_email} />
        <Row label="Opening time" value={settings.opening_time} />
        <Row label="Closing time" value={settings.closing_time} />
      </div>

      <h3>Weekly holidays</h3>
      <div className="card" style={{ marginBottom: 16 }}>
        {weeklyHolidays.length === 0 ? (
          <p style={{ color: 'var(--color-ink-soft)' }}>Open every day of the week.</p>
        ) : (
          <p style={{ margin: 0 }}>{weeklyHolidays.map((d) => WEEKDAY_LABELS[Number(d)]).join(', ')}</p>
        )}
      </div>

      <h3>{t('studentPortal.upcomingHolidays')}</h3>
      <div className="card">
        {specialHolidays.length === 0 && <p style={{ color: 'var(--color-ink-soft)' }}>None announced.</p>}
        {specialHolidays.map((h, i) => (
          <div className="list-item" key={`${h.date}-${i}`}>
            <span>{formatDate(h.date)}</span>
            <span style={{ color: 'var(--color-ink-soft)' }}>{h.description || 'Holiday'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
