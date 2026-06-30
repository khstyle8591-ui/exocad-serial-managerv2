import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, setCsrf } from '../api';
import { useAuth } from '../contexts/AuthContext';
import { t, type Lang } from '../i18n';
import geoMediLogo from '../assets/geomedi-logo.png';

const LANGS: { value: Lang; label: string }[] = [
  { value: 'ko', label: '한국어' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
];

export default function SignupPage() {
  const { lang, refresh } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    login_id: '', email: '', name: '', phone: '', address: '',
    exocad_id: '', password: '', confirm_password: '', language: lang,
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function set(k: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm(f => ({ ...f, [k]: e.target.value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await api.post<{ csrf_token: string }>('/auth/signup', form);
      setCsrf(data.csrf_token);
      await refresh();
      navigate('/setup', { replace: true });
    } catch (err) {
      setError(t(lang, err instanceof Error ? err.message as Parameters<typeof t>[1] : 'error_generic'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-wrapper">
      <div className="auth-card" style={{ maxWidth: 460 }}>
        <div className="auth-logo">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
            <img src={geoMediLogo} alt="GeoMedi" style={{ height: 83, width: 83, objectFit: 'contain' }} />
            <span>Exocad Portal</span>
          </div>
          <p>Customer Portal</p>
        </div>

        <h2 className="auth-title">{t(lang, 'signup')}</h2>

        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>{t(lang, 'login_id')}</label>
            <input type="text" autoComplete="username" value={form.login_id} onChange={set('login_id')} required />
          </div>

          <div className="form-group">
            <label>{t(lang, 'email')}</label>
            <input type="email" autoComplete="email" value={form.email} onChange={set('email')} required />
          </div>

          <div className="form-group">
            <label>{t(lang, 'name')}</label>
            <input type="text" autoComplete="name" value={form.name} onChange={set('name')} required />
          </div>

          <div className="form-group">
            <label>{t(lang, 'phone')}</label>
            <input type="tel" autoComplete="tel" value={form.phone} onChange={set('phone')} />
          </div>

          <div className="form-group">
            <label>{t(lang, 'address')}</label>
            <input type="text" autoComplete="street-address" value={form.address} onChange={set('address')} />
          </div>

          <div className="form-group">
            <label>{t(lang, 'exocad_id')}</label>
            <input type="text" value={form.exocad_id} onChange={set('exocad_id')} />
          </div>

          <div className="form-group">
            <label>{t(lang, 'password')}</label>
            <input
              type="password"
              autoComplete="new-password"
              value={form.password}
              onChange={set('password')}
              required
            />
            <p className="form-help">{t(lang, 'password_hint')}</p>
          </div>

          <div className="form-group">
            <label>{t(lang, 'confirm_password')}</label>
            <input
              type="password"
              autoComplete="new-password"
              value={form.confirm_password}
              onChange={set('confirm_password')}
              required
            />
          </div>

          <div className="form-group">
            <label>{t(lang, 'language')}</label>
            <select value={form.language} onChange={set('language')}>
              {LANGS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
          </div>

          <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
            {loading ? <span className="spinner" style={{ width: 16, height: 16 }} /> : t(lang, 'signup')}
          </button>
        </form>

        <div className="divider" />

        <div className="text-center" style={{ fontSize: 13, color: 'var(--text3)' }}>
          {t(lang, 'have_account')}{' '}
          <Link to="/login" style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}>
            {t(lang, 'login')}
          </Link>
        </div>
      </div>
    </div>
  );
}
