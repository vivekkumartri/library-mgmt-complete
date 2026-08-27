import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import api, { apiErrorMessage, openReceipt } from '../services/api';
import { Loading, ErrorState } from '../components/AsyncState';

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
            {allocation.start_time} – {allocation.end_time}
          </div>
          <p style={{ color: 'var(--color-ink-soft)', marginTop: 4 }}>₹{allocation.monthly_fee}/month</p>
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
                {a.start_time} – {a.end_time}
              </strong>
              <div style={{ fontSize: 13, color: 'var(--color-ink-soft)' }}>
                {a.start_date} → {a.actual_end_date || 'ongoing'}
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
              {v.start_date} → {v.end_date}
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

  return (
    <div>
      <h2>{t('studentPortal.fees')}</h2>
      <div className="card" style={{ marginBottom: 16 }}>
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

      <h3>{t('studentPortal.receipts')}</h3>
      {receiptError && <p style={{ color: 'var(--color-danger)', fontSize: 13 }}>{receiptError}</p>}
      <div className="card">
        {payments.length === 0 && <p style={{ color: 'var(--color-ink-soft)' }}>No payments yet.</p>}
        {payments.map((p) => (
          <div className="list-item" key={p.payment_id}>
            <div>
              <strong>{p.receipt_number}</strong>
              <div style={{ fontSize: 13, color: 'var(--color-ink-soft)' }}>
                {p.payment_date} · ₹{p.amount} · {p.payment_method.toUpperCase()}
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

export function StudentProfileSelf() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [student, setStudent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get(`/students/${user.id}`);
      setStudent(res.data.student);
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
      <h2>{t('nav.profile')}</h2>
      <div className="card">
        <Row label="Student ID" value={student.student_id} />
        <Row label="Name" value={student.full_name} />
        <Row label="Mobile" value={student.mobile} />
        <Row label="Email" value={student.email} />
        <Row label="Joining date" value={student.joining_date} />
        <Row label="Status" value={student.status} />
      </div>
      <p style={{ fontSize: 13, color: 'var(--color-ink-soft)', marginTop: 12 }}>
        {t('studentPortal.contactStaff')}
      </p>
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
            <span>{h.date}</span>
            <span style={{ color: 'var(--color-ink-soft)' }}>{h.description || 'Holiday'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
