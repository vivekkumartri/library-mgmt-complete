import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import api, { apiErrorMessage } from '../services/api';
import { Loading, ErrorState } from '../components/AsyncState';
import { exportCsv, exportXlsx } from '../utils/exportTable';

const TABS = [
  ['financial', 'Financial'],
  ['students', 'Students'],
  ['seats', 'Seats'],
  ['payments', 'Payments'],
  ['attendance', 'Attendance'],
  ['expenses', 'Expenses'],
];

export default function Reports() {
  const { t } = useTranslation();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [tab, setTab] = useState('financial');
  const [financial, setFinancial] = useState(null);
  const [operational, setOperational] = useState(null);
  const [studentsReport, setStudentsReport] = useState(null);
  const [seatsReport, setSeatsReport] = useState(null);
  const [paymentsReport, setPaymentsReport] = useState(null);
  const [attendanceReport, setAttendanceReport] = useState(null);
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [editingExpense, setEditingExpense] = useState(null);
  const [voidingExpense, setVoidingExpense] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      if (tab === 'financial') {
        const [f, o] = await Promise.all([
          api.get('/reports/financial', { params: { month } }),
          api.get('/reports/operational'),
        ]);
        setFinancial(f.data);
        setOperational(o.data);
      } else if (tab === 'students') {
        const res = await api.get('/reports/students', { params: { month } });
        setStudentsReport(res.data);
      } else if (tab === 'seats') {
        const res = await api.get('/reports/seats');
        setSeatsReport(res.data);
      } else if (tab === 'payments') {
        const res = await api.get('/reports/payments', { params: { month } });
        setPaymentsReport(res.data);
      } else if (tab === 'attendance') {
        const res = await api.get('/reports/attendance', { params: { month } });
        setAttendanceReport(res.data);
      } else if (tab === 'expenses') {
        const res = await api.get('/expenses', { params: { from: `${month}-01`, to: `${month}-31`, includeVoid: true } });
        setExpenses(res.data.expenses);
      }
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [tab, month]);

  useEffect(() => {
    load();
  }, [load]);

  async function voidExpense(reason) {
    if (!voidingExpense) return;
    try {
      await api.post(`/expenses/${voidingExpense.expense_id}/void`, { reason });
      setVoidingExpense(null);
      load();
    } catch (err) {
      alert(apiErrorMessage(err));
    }
  }

  if (loading) return <Loading />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  return (
    <div>
      <div className="topbar">
        <h2 style={{ margin: 0 }}>{t('reportsPage.title')}</h2>
        <input className="input" type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ width: 160 }} />
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
        {TABS.map(([key, label]) => (
          <button
            key={key}
            className={`btn ${tab === key ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setTab(key)}
          >
            {t(`reportsPage.${key}`, label)}
          </button>
        ))}
      </div>

      {tab === 'financial' && financial && operational && (
        <FinancialTab financial={financial} operational={operational} month={month} />
      )}

      {tab === 'students' && studentsReport && <StudentsTab report={studentsReport} month={month} />}

      {tab === 'seats' && seatsReport && <SeatsTab report={seatsReport} />}

      {tab === 'payments' && paymentsReport && <PaymentsTab report={paymentsReport} month={month} />}

      {tab === 'attendance' && attendanceReport && <AttendanceTab report={attendanceReport} month={month} />}

      {tab === 'expenses' && (
        <ExpensesTab
          expenses={expenses}
          month={month}
          onAdd={() => setShowExpenseForm(true)}
          onEdit={(e) => setEditingExpense(e)}
          onVoid={(e) => setVoidingExpense(e)}
        />
      )}

      {showExpenseForm && (
        <ExpenseDrawer onClose={() => setShowExpenseForm(false)} onDone={() => { setShowExpenseForm(false); load(); }} />
      )}
      {editingExpense && (
        <ExpenseDrawer
          expense={editingExpense}
          onClose={() => setEditingExpense(null)}
          onDone={() => { setEditingExpense(null); load(); }}
        />
      )}
      {voidingExpense && (
        <VoidExpenseDrawer expense={voidingExpense} onClose={() => setVoidingExpense(null)} onConfirm={voidExpense} />
      )}
    </div>
  );
}

function ExportButtons({ rows, columns, filename }) {
  const { t } = useTranslation();
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <button className="btn btn-outline" onClick={() => exportCsv(rows, columns, filename)}>
        {t('reportsPage.exportCsv')}
      </button>
      <button className="btn btn-outline" onClick={() => exportXlsx(rows, columns, filename)}>
        {t('reportsPage.exportExcel')}
      </button>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}

function FinancialTab({ financial, operational, month }) {
  const rows = [{ ...financial, ...operational }];
  const columns = [
    ['month', 'Month'], ['expectedFees', 'Expected fees'], ['collected', 'Collected'],
    ['pendingFees', 'Pending'], ['overdueFees', 'Overdue'], ['totalExpenses', 'Expenses'],
    ['netIncome', 'Net income'], ['activeStudents', 'Active students'], ['pastStudents', 'Past students'],
    ['vacantSeats', 'Vacant seats'], ['disabledSeats', 'Disabled seats'], ['seatUtilizationPercent', 'Seat utilization %'],
  ];
  return (
    <div>
      <div className="topbar">
        <h3 style={{ margin: 0 }}>Financial &amp; operational</h3>
        <ExportButtons rows={rows} columns={columns} filename={`financial-report-${month}`} />
      </div>
      <div className="card-grid cols-3" style={{ marginBottom: 24 }}>
        <Stat label="Expected fees" value={`₹${financial.expectedFees}`} />
        <Stat label="Collected" value={`₹${financial.collected}`} />
        <Stat label="Pending" value={`₹${financial.pendingFees}`} />
        <Stat label="Overdue" value={`₹${financial.overdueFees}`} />
        <Stat label="Expenses" value={`₹${financial.totalExpenses}`} />
        <Stat label="Net income" value={`₹${financial.netIncome}`} />
      </div>
      <div className="card-grid cols-3">
        <Stat label="Active students" value={operational.activeStudents} />
        <Stat label="Past students" value={operational.pastStudents} />
        <Stat label="Vacant seats" value={operational.vacantSeats} />
        <Stat label="Disabled seats" value={operational.disabledSeats} />
        <Stat label="Seat utilization" value={`${operational.seatUtilizationPercent}%`} />
      </div>
    </div>
  );
}

function StudentsTab({ report, month }) {
  const columns = [
    ['studentId', 'Student ID'], ['fullName', 'Name'], ['mobile', 'Mobile'],
    ['status', 'Status'], ['joiningDate', 'Joining date'], ['leavingDate', 'Leaving date'],
  ];
  const allRows = [...report.active, ...report.past];
  return (
    <div>
      <div className="topbar">
        <h3 style={{ margin: 0 }}>Students</h3>
        <ExportButtons rows={allRows} columns={columns} filename={`students-report-${month}`} />
      </div>
      <div className="card-grid cols-3" style={{ marginBottom: 16 }}>
        <Stat label="Active" value={report.counts.active} />
        <Stat label="Past" value={report.counts.past} />
        <Stat label="New this month" value={report.counts.new} />
        <Stat label="Leaving this month" value={report.counts.leaving} />
      </div>
      <StudentTable title="New this month" rows={report.newThisMonth} />
      <StudentTable title="Leaving this month" rows={report.leavingThisMonth} />
    </div>
  );
}

function StudentTable({ title, rows }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <h4 style={{ marginBottom: 6 }}>{title}</h4>
      <div className="card">
        {rows.length === 0 && <p style={{ color: 'var(--color-ink-soft)', margin: 0 }}>None.</p>}
        {rows.map((s) => (
          <div className="list-item" key={s.studentId}>
            <span>{s.fullName} ({s.studentId})</span>
            <span style={{ color: 'var(--color-ink-soft)' }}>{s.joiningDate} {s.leavingDate ? `→ ${s.leavingDate}` : ''}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SeatsTab({ report }) {
  const columns = [
    ['floorName', 'Floor'], ['totalSeats', 'Total seats'], ['available', 'Available'],
    ['allocated', 'Allocated'], ['disabled', 'Disabled'],
  ];
  return (
    <div>
      <div className="topbar">
        <h3 style={{ margin: 0 }}>Seats — floor-wise</h3>
        <ExportButtons rows={report.byFloor} columns={columns} filename="seats-report" />
      </div>
      <div className="card" style={{ marginBottom: 16 }}>
        {report.byFloor.length === 0 && <p style={{ color: 'var(--color-ink-soft)', margin: 0 }}>No floors configured.</p>}
        {report.byFloor.map((f) => (
          <div className="list-item" key={f.floorId}>
            <strong>{f.floorName}</strong>
            <span style={{ color: 'var(--color-ink-soft)' }}>
              {f.totalSeats} total · {f.available} available · {f.allocated} allocated · {f.disabled} disabled
            </span>
          </div>
        ))}
      </div>
      <h4>Allocation conflicts</h4>
      <div className="card">
        {report.conflicts.length === 0 && <p style={{ color: 'var(--color-ink-soft)', margin: 0 }}>None — no overlapping allocations on the same seat.</p>}
        {report.conflicts.map((c, i) => (
          <div className="list-item" key={i}>
            <span>Seat {c.seatId}</span>
            <span className="badge badge-warning">Overlap</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PaymentsTab({ report, month }) {
  const columns = [['date', 'Date'], ['amount', 'Amount']];
  return (
    <div>
      <div className="topbar">
        <h3 style={{ margin: 0 }}>Payments</h3>
        <ExportButtons rows={report.dateWise} columns={columns} filename={`payments-report-${month}`} />
      </div>
      <div className="card-grid cols-3" style={{ marginBottom: 16 }}>
        <Stat label="Total collection" value={`₹${report.totalCollection}`} />
        <Stat label="Cash" value={`₹${report.cashTotal}`} />
        <Stat label="UPI" value={`₹${report.upiTotal}`} />
      </div>
      <h4>Date-wise collection</h4>
      <div className="card">
        {report.dateWise.length === 0 && <p style={{ color: 'var(--color-ink-soft)', margin: 0 }}>No payments this month.</p>}
        {report.dateWise.map((d) => (
          <div className="list-item" key={d.date}>
            <span>{d.date}</span>
            <span>₹{d.amount}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AttendanceTab({ report, month }) {
  const columns = [['date', 'Date'], ['present', 'Present'], ['absent', 'Absent']];
  return (
    <div>
      <div className="topbar">
        <h3 style={{ margin: 0 }}>Attendance</h3>
        <ExportButtons rows={report.dateWise} columns={columns} filename={`attendance-report-${month}`} />
      </div>
      <div className="card-grid cols-3" style={{ marginBottom: 16 }}>
        <Stat label="Marked" value={report.totalMarked} />
        <Stat label="Present" value={report.present} />
        <Stat label="Absent" value={report.absent} />
      </div>
      <div className="card">
        {report.dateWise.length === 0 && <p style={{ color: 'var(--color-ink-soft)', margin: 0 }}>No attendance recorded this month.</p>}
        {report.dateWise.map((d) => (
          <div className="list-item" key={d.date}>
            <span>{d.date}</span>
            <span style={{ color: 'var(--color-ink-soft)' }}>{d.present || 0} present · {d.absent || 0} absent</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ExpensesTab({ expenses, month, onAdd, onEdit, onVoid }) {
  const columns = [
    ['date', 'Date'], ['category', 'Category'], ['description', 'Description'],
    ['amount', 'Amount'], ['payment_mode', 'Payment mode'], ['status', 'Status'],
  ];
  return (
    <div>
      <div className="topbar">
        <h3 style={{ margin: 0 }}>Expenses</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <ExportButtons rows={expenses} columns={columns} filename={`expenses-report-${month}`} />
          <button className="btn btn-primary" onClick={onAdd}>
            Add expense
          </button>
        </div>
      </div>
      <div className="card">
        {expenses.length === 0 && <p style={{ color: 'var(--color-ink-soft)' }}>No expenses recorded this month.</p>}
        {expenses.map((e) => (
          <div className="list-item" key={e.expense_id}>
            <div>
              <strong>{e.category}</strong>
              <div style={{ fontSize: 13, color: 'var(--color-ink-soft)' }}>
                {e.date} · {e.description}
                {e.status === 'void' ? ` · VOID (${e.void_reason})` : ''}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>₹{e.amount}</span>
              {e.status !== 'void' && (
                <>
                  <button className="btn btn-outline" onClick={() => onEdit(e)}>Edit</button>
                  <button className="btn btn-danger-outline" onClick={() => onVoid(e)}>Void</button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const CATEGORIES = ['Rent', 'Electricity', 'Internet', 'Salary', 'Maintenance', 'Furniture', 'Cleaning', 'Other'];

function ExpenseDrawer({ expense, onClose, onDone }) {
  const isEdit = !!expense;
  const [date, setDate] = useState(expense?.date || new Date().toISOString().slice(0, 10));
  const [category, setCategory] = useState(expense?.category || CATEGORIES[0]);
  const [description, setDescription] = useState(expense?.description || '');
  const [amount, setAmount] = useState(expense?.amount ? String(expense.amount) : '');
  const [paymentMode, setPaymentMode] = useState(expense?.payment_mode || 'cash');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!amount) {
      setError('Amount is required.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (isEdit) {
        await api.patch(`/expenses/${expense.expense_id}`, { date, category, description, amount: Number(amount), payment_mode: paymentMode });
      } else {
        await api.post('/expenses', { date, category, description, amount: Number(amount), paymentMode });
      }
      onDone();
    } catch (err) {
      setError(apiErrorMessage(err, 'Unable to save expense.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <h3>{isEdit ? 'Edit expense' : 'Add expense'}</h3>
        <div className="field">
          <label>Date</label>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="field">
          <label>Category</label>
          <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Description</label>
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="field">
          <label>Amount (₹)</label>
          <input className="input" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div className="field">
          <label>Payment mode</label>
          <select className="input" value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)}>
            <option value="cash">Cash</option>
            <option value="upi">UPI</option>
            <option value="bank_transfer">Bank transfer</option>
          </select>
        </div>
        {error && <p style={{ color: 'var(--color-danger)', fontSize: 13 }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button className="btn btn-primary" disabled={busy} onClick={submit}>
            Save
          </button>
          <button className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function VoidExpenseDrawer({ expense, onClose, onConfirm }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  function submit() {
    if (!reason) {
      setError('A reason is required to void an expense.');
      return;
    }
    onConfirm(reason);
  }

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <h3>Void expense — {expense.category}</h3>
        <p style={{ fontSize: 13, color: 'var(--color-ink-soft)' }}>
          This keeps the expense in history marked void, rather than deleting it — it's removed from totals but stays auditable.
        </p>
        <div className="field">
          <label>Reason *</label>
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        {error && <p style={{ color: 'var(--color-danger)', fontSize: 13 }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button className="btn btn-danger" onClick={submit}>
            Void expense
          </button>
          <button className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
