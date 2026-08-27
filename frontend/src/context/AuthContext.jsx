import { createContext, useContext, useEffect, useState } from 'react';
import api from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem('lib_user');
    return raw ? JSON.parse(raw) : null;
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('lib_token');
    if (!token) {
      setLoading(false);
      return;
    }
    api
      .get('/auth/me')
      .then((res) => {
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

  async function loginAsAdmin(email, password) {
    const res = await api.post('/auth/admin/login', { email, password });
    persist(res.data);
    return res.data.user;
  }

  async function loginAsStudent(studentId, password) {
    const res = await api.post('/auth/student/login', { studentId, password });
    persist(res.data);
    return res.data.user;
  }

  function persist({ token, user }) {
    localStorage.setItem('lib_token', token);
    localStorage.setItem('lib_user', JSON.stringify({ ...user, type: user.role ? 'admin' : 'student' }));
    setUser({ ...user, type: user.role ? 'admin' : 'student' });
  }

  function logout() {
    localStorage.removeItem('lib_token');
    localStorage.removeItem('lib_user');
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, loginAsAdmin, loginAsStudent, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
