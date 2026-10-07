import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, setCsrf } from '../api';
import { useAuth } from '../contexts/AuthContext';
import { t } from '../i18n';
import geoMediLogo from '../assets/geomedi-logo.png';

export default function LoginPage() {
  const { lang, refresh } = useAuth();
  const navigate = useNavigate();
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await api.post<{ csrf_token: string }>('/auth/login', {
        login_id: loginId,
        password,
      });
      setCsrf(data.csrf_token);
      await refresh();
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(t(lang, err instanceof Error ? err.message as Parameters<typeof t>[1] : 'error_generic'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-wrapper">
      <div className="auth-card">
        <div className="auth-logo">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
            <img src={geoMediLogo} alt="GeoMedi" style={{ height: 83, width: 83, objectFit: 'contain' }} />
            <span>Exocad Portal</span>
          </div>
          <p>Customer Portal</p>
        </div>

        <h2 className="auth-title">{t(lang, 'login')}</h2>

        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>{t(lang, 'login_id')}</label>
            <input
              type="text"
              autoComplete="username"
              value={loginId}
              onChange={e => setLoginId(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label>{t(lang, 'password')}</label>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
            />
          </div>

          <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
            {loading ? <span className="spinner" style={{ width: 16, height: 16 }} /> : t(lang, 'login')}
          </button>
        </form>

        <div className="mt-16 text-center" style={{ fontSize: 13 }}>
          <Link to="/reset-request" style={{ color: 'var(--text3)', textDecoration: 'none' }}>
            {t(lang, 'forgot_password')}
          </Link>
        </div>

        <div className="divider" />

        <div className="text-center" style={{ fontSize: 13, color: 'var(--text3)' }}>
          {t(lang, 'no_account')}{' '}
          <Link to="/signup" style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}>
            {t(lang, 'signup')}
          </Link>
        </div>
      </div>
    </div>
  );
}
