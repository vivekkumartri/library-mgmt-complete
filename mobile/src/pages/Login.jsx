import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { apiErrorMessage } from '../services/api';

export default function Login() {
  const { t } = useTranslation();
  const {
    loginAsAdmin, loginAsStudent, loginWithBiometrics, enableBiometrics,
    biometricsSupported, biometricsAvailable, hasBiometricsEnabled,
  } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState('admin');
  const [email, setEmail] = useState('');
  const [studentId, setStudentId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [offerBiometrics, setOfferBiometrics] = useState(null); // refreshToken, once offered

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const wantsRefreshToken = biometricsSupported && biometricsAvailable && !hasBiometricsEnabled;
      const result = mode === 'admin'
        ? await loginAsAdmin(email.trim().toLowerCase(), password, { wantsRefreshToken })
        : await loginAsStudent(studentId, password, { wantsRefreshToken });
      if (wantsRefreshToken && result.refreshToken) {
        // Ask before turning this on rather than silently storing a
        // biometric-unlockable credential the user never asked for.
        setOfferBiometrics(result.refreshToken);
        return;
      }
      navigate('/');
    } catch (err) {
      setError(apiErrorMessage(err, t('login.invalid')));
    } finally {
      setBusy(false);
    }
  }

  async function handleBiometricUnlock() {
    setError('');
    setBusy(true);
    try {
      await loginWithBiometrics();
      navigate('/');
    } catch (err) {
      // User cancelled the prompt, or nothing was stored yet — stay on
      // the password form rather than showing a scary error for either.
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnableBiometrics(enable) {
    if (enable && offerBiometrics) {
      try {
        await enableBiometrics(offerBiometrics);
      } catch {
        // Non-fatal — the password login itself already succeeded.
      }
    }
    setOfferBiometrics(null);
    navigate('/');
  }

  if (offerBiometrics) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <div className="card" style={{ width: '100%', maxWidth: 380, textAlign: 'center' }}>
          <h3>Use Face ID / fingerprint next time?</h3>
          <p style={{ color: 'var(--color-ink-soft)', fontSize: 14 }}>
            Skip typing your password on this device — you can turn this off later from Settings.
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button className="btn btn-primary btn-block" onClick={() => confirmEnableBiometrics(true)}>
              Enable
            </button>
            <button className="btn btn-outline btn-block" onClick={() => confirmEnableBiometrics(false)}>
              Not now
            </button>
          </div>
        </div>
      </div>
    );
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
        {biometricsSupported && hasBiometricsEnabled && (
          <button className="btn btn-outline btn-block" style={{ marginTop: 12 }} disabled={busy} onClick={handleBiometricUnlock}>
            Unlock with Face ID / fingerprint
          </button>
        )}
        <button className="btn btn-outline btn-block" style={{ marginTop: 12 }} onClick={() => setMode(mode === 'admin' ? 'student' : 'admin')}>
          {mode === 'admin' ? t('login.switchToStudent') : t('login.switchToAdmin')}
        </button>
      </div>
    </div>
  );
}
