import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { t, type Lang } from '../i18n';
import geoMediLogo from '../assets/geomedi-logo.png';

const LANGS: { value: Lang; label: string }[] = [
  { value: 'ko', label: '한국어' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
];

export default function Navbar() {
  const { account, lang, setLang, logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  async function handleLogout() {
    setMenuOpen(false);
    await logout();
    navigate('/login');
  }

  function closeMenu() {
    setMenuOpen(false);
  }

  return (
    <nav className={`portal-nav${menuOpen ? ' menu-open' : ''}`}>
      <div className="portal-nav-logo">
        <img
          src={geoMediLogo}
          alt="GeoMedi"
          style={{ height: 83, width: 83, objectFit: 'contain', flexShrink: 0 }}
        />
        <span>Exocad Portal</span>
      </div>

      {account && (
        <div className="portal-nav-links">
          <NavLink
            to="/dashboard"
            onClick={closeMenu}
            className={({ isActive }) => `portal-nav-link${isActive ? ' active' : ''}`}
          >
            {t(lang, 'dashboard')}
          </NavLink>
          <NavLink
            to="/requests"
            onClick={closeMenu}
            className={({ isActive }) => `portal-nav-link${isActive ? ' active' : ''}`}
          >
            {t(lang, 'requests')}
          </NavLink>
          <NavLink
            to="/setup"
            onClick={closeMenu}
            className={({ isActive }) => `portal-nav-link${isActive ? ' active' : ''}`}
          >
            {t(lang, 'link_serial_title')}
          </NavLink>
          <NavLink
            to="/profile"
            onClick={closeMenu}
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

        {account && (
          <button
            type="button"
            className="portal-nav-burger"
            aria-label="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(o => !o)}
          >
            <span /><span /><span />
          </button>
        )}
      </div>
    </nav>
  );
}
