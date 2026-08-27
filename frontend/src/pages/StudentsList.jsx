import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import api, { apiErrorMessage } from '../services/api';
import { Loading, ErrorState, EmptyState } from '../components/AsyncState';

const URGENCY_BADGE_CLASS = {
  overdue: 'badge-danger',
  due_today: 'badge-danger',
  due_soon: 'badge-warning',
};

export default function StudentsList({ statusFilter = 'active' }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [students, setStudents] = useState([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/students', { params: { status: statusFilter, q: q || undefined } });
      setStudents(res.data.students);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, q]);

  useEffect(() => {
    const timeout = setTimeout(load, 250);
    return () => clearTimeout(timeout);
  }, [load]);

  return (
    <div>
      <div className="topbar">
        <h2 style={{ margin: 0 }}>{statusFilter === 'active' ? t('nav.students') : t('nav.pastStudents')}</h2>
        {statusFilter === 'active' && (
          <Link to="/students/new" className="btn btn-primary">
            {t('students.addStudent')}
          </Link>
        )}
      </div>

      <input className="input" placeholder={t('students.search')} value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 16 }} />

      {loading && <Loading />}
      {error && !loading && <ErrorState message={error} onRetry={load} />}
      {!loading && !error && students.length === 0 && <EmptyState />}

      {!loading && !error && students.length > 0 && (
        <div className="card">
          {students.map((s) => (
            <div key={s.student_id} className="list-item" style={{ cursor: 'pointer' }} onClick={() => navigate(`/students/${s.student_id}`)}>
              <div>
                <strong>{s.full_name}</strong>
                <div style={{ fontSize: 13, color: 'var(--color-ink-soft)' }}>
                  {s.student_id} · {s.mobile}
                  {statusFilter !== 'active' && s.leaving_date ? ` · Left ${s.leaving_date}` : ''}
                  {s.paymentDueDate ? ` · Due ${s.paymentDueDate}` : ''}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {s.paymentUrgency && s.paymentUrgency !== 'ok' && (
                  <span className={`badge ${URGENCY_BADGE_CLASS[s.paymentUrgency]}`}>{s.paymentUrgency.replace('_', ' ')}</span>
                )}
                <span className={`badge ${s.status === 'active' ? 'badge-success' : 'badge-neutral'}`}>{s.status}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
