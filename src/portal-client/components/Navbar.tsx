import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { t, type Lang } from '../i18n';

const LANGS: { value: Lang; label: string }[] = [
  { value: 'ko', label: '한국어' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
];

export default function Navbar() {
  const { account, lang, setLang, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  return (
    <nav className="portal-nav">
      <div className="portal-nav-logo">
        <span>Exocad Portal</span>
      </div>

      {account && (
        <div className="portal-nav-links">
          <NavLink
            to="/dashboard"
            className={({ isActive }) => `portal-nav-link${isActive ? ' active' : ''}`}
          >
            {t(lang, 'dashboard')}
          </NavLink>
          <NavLink
            to="/requests"
            className={({ isActive }) => `portal-nav-link${isActive ? ' active' : ''}`}
          >
            {t(lang, 'requests')}
          </NavLink>
          <NavLink
            to="/setup"
            className={({ isActive }) => `portal-nav-link${isActive ? ' active' : ''}`}
          >
            {t(lang, 'link_serial_title')}
          </NavLink>
          <NavLink
            to="/profile"
            className={({ isActive }) => `portal-nav-link${isActive ? ' active' : ''}`}
          >
            {t(lang, 'profile')}
          </NavLink>
        </div>
      )}

      <div className="portal-nav-user">
        <select
          value={lang}
          onChange={e => setLang(e.target.value as Lang)}
          style={{
            background: 'var(--bg3)',
            border: '1px solid var(--border2)',
            color: 'var(--text2)',
            borderRadius: 6,
            padding: '4px 8px',
            fontSize: 12,
            fontFamily: 'inherit',
            cursor: 'pointer',
          }}
        >
          {LANGS.map(l => (
            <option key={l.value} value={l.value}>{l.label}</option>
          ))}
        </select>

        {account && (
          <button className="btn btn-ghost btn-sm" onClick={handleLogout}>
            {t(lang, 'logout')}
          </button>
        )}
      </div>
    </nav>
  );
}
