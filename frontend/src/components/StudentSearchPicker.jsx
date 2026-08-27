import { useState } from 'react';
import api, { apiErrorMessage } from '../services/api';

export default function StudentSearchPicker({ onSelect }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function search(value) {
    setQ(value);
    if (!value || value.length < 2) {
      setResults([]);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await api.get('/students', { params: { q: value, status: 'active' } });
      setResults(res.data.students);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="field">
      <label>Search student</label>
      <input className="input" value={q} onChange={(e) => search(e.target.value)} placeholder="Name, ID, or mobile" />
      {busy && <p style={{ fontSize: 13, color: 'var(--color-ink-soft)' }}>Searching…</p>}
      {error && <p style={{ fontSize: 13, color: 'var(--color-danger)' }}>{error}</p>}
      {results.map((s) => (
        <button key={s.student_id} className="list-item" style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none' }} onClick={() => onSelect(s)}>
          <div>
            <strong>{s.full_name}</strong>
            <div style={{ fontSize: 13, color: 'var(--color-ink-soft)' }}>
              {s.student_id} · {s.mobile}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}
