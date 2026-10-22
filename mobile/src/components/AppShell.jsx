import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';

const ADMIN_NAV = [
  { to: '/', key: 'dashboard', icon: '\u25A6' },
  { to: '/seats', key: 'floors', icon: '\u2637' },
  { to: '/students', key: 'students', icon: '\u1F464'.slice(0, 1) || 'S' },
  { to: '/students/past', key: 'pastStudents', icon: '\u21BB' },
  { to: '/billing', key: 'billing', icon: '\u20B9' },
  { to: '/expenses', key: 'expenses', icon: '\u2212' },
  { to: '/attendance', key: 'attendance', icon: '\u2713' },
  { to: '/notices', key: 'notices', icon: '\u1F514'.slice(0, 1) || 'N' },
  { to: '/reports', key: 'reports', icon: '\u2261' },
  { to: '/admins', key: 'admins', icon: '\u2699' },
  { to: '/settings', key: 'settings', icon: '\u2699' },
];

// Bottom nav only has room for a few quick-access items — everything else
// (Attendance, Notices, Reports, Admins, Settings, Past Students) lives
// behind the "More" sheet below rather than disappearing on mobile.
const ADMIN_NAV_MOBILE = [ADMIN_NAV[0], ADMIN_NAV[1], ADMIN_NAV[2], ADMIN_NAV[4]]; // dashboard, seats, students, billing
const ADMIN_NAV_MORE = ADMIN_NAV.filter((item) => !ADMIN_NAV_MOBILE.includes(item));

const STUDENT_NAV = [
  { to: '/', key: 'home', icon: 'H' },
  { to: '/my-seat', key: 'mySeat', icon: 'S' },
  { to: '/fees', key: 'fees', icon: '\u20B9' },
  { to: '/library', key: 'library', icon: '\u2139' },
  { to: '/profile', key: 'profile', icon: 'P' },
];

const STUDENT_NAV_MOBILE = [STUDENT_NAV[0], STUDENT_NAV[1], STUDENT_NAV[2], STUDENT_NAV[4]]; // home, seat, fees, profile
const STUDENT_NAV_MORE = STUDENT_NAV.filter((item) => !STUDENT_NAV_MOBILE.includes(item));

export default function AppShell({ children }) {
  const { t, i18n } = useTranslation();
  const { user, logout } = useAuth();
  const isAdmin = user?.type === 'admin';
  const navFull = isAdmin ? ADMIN_NAV : STUDENT_NAV;
  const navMobile = isAdmin ? ADMIN_NAV_MOBILE : STUDENT_NAV_MOBILE;
  const navMore = isAdmin ? ADMIN_NAV_MORE : STUDENT_NAV_MORE;
  const [showMore, setShowMore] = useState(false);

  function toggleLang() {
    const next = i18n.language === 'en' ? 'hi' : 'en';
    i18n.changeLanguage(next);
    localStorage.setItem('lib_lang', next);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <h3 style={{ padding: '0 8px' }}>{t('appName')}</h3>
        {navFull.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.to === '/'} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
            <span>{item.icon}</span>
            <span>{t(`nav.${item.key}`)}</span>
          </NavLink>
        ))}
        <div style={{ marginTop: 'auto', paddingTop: 16 }}>
          <button className="btn btn-outline btn-block" onClick={toggleLang} style={{ marginBottom: 8 }}>
            {i18n.language === 'en' ? 'हिंदी' : 'English'}
          </button>
          <button className="btn btn-outline btn-block" onClick={logout}>
            {t('nav.logout')}
          </button>
        </div>
      </aside>

      <main className="app-main">
        <div className="topbar">
          <div />
          <div style={{ display: 'flex', gap: 8 }} className="show-mobile-only">
            <button className="btn btn-outline" onClick={toggleLang}>
              {i18n.language === 'en' ? 'हिं' : 'EN'}
            </button>
          </div>
        </div>
        {children}
      </main>

      <nav className="bottom-nav">
        {navMobile.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
            <span>{item.icon}</span>
            <span>{t(`nav.${item.key}`)}</span>
          </NavLink>
        ))}
        <button type="button" className="bottom-nav-more-btn" onClick={() => setShowMore(true)} aria-label={t('nav.more', 'More')}>
          <span>&#8942;</span>
          <span>{t('nav.more', 'More')}</span>
        </button>
      </nav>

      {showMore && (
        <div className="drawer-backdrop show-mobile-only" onClick={() => setShowMore(false)}>
          <div className="drawer more-sheet" onClick={(e) => e.stopPropagation()}>
            <h3>{t('nav.more', 'More')}</h3>
            {navMore.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
                onClick={() => setShowMore(false)}
              >
                <span>{item.icon}</span>
                <span>{t(`nav.${item.key}`)}</span>
              </NavLink>
            ))}
            <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button className="btn btn-outline btn-block" onClick={toggleLang}>
                {i18n.language === 'en' ? 'हिंदी' : 'English'}
              </button>
              <button className="btn btn-outline btn-block" onClick={logout}>
                {t('nav.logout')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
