import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { apiErrorMessage } from '../services/api';

export default function Login() {
  const { t } = useTranslation();
  const { loginAsAdmin, loginAsStudent } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState('admin');
  const [email, setEmail] = useState('');
  const [studentId, setStudentId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'admin') {
        await loginAsAdmin(email, password);
      } else {
        await loginAsStudent(studentId, password);
      }
      navigate('/');
    } catch (err) {
      setError(apiErrorMessage(err, t('login.invalid')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div className="card" style={{ width: '100%', maxWidth: 380 }}>
        <h2 style={{ textAlign: 'center' }}>{t('appName')}</h2>
        <p style={{ textAlign: 'center', color: 'var(--color-ink-soft)', marginBottom: 20 }}>
          {mode === 'admin' ? t('login.adminTitle') : t('login.studentTitle')}
        </p>
        <form onSubmit={handleSubmit}>
          {mode === 'admin' ? (
            <div className="field">
              <label htmlFor="email">{t('login.email')}</label>
              <input id="email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
            </div>
          ) : (
            <div className="field">
              <label htmlFor="studentId">{t('login.studentId')}</label>
              <input id="studentId" className="input" value={studentId} onChange={(e) => setStudentId(e.target.value)} required autoFocus placeholder="LIB-2026-0001" />
            </div>
          )}
          <div className="field">
            <label htmlFor="password">{t('login.password')}</label>
            <input id="password" className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          {error && <p style={{ color: 'var(--color-danger)', fontSize: 13 }}>{error}</p>}
          <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
            {busy ? t('common.loading') : t('login.submit')}
          </button>
        </form>
        <button className="btn btn-outline btn-block" style={{ marginTop: 12 }} onClick={() => setMode(mode === 'admin' ? 'student' : 'admin')}>
          {mode === 'admin' ? t('login.switchToStudent') : t('login.switchToAdmin')}
        </button>
      </div>
    </div>
  );
}
