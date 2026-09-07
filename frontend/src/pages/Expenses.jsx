import { useEffect, useState, useCallback } from 'react';
import api, { apiErrorMessage } from '../services/api';
import { Loading, ErrorState, EmptyState } from '../components/AsyncState';

const CATEGORIES = ['rent', 'utilities', 'salaries', 'maintenance', 'supplies', 'marketing', 'other'];

export default function Expenses() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const from = `${month}-01`;
      const to = `${month}-31`;
      const res = await api.get('/expenses', { params: { from, to } });
      setExpenses(res.data.expenses);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    load();
  }, [load]);

  async function deleteExpense(expense) {
    const reason = window.prompt(
      `Delete this expense (₹${expense.amount} · ${expense.category})? This voids it and keeps it in the audit trail. Enter a reason:`
    );
    if (reason === null) return;
    if (!reason.trim()) {
      setNotice('A reason is required to delete an expense.');
      return;
    }
    try {
      await api.post(`/expenses/${expense.expense_id}/void`, { reason: reason.trim() });
      setNotice('Expense deleted.');
      load();
    } catch (err) {
      setNotice(apiErrorMessage(err));
    }
  }

  const total = expenses.reduce((sum, e) => sum + Number(e.amount), 0);

  return (
    <div>
      <div className="topbar">
        <h2 style={{ margin: 0 }}>Expenses</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="input" type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ width: 160 }} />
          <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
            Add expense
          </button>
        </div>
      </div>

      {notice && (
        <div className="card" style={{ marginBottom: 16, background: 'var(--color-info-soft)' }}>
          {notice}
        </div>
      )}

      {loading && <Loading />}
      {error && !loading && <ErrorState message={error} onRetry={load} />}
      {!loading && !error && expenses.length === 0 && <EmptyState message="No expenses recorded for this month yet." />}

      {!loading && !error && expenses.length > 0 && (
        <div className="card">
          <div className="list-item" style={{ fontWeight: 600 }}>
            <span>Total this month</span>
            <span>₹{total}</span>
          </div>
          {expenses.map((e) => (
            <div className="list-item" key={e.expense_id}>
              <div>
                <strong>{e.category}</strong>
                <div style={{ fontSize: 13, color: 'var(--color-ink-soft)' }}>
                  {e.date} · {e.description || 'No description'}
                  {e.payment_mode ? ` · ${e.payment_mode.toUpperCase()}` : ''}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>₹{e.amount}</span>
                <button className="btn btn-danger" onClick={() => deleteExpense(e)}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showAdd && (
        <AddExpenseDrawer
          onClose={() => setShowAdd(false)}
          onDone={() => {
            setShowAdd(false);
            setNotice('Expense added.');
            load();
          }}
        />
      )}
    </div>
  );
}

function AddExpenseDrawer({ onClose, onDone }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [paymentMode, setPaymentMode] = useState('cash');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!date || !category || !amount) {
      setError('Date, category and amount are required.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.post('/expenses', {
        date, category, description, amount: Number(amount), paymentMode, notes,
      });
      onDone();
    } catch (err) {
      setError(apiErrorMessage(err, 'Unable to add expense.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <h3>Add expense</h3>
        <div style={{ display: 'flex', gap: 12 }}>
          <div className="field" style={{ flex: 1 }}>
            <label>Date</label>
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Category</label>
            <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c.charAt(0).toUpperCase() + c.slice(1)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label>Description</label>
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <div className="field" style={{ flex: 1 }}>
            <label>Amount (₹)</label>
            <input className="input" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Payment mode</label>
            <select className="input" value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)}>
              <option value="cash">Cash</option>
              <option value="upi">UPI</option>
              <option value="bank_transfer">Bank transfer</option>
              <option value="card">Card</option>
            </select>
          </div>
        </div>
        <div className="field">
          <label>Notes (optional)</label>
          <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        {error && <p style={{ color: 'var(--color-danger)', fontSize: 13 }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button className="btn btn-primary" disabled={busy} onClick={submit}>
            Add expense
          </button>
          <button className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
