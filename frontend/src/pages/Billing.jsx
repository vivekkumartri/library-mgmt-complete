import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import api, { apiErrorMessage, openReceipt } from '../services/api';
import { Loading, ErrorState, EmptyState } from '../components/AsyncState';
import StudentSearchPicker from '../components/StudentSearchPicker';
import { formatDate } from '../utils/formatDate';

/** Shown after a payment is successfully recorded, in place of the form,
 * so the receipt is one click away instead of requiring a trip to the
 * student's fee history to find it. */
function ReceiptReadyPanel({ payment, onDone }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function download() {
    setError('');
    setBusy(true);
    try {
      await openReceipt(payment.payment_id, `${payment.receipt_number}.pdf`);
    } catch (err) {
      setError(apiErrorMessage(err, 'Unable to open this receipt.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h3>Payment recorded</h3>
      <p style={{ color: 'var(--color-ink-soft)' }}>
        Receipt {payment.receipt_number} · ₹{payment.amount}
      </p>
      {error && <p style={{ color: 'var(--color-danger)', fontSize: 13 }}>{error}</p>}
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button className="btn btn-primary" disabled={busy} onClick={download}>
          {busy ? 'Opening…' : 'Download receipt'}
        </button>
        <button className="btn btn-outline" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}

export default function Billing() {
  const { t } = useTranslation();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [billing, setBilling] = useState([]);
  const [students, setStudents] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [payFor, setPayFor] = useState(null);
  const [showRangePayment, setShowRangePayment] = useState(false);
  const [paymentDateMode, setPaymentDateMode] = useState('auto');

  useEffect(() => {
    api.get('/settings').then((res) => {
      setPaymentDateMode(res.data.settings?.payment_date_mode || 'auto');
    }).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/billing', { params: { month } });
      setBilling(res.data.billing);
      const ids = [...new Set(res.data.billing.map((b) => b.student_id))];
      const entries = await Promise.all(
        ids.map((sid) => api.get(`/students/${sid}`).then((r) => [sid, r.data.student]).catch(() => [sid, null]))
      );
      setStudents(Object.fromEntries(entries));
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <div className="topbar">
        <h2 style={{ margin: 0 }}>{t('billing.title')}</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="input" type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ width: 160 }} />
          <button className="btn btn-primary" onClick={() => setShowRangePayment(true)}>
            Record payment (date range)
          </button>
        </div>
      </div>

      {loading && <Loading />}
      {error && !loading && <ErrorState message={error} onRetry={load} />}
      {!loading && !error && billing.length === 0 && <EmptyState message="No billing records for this month yet." />}

      {!loading && !error && billing.length > 0 && (
        <div className="card">
          {billing.map((b) => (
            <div className="list-item" key={b.billing_id}>
              <div>
                <strong>{students[b.student_id]?.full_name || b.student_id}</strong>
                <div style={{ fontSize: 13, color: 'var(--color-ink-soft)' }}>
                  Base ₹{b.base_fee} · Discount ₹{b.discount} · Late fee ₹{b.late_fee} · Payable ₹{b.payable} · Paid ₹{b.paid}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className={`badge ${b.status === 'paid' ? 'badge-success' : b.status === 'overdue' ? 'badge-danger' : 'badge-warning'}`}>
                  {b.status.replace('_', ' ')}
                </span>
                {b.status !== 'paid' && (
                  <button className="btn btn-outline" onClick={() => setPayFor(b)}>
                    {t('billing.recordPayment')}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {payFor && <RecordPaymentDrawer billing={payFor} onClose={() => setPayFor(null)} onDone={() => { setPayFor(null); load(); }} />}
      {showRangePayment && (
        <RecordRangePaymentDrawer defaultDateMode={paymentDateMode} onClose={() => setShowRangePayment(false)} onDone={() => { setShowRangePayment(false); load(); }} />
      )}
    </div>
  );
}

function RecordPaymentDrawer({ billing, onClose, onDone }) {
  const remaining = Math.max(0, Number(billing.payable) - Number(billing.paid));
  const [amount, setAmount] = useState(String(remaining));
  const [method, setMethod] = useState('cash');
  const [reference, setReference] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [recorded, setRecorded] = useState(null);

  async function submit() {
    setBusy(true);
    setError('');
    try {
      const res = await api.post('/payments', {
        studentId: billing.student_id,
        billingId: billing.billing_id,
        amount: Number(amount),
        paymentMethod: method,
        referenceNumber: reference,
      });
      setRecorded(res.data.payment);
    } catch (err) {
      setError(err?.response?.data?.error?.message || 'Unable to record payment.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        {recorded ? (
          <ReceiptReadyPanel payment={recorded} onDone={onDone} />
        ) : (
          <>
            <h3>Record payment</h3>
            <p style={{ color: 'var(--color-ink-soft)' }}>Remaining: ₹{remaining}</p>
            <div className="field">
              <label>Amount (₹)</label>
              <input className="input" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="field">
              <label>Method</label>
              <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="cash">Cash</option>
                <option value="upi">UPI</option>
              </select>
            </div>
            {method === 'upi' && (
              <div className="field">
                <label>Reference / transaction number</label>
                <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} />
              </div>
            )}
            {error && <p style={{ color: 'var(--color-danger)', fontSize: 13 }}>{error}</p>}
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button className="btn btn-primary" disabled={busy} onClick={submit}>
                Record payment
              </button>
              <button className="btn btn-outline" onClick={onClose}>
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Records a payment covering an arbitrary date range instead of a single
 * Monthly_Billing month — e.g. paying for a few weeks, or a period that
 * doesn't line up with a billing month. Not tied to any existing billing
 * record: the backend (paymentService.recordPayment) stores it with an
 * empty billing_id plus period_start/period_end, so it never affects
 * Monthly_Billing totals, status, or month-based reports.
 */
function RecordRangePaymentDrawer({ onClose, onDone, defaultDateMode = 'auto' }) {
  const [student, setStudent] = useState(null);
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [recorded, setRecorded] = useState(null);
  const [autoStatus, setAutoStatus] = useState(null);
  const [statusNotice, setStatusNotice] = useState('');
  const [dateMode, setDateMode] = useState(defaultDateMode);

  useEffect(() => {
    if (!student) {
      setAutoStatus(null);
      setStatusNotice('');
      setPeriodStart('');
      setPeriodEnd('');
      setAmount('');
      return;
    }
    let cancelled = false;
    api.get(`/students/${student.student_id}/payment-status`).then((res) => {
      if (cancelled) return;
      const status = res.data;
      setAutoStatus(status);
      // Use studentJoiningDate (student record) for From date prefill, not
      // allocation start_date — they can differ if the seat was allocated
      // retroactively to the 1st of the month.
      const prefillStart = status.studentJoiningDate || status.joinDate;
      if (status.paid > 0 && status.dueDate) {
        const [y, m, d] = status.dueDate.split('-').map(Number);
        const nextDayUtc = new Date(Date.UTC(y, m - 1, d + 1));
        setPeriodStart(nextDayUtc.toISOString().slice(0, 10));
        setStatusNotice(`Currently paid through ${formatDate(status.dueDate)}${status.amountDue > 0 ? ` · ₹${status.amountDue} due` : ''}.`);
      } else if (prefillStart) {
        setPeriodStart(prefillStart);
        const msg = status.paid > 0
          ? `₹${status.paid} paid · no due date yet — check monthly fee on allocation. Prefilled from joining date (${formatDate(prefillStart)}).`
          : `No payments on file yet — prefilled from joining date (${formatDate(prefillStart)}).`;
        setStatusNotice(msg);
      } else {
        setStatusNotice('No active seat allocation on file — enter the period manually.');
      }
    }).catch((err) => {
      if (!cancelled) setStatusNotice(`Could not load payment status: ${err?.response?.data?.error?.message || err?.message || 'unknown error'}`);
    });
    return () => { cancelled = true; };
  }, [student]);

  function calcEndDate(start, amt, fee) {
    if (!start || !amt || !fee) return '';
    const feeN = Number(fee);
    let remaining = Number(amt);
    if (!feeN || !remaining) return '';
    // Advance real calendar months, same logic as backend autoPaymentStatus.
    const [sy, sm, sd] = start.split('-').map(Number);
    let cursor = new Date(Date.UTC(sy, sm - 1, sd));
    while (remaining >= feeN) {
      remaining -= feeN;
      const ny = cursor.getUTCFullYear(), nm = cursor.getUTCMonth();
      const lastDay = new Date(Date.UTC(ny, nm + 2, 0)).getUTCDate();
      cursor = new Date(Date.UTC(ny, nm + 1, Math.min(cursor.getUTCDate(), lastDay)));
    }
    // Partial month — prorate by actual days in this calendar month.
    const ny = cursor.getUTCFullYear(), nm = cursor.getUTCMonth();
    const nextMonth = new Date(Date.UTC(ny, nm + 1, Math.min(cursor.getUTCDate(), new Date(Date.UTC(ny, nm + 2, 0)).getUTCDate())));
    const daysInMonth = Math.round((nextMonth - cursor) / 86400000);
    const extraDays = Math.floor((remaining / feeN) * daysInMonth);
    const end = new Date(cursor.getTime() + extraDays * 86400000);
    return end.toISOString().slice(0, 10);
  }

  function handleAmountChange(val) {
    setAmount(val);
    if (dateMode === 'auto') {
      setPeriodEnd(calcEndDate(periodStart, val, autoStatus?.monthlyFee));
    }
  }

  function handlePeriodStartChange(val) {
    setPeriodStart(val);
    if (dateMode === 'auto') {
      setPeriodEnd(calcEndDate(val, amount, autoStatus?.monthlyFee));
    }
  }

  async function submit() {
    if (!student || !periodStart || !periodEnd || !amount) {
      setError('Student, start date, end date and amount are required.');
      return;
    }
    if (periodEnd < periodStart) {
      setError('End date cannot be before start date.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await api.post('/payments', {
        studentId: student.student_id,
        periodStart,
        periodEnd,
        amount: Number(amount),
        paymentMethod: method,
        referenceNumber: reference,
        notes,
      });
      setRecorded(res.data.payment);
    } catch (err) {
      setError(err?.response?.data?.error?.message || 'Unable to record payment.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        {recorded ? (
          <ReceiptReadyPanel payment={recorded} onDone={onDone} />
        ) : (
          <>
            <h3>Record payment (date range)</h3>
            <p style={{ color: 'var(--color-ink-soft)', fontSize: 13 }}>
              For a payment covering a custom period rather than a single billing month — due
              status is worked out automatically from the joining date and fee, no Monthly_Billing
              record required.
            </p>
            {!student ? (
              <StudentSearchPicker onSelect={setStudent} />
            ) : (
              <div className="card" style={{ marginBottom: 12 }}>
                <strong>{student.full_name}</strong> ({student.student_id})
                <button className="btn btn-outline" style={{ marginLeft: 12 }} onClick={() => setStudent(null)}>
                  Change
                </button>
              </div>
            )}
            {statusNotice && <p style={{ fontSize: 12, color: 'var(--color-ink-soft)' }}>{statusNotice}</p>}
            {autoStatus?.monthlyFee && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, fontSize: 13 }}>
                <span style={{ color: 'var(--color-ink-soft)' }}>To date:</span>
                <label style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <input
                    type="radio"
                    name="dateMode"
                    checked={dateMode === 'auto'}
                    onChange={() => {
                      setDateMode('auto');
                      setPeriodEnd(calcEndDate(periodStart, amount, autoStatus.monthlyFee));
                    }}
                  />
                  Auto (from amount ÷ fee)
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <input
                    type="radio"
                    name="dateMode"
                    checked={dateMode === 'manual'}
                    onChange={() => setDateMode('manual')}
                  />
                  Manual
                </label>
              </div>
            )}
            <div style={{ display: 'flex', gap: 12 }}>
              <div className="field" style={{ flex: 1 }}>
                <label>From date</label>
                <input className="input" type="date" value={periodStart} onChange={(e) => handlePeriodStartChange(e.target.value)} />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label>To date</label>
                <input
                  className="input"
                  type="date"
                  value={periodEnd}
                  onChange={(e) => setPeriodEnd(e.target.value)}
                  readOnly={dateMode === 'auto'}
                  style={dateMode === 'auto' ? { background: 'var(--color-surface-subtle, #f5f5f5)', cursor: 'default' } : undefined}
                />
              </div>
            </div>
            <div className="field">
              <label>Amount (₹)</label>
              <input
                className="input"
                type="number"
                value={amount}
                onChange={(e) => handleAmountChange(e.target.value)}
                placeholder={autoStatus?.monthlyFee ? String(autoStatus.monthlyFee) : undefined}
              />
              {autoStatus?.monthlyFee && dateMode === 'auto' && (
                <div style={{ fontSize: 11, color: 'var(--color-ink-soft)', marginTop: 4 }}>
                  To date fills automatically: ₹{autoStatus.monthlyFee}/mo · 30 days per month.
                </div>
              )}
            </div>
            <div className="field">
              <label>Method</label>
              <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="cash">Cash</option>
                <option value="upi">UPI</option>
              </select>
            </div>
            {method === 'upi' && (
              <div className="field">
                <label>Reference / transaction number</label>
                <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} />
              </div>
            )}
            <div className="field">
              <label>Notes (optional)</label>
              <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            {error && <p style={{ color: 'var(--color-danger)', fontSize: 13 }}>{error}</p>}
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button className="btn btn-primary" disabled={busy} onClick={submit}>
                Record payment
              </button>
              <button className="btn btn-outline" onClick={onClose}>
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
