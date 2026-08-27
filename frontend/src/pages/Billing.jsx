import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import api, { apiErrorMessage, openReceipt } from '../services/api';
import { Loading, ErrorState, EmptyState } from '../components/AsyncState';
import StudentSearchPicker from '../components/StudentSearchPicker';

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
  const [showNewBilling, setShowNewBilling] = useState(false);
  const [payFor, setPayFor] = useState(null);
  const [showRangePayment, setShowRangePayment] = useState(false);

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
          <button className="btn btn-outline" onClick={() => setShowRangePayment(true)}>
            Record payment (date range)
          </button>
          <button className="btn btn-primary" onClick={() => setShowNewBilling(true)}>
            {t('billing.newBilling')}
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

      {showNewBilling && <NewBillingDrawer onClose={() => setShowNewBilling(false)} onDone={() => { setShowNewBilling(false); load(); }} />}
      {payFor && <RecordPaymentDrawer billing={payFor} onClose={() => setPayFor(null)} onDone={() => { setPayFor(null); load(); }} />}
      {showRangePayment && (
        <RecordRangePaymentDrawer onClose={() => setShowRangePayment(false)} onDone={() => { setShowRangePayment(false); load(); }} />
      )}
    </div>
  );
}

function NewBillingDrawer({ onClose, onDone }) {
  const [student, setStudent] = useState(null);
  const [billingMonth, setBillingMonth] = useState(new Date().toISOString().slice(0, 7));
  const [baseFee, setBaseFee] = useState('');
  const [discount, setDiscount] = useState('0');
  const [lateFee, setLateFee] = useState('0');
  const [dueDate, setDueDate] = useState('');
  const [feePlanNotice, setFeePlanNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // When a student is picked, prefill from their current fee plan (section
  // 16/17) — this is only a starting point, the admin can still type a
  // different amount (mid-month joining, section 19, always allows an
  // override; this billing record's own base_fee/discount are what get
  // saved, so a later fee-plan change never retroactively affects it).
  useEffect(() => {
    if (!student) {
      setFeePlanNotice('');
      return;
    }
    let cancelled = false;
    api.get(`/students/${student.student_id}/fee-plans`).then((res) => {
      if (cancelled) return;
      const current = res.data.current;
      if (current) {
        setBaseFee(String(current.monthly_fee));
        setDiscount(String(current.discount || 0));
        setFeePlanNotice(`Prefilled from current fee plan (effective since ${current.effective_from}). Edit if this month is different.`);
      } else {
        setFeePlanNotice('No fee plan on file for this student yet — enter the amount manually.');
      }
    }).catch(() => setFeePlanNotice(''));
    return () => { cancelled = true; };
  }, [student]);

  async function submit() {
    if (!student || !baseFee) {
      setError('Student and base fee are required.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.post('/billing', {
        studentId: student.student_id,
        billingMonth,
        baseFee: Number(baseFee),
        discount: Number(discount || 0),
        lateFee: Number(lateFee || 0),
        dueDate,
      });
      onDone();
    } catch (err) {
      setError(err?.response?.data?.error?.message || 'Unable to create billing record.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <h3>New billing record</h3>
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
        <div className="field">
          <label>Billing month</label>
          <input className="input" type="month" value={billingMonth} onChange={(e) => setBillingMonth(e.target.value)} />
        </div>
        {feePlanNotice && <p style={{ fontSize: 12, color: 'var(--color-ink-soft)' }}>{feePlanNotice}</p>}
        <div style={{ display: 'flex', gap: 12 }}>
          <div className="field" style={{ flex: 1 }}>
            <label>Base fee (₹)</label>
            <input className="input" type="number" value={baseFee} onChange={(e) => setBaseFee(e.target.value)} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Discount (₹)</label>
            <input className="input" type="number" value={discount} onChange={(e) => setDiscount(e.target.value)} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <div className="field" style={{ flex: 1 }}>
            <label>Late fee (₹)</label>
            <input className="input" type="number" value={lateFee} onChange={(e) => setLateFee(e.target.value)} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Due date</label>
            <input className="input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
        </div>
        {error && <p style={{ color: 'var(--color-danger)', fontSize: 13 }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button className="btn btn-primary" disabled={busy} onClick={submit}>
            Create
          </button>
          <button className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
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
function RecordRangePaymentDrawer({ onClose, onDone }) {
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

  // Prefill "From date" automatically once a student is picked — a
  // student's payment period always starts from where their coverage
  // actually left off: the day after whatever they're already paid
  // through, or their seat-joining date if this is their first payment
  // ever. No need to look anything up in Monthly_Billing for this.
  useEffect(() => {
    if (!student) {
      setAutoStatus(null);
      setStatusNotice('');
      setPeriodStart('');
      return;
    }
    let cancelled = false;
    api.get(`/students/${student.student_id}/payment-status`).then((res) => {
      if (cancelled) return;
      const status = res.data;
      setAutoStatus(status);
      if (status.paid > 0 && status.paidThroughDate) {
        const nextDay = new Date(`${status.paidThroughDate}T00:00:00`);
        nextDay.setDate(nextDay.getDate() + 1);
        setPeriodStart(nextDay.toISOString().slice(0, 10));
        setStatusNotice(`Currently paid through ${status.paidThroughDate}${status.balance > 0 ? ` · ₹${status.balance} due` : ''}.`);
      } else if (status.joinDate) {
        setPeriodStart(status.joinDate);
        setStatusNotice(`No payments on file yet — prefilled from their joining date (${status.joinDate}).`);
      } else {
        setStatusNotice('No active seat allocation on file — enter the period manually.');
      }
    }).catch(() => setStatusNotice(''));
    return () => { cancelled = true; };
  }, [student]);

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
            <div style={{ display: 'flex', gap: 12 }}>
              <div className="field" style={{ flex: 1 }}>
                <label>From date</label>
                <input className="input" type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label>To date</label>
                <input className="input" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
              </div>
            </div>
            <div className="field">
              <label>Amount (₹)</label>
              <input
                className="input"
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={autoStatus?.monthlyFee ? String(autoStatus.monthlyFee) : undefined}
              />
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
