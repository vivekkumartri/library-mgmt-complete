import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import api, { apiErrorMessage } from '../services/api';
import { Loading, ErrorState } from '../components/AsyncState';
import { MiniBarChart, MiniLineChart, DonutBreakdown } from '../components/charts/MiniCharts';

export default function Dashboard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [today, setToday] = useState(null);
  const [paymentDue, setPaymentDue] = useState(null);
  const [financial, setFinancial] = useState(null);
  const [operational, setOperational] = useState(null);
  const [studentsReport, setStudentsReport] = useState(null);
  const [seatsReport, setSeatsReport] = useState(null);
  const [paymentsReport, setPaymentsReport] = useState(null);
  const [attendanceReport, setAttendanceReport] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [t1, t2, f, o, s, seats, pay, att] = await Promise.all([
        api.get('/dashboard/today'),
        api.get('/dashboard/payment-due'),
        api.get('/reports/financial', { params: { month } }),
        api.get('/reports/operational'),
        api.get('/reports/students', { params: { month } }),
        api.get('/reports/seats'),
        api.get('/reports/payments', { params: { month } }),
        api.get('/reports/attendance', { params: { month } }),
      ]);
      setToday(t1.data);
      setPaymentDue(t2.data.paymentDue);
      setFinancial(f.data);
      setOperational(o.data);
      setStudentsReport(s.data);
      setSeatsReport(seats.data);
      setPaymentsReport(pay.data);
      setAttendanceReport(att.data);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <Loading />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  const stats = [
    { label: t('dashboard.activeStudents'), value: today.totalActiveStudents },
    { label: t('dashboard.present'), value: today.studentsPresent },
    { label: t('dashboard.totalSeats'), value: today.totalSeats },
    { label: t('dashboard.availableSeats'), value: today.availableSeats },
    { label: t('dashboard.todaysPayments'), value: `₹${today.todaysPayments}` },
    { label: t('dashboard.todaysExpenses'), value: `₹${today.todaysExpenses}` },
  ];

  return (
    <div>
      <div className="topbar">
        <h2 style={{ margin: 0 }}>{t('dashboard.today')}</h2>
        <input className="input" type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ width: 160 }} />
      </div>
      <div className="card-grid cols-3" style={{ marginBottom: 24 }}>
        {stats.map((s) => (
          <div className="card" key={s.label}>
            <div className="stat-label">{s.label}</div>
            <div className="stat-value">{s.value}</div>
          </div>
        ))}
      </div>

      <h3>{t('dashboard.paymentDue')}</h3>
      <div className="card" style={{ marginBottom: 24 }}>
        {paymentDue.length === 0 && <p style={{ color: 'var(--color-ink-soft)' }}>{t('common.noResults')}</p>}
        {paymentDue.map((p) => (
          <div className="list-item" key={p.billingId}>
            <div>
              <strong>{p.studentName}</strong>
              <div style={{ fontSize: 13, color: 'var(--color-ink-soft)' }}>{p.billingMonth}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ textAlign: 'right' }}>
                <div>₹{p.amountDue}</div>
                <span className={`badge ${p.status === 'overdue' ? 'badge-danger' : p.status === 'due_today' ? 'badge-warning' : 'badge-neutral'}`}>
                  {p.status.replace('_', ' ')}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-outline" onClick={() => navigate(`/students/${p.studentId}`)}>
                  View student
                </button>
                <button className="btn btn-primary" onClick={() => navigate('/billing')}>
                  Record payment
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <h3>Financial — {month}</h3>
      <div className="card-grid cols-3" style={{ marginBottom: 16 }}>
        <Stat label="Expected fees" value={`₹${financial.expectedFees}`} />
        <Stat label="Collected" value={`₹${financial.collected}`} />
        <Stat label="Pending" value={`₹${financial.pendingFees}`} />
        <Stat label="Overdue" value={`₹${financial.overdueFees}`} />
        <Stat label="Expenses" value={`₹${financial.totalExpenses}`} />
        <Stat label="Net income" value={`₹${financial.netIncome}`} />
      </div>

      <h3>Operational</h3>
      <div className="card-grid cols-3" style={{ marginBottom: 24 }}>
        <Stat label="Active students" value={operational.activeStudents} />
        <Stat label="New this month" value={studentsReport.counts.new} />
        <Stat label="Leaving this month" value={studentsReport.counts.leaving} />
        <Stat label="Vacant seats" value={operational.vacantSeats} />
        <Stat label="Disabled seats" value={operational.disabledSeats} />
        <Stat label="Seat utilization" value={`${operational.seatUtilizationPercent}%`} />
      </div>

      <div className="card-grid cols-2" style={{ marginBottom: 24 }}>
        <div className="card">
          <h4 style={{ marginTop: 0 }}>Fee collection vs outstanding</h4>
          <MiniBarChart
            data={[
              { label: 'Collected', value: financial.collected },
              { label: 'Pending', value: financial.pendingFees },
              { label: 'Overdue', value: financial.overdueFees },
            ]}
            valueFormatter={(v) => `₹${v}`}
          />
        </div>
        <div className="card">
          <h4 style={{ marginTop: 0 }}>Revenue vs expenses vs net income</h4>
          <MiniBarChart
            data={[
              { label: 'Revenue', value: financial.collected },
              { label: 'Expenses', value: financial.totalExpenses },
              { label: 'Net income', value: Math.max(0, financial.netIncome) },
            ]}
            valueFormatter={(v) => `₹${v}`}
          />
        </div>
        <div className="card">
          <h4 style={{ marginTop: 0 }}>Floor-wise occupancy</h4>
          <MiniBarChart
            data={seatsReport.byFloor.map((f) => ({ label: f.floorName, value: f.allocated }))}
          />
        </div>
        <div className="card">
          <h4 style={{ marginTop: 0 }}>Payment method breakdown</h4>
          <DonutBreakdown
            segments={[
              { label: 'Cash', value: paymentsReport.cashTotal, color: '#2f6f5e' },
              { label: 'UPI', value: paymentsReport.upiTotal, color: '#c9a13b' },
            ]}
          />
        </div>
        <div className="card">
          <h4 style={{ marginTop: 0 }}>Attendance trend</h4>
          <MiniLineChart points={attendanceReport.dateWise.map((d) => ({ value: d.present || 0 }))} />
        </div>
        <div className="card">
          <h4 style={{ marginTop: 0 }}>New vs past students</h4>
          <DonutBreakdown
            segments={[
              { label: 'Active', value: studentsReport.counts.active, color: '#2f6f5e' },
              { label: 'Past', value: studentsReport.counts.past, color: '#c2554b' },
            ]}
          />
        </div>
      </div>

      <div style={{ marginTop: 8 }}>
        <Link to="/seats" className="btn btn-primary">
          {t('nav.floors')}
        </Link>
      </div>
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
