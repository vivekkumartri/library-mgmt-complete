import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import api, { apiErrorMessage } from '../services/api';
import { Loading, ErrorState, EmptyState } from '../components/AsyncState';

export default function Attendance() {
  const { t } = useTranslation();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [summary, setSummary] = useState(null);
  const [students, setStudents] = useState([]);
  const [attendance, setAttendance] = useState({});
  const [markedAt, setMarkedAt] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [dash, s, a] = await Promise.all([
        api.get('/attendance/dashboard', { params: { date } }),
        api.get('/students', { params: { status: 'active' } }),
        api.get('/attendance', { params: { date } }),
      ]);
      setSummary(dash.data);
      setStudents(s.data.students);
      setAttendance(Object.fromEntries(a.data.attendance.map((r) => [r.student_id, r.status])));
      setMarkedAt(Object.fromEntries(a.data.attendance.map((r) => [r.student_id, r.marked_at])));
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    load();
  }, [load]);

  async function mark(studentId, status) {
    const previous = attendance[studentId];
    const previousMarkedAt = markedAt[studentId];
    setAttendance((a) => ({ ...a, [studentId]: status }));
    setMarkedAt((m) => ({ ...m, [studentId]: new Date().toISOString() }));
    setError('');
    try {
      await api.post('/attendance', { studentId, date, status });
    } catch (err) {
      // Revert just this student's optimistic update rather than reloading
      // the whole screen — a full load() here would also clear the error
      // message we're about to set (load() clears error as its first line).
      setAttendance((a) => ({ ...a, [studentId]: previous }));
      setMarkedAt((m) => ({ ...m, [studentId]: previousMarkedAt }));
      setError(apiErrorMessage(err));
    }
  }

  const filtered = students.filter((s) => s.full_name.toLowerCase().includes(q.toLowerCase()) || s.student_id.toLowerCase().includes(q.toLowerCase()));

  return (
    <div>
      <div className="topbar">
        <h2 style={{ margin: 0 }}>{t('attendance.title')}</h2>
        <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: 170 }} />
      </div>

      {loading && <Loading />}
      {error && !loading && <ErrorState message={error} onRetry={load} />}

      {!loading && summary && (
        <div className="card-grid cols-4" style={{ marginBottom: 16 }}>
          <div className="card">
            <div className="stat-label">{t('attendance.present')}</div>
            <div className="stat-value">{summary.present}</div>
          </div>
          <div className="card">
            <div className="stat-label">{t('attendance.absent')}</div>
            <div className="stat-value">{summary.absent}</div>
          </div>
          <div className="card">
            <div className="stat-label">{t('attendance.notMarked')}</div>
            <div className="stat-value">{summary.notMarked}</div>
          </div>
          <div className="card">
            <div className="stat-label">{t('attendance.percentage')}</div>
            <div className="stat-value">{summary.attendancePercentage}%</div>
          </div>
        </div>
      )}

      {!loading && !error && (
        <>
          <input className="input" placeholder={t('attendance.search')} value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 12 }} />
          {filtered.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="card">
              {filtered.map((s) => (
                <div className="list-item" key={s.student_id}>
                  <div>
                    <strong>{s.full_name}</strong>
                    <div style={{ fontSize: 13, color: 'var(--color-ink-soft)' }}>
                      {s.student_id}
                      {markedAt[s.student_id]
                        ? ` · Marked at ${new Date(markedAt[s.student_id]).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                        : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      className="btn"
                      style={{ background: attendance[s.student_id] === 'present' ? 'var(--color-success)' : undefined, color: attendance[s.student_id] === 'present' ? 'white' : undefined }}
                      onClick={() => mark(s.student_id, 'present')}
                    >
                      {t('attendance.present')}
                    </button>
                    <button
                      className="btn"
                      style={{ background: attendance[s.student_id] === 'absent' ? 'var(--color-danger)' : undefined, color: attendance[s.student_id] === 'absent' ? 'white' : undefined }}
                      onClick={() => mark(s.student_id, 'absent')}
                    >
                      {t('attendance.absent')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
