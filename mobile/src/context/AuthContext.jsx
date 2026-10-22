import { createContext, useContext, useEffect, useRef, useState } from 'react';
import api from '../services/api';
import {
  biometricsSupported, isBiometricAvailable, hasStoredBiometricLogin,
  enableBiometricLogin, disableBiometricLogin, unlockWithBiometrics,
} from '../utils/biometricAuth';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem('lib_user');
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      localStorage.removeItem('lib_user');
      return null;
    }
  });
  const [loading, setLoading] = useState(true);
  // Tracks whatever refresh token this session's login/refresh most
  // recently issued, purely so logout() can revoke it server-side without
  // re-prompting biometrics just to read it back out of secure storage.
  // Never persisted — a fresh app launch starts with this empty, which is
  // fine: there's nothing to revoke until the user logs in again.
  const currentRefreshTokenRef = useRef(null);
  const [hasBiometricsEnabled, setHasBiometricsEnabled] = useState(false);
  const [biometricsAvailable, setBiometricsAvailable] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('lib_token');
    if (!token) {
      setLoading(false);
      return;
    }
    api
      .get('/auth/me')
      .then((res) => {
        if (!res.data?.user) throw new Error('Malformed /auth/me response');
        setUser(res.data.user);
        localStorage.setItem('lib_user', JSON.stringify(res.data.user));
      })
      .catch(() => {
        localStorage.removeItem('lib_token');
        localStorage.removeItem('lib_user');
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  async function loginAsAdmin(email, password, { wantsRefreshToken = false } = {}) {
    const res = await api.post('/auth/admin/login', { email, password, wantsRefreshToken });
    persist(res.data);
    return res.data;
  }

  async function loginAsStudent(studentId, password, { wantsRefreshToken = false } = {}) {
    const res = await api.post('/auth/student/login', { studentId, password, wantsRefreshToken });
    persist(res.data);
    return res.data;
  }

  /**
   * Re-enters the app without a password using a refresh token that was
   * previously stashed behind the device's biometric/passcode gate
   * (enableBiometricLogin). The native prompt (Face ID / fingerprint) is
   * triggered by unlockWithBiometrics() itself, before this ever reaches
   * the network.
   */
  async function loginWithBiometrics() {
    const { refreshToken } = await unlockWithBiometrics();
    const res = await api.post('/auth/refresh', { refreshToken });
    persist(res.data);
    // The server rotates the refresh token on every use — re-save the new
    // one so the next unlock still works (the old one is now revoked).
    if (res.data.refreshToken) {
      await enableBiometricLogin({ username: res.data.user.id, refreshToken: res.data.refreshToken });
    }
    return res.data;
  }

  /** Call after a password login to turn on "unlock with Face ID/fingerprint" for next time. */
  async function enableBiometrics(refreshToken = currentRefreshTokenRef.current) {
    if (!refreshToken) throw new Error('No refresh token on this session — log in with wantsRefreshToken first.');
    await enableBiometricLogin({ username: user?.id, refreshToken });
    setHasBiometricsEnabled(true);
  }

  function persist({ token, user: userData, refreshToken }) {
    if (refreshToken) currentRefreshTokenRef.current = refreshToken;
    localStorage.setItem('lib_token', token);
    localStorage.setItem('lib_user', JSON.stringify({ ...userData, type: userData.role ? 'admin' : 'student' }));
    setUser({ ...userData, type: userData.role ? 'admin' : 'student' });
  }

  async function logout() {
    try {
      if (currentRefreshTokenRef.current) {
        await api.post('/auth/logout', { refreshToken: currentRefreshTokenRef.current });
      }
    } catch {
      // Best-effort server-side revoke — never block signing out locally on this.
    }
    currentRefreshTokenRef.current = null;
    await disableBiometricLogin();
    setHasBiometricsEnabled(false);
    localStorage.removeItem('lib_token');
    localStorage.removeItem('lib_user');
    setUser(null);
  }

  useEffect(() => {
    if (!biometricsSupported()) return;
    isBiometricAvailable().then(setBiometricsAvailable);
    hasStoredBiometricLogin().then(setHasBiometricsEnabled);
  }, [user]);

  return (
    <AuthContext.Provider
      value={{
        user, loading, loginAsAdmin, loginAsStudent, loginWithBiometrics, logout,
        enableBiometrics, biometricsAvailable, hasBiometricsEnabled, biometricsSupported: biometricsSupported(),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
