import { useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../contexts/AuthContext';
import { t } from '../i18n';

function mapError(msg: string, lang: ReturnType<typeof useAuth>['lang']): string {
  if (msg === 'missing_fields')    return t(lang, 'error_required');
  if (msg === 'pw_mismatch')       return t(lang, 'error_pw_mismatch');
  if (msg === 'invalid_reset_link') return t(lang, 'invalid_reset_link');
  return t(lang, 'error_generic');
}

export default function ResetConfirmPage() {
  const { lang } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.post('/auth/reset-confirm', { token, password, confirm_password: confirm });
      setDone(true);
      setTimeout(() => navigate('/login'), 2500);
    } catch (err) {
      setError(mapError(err instanceof Error ? err.message : '', lang));
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div className="auth-wrapper">
        <div className="auth-card text-center">
          <p className="text-muted">{t(lang, 'invalid_reset_link')}</p>
          <Link to="/login" className="btn btn-ghost btn-sm mt-16">{t(lang, 'back_to_login')}</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-wrapper">
      <div className="auth-card">
        <div className="auth-logo"><span>Exocad Portal</span></div>
        <h2 className="auth-title">{t(lang, 'reset_password')}</h2>

        {done ? (
          <div className="alert alert-success">
            {t(lang, 'pw_reset_done')}
          </div>
        ) : (
          <>
            {error && <div className="alert alert-error">{error}</div>}
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>{t(lang, 'new_password')}</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                />
                <p className="form-help">{t(lang, 'password_hint')}</p>
              </div>
              <div className="form-group">
                <label>{t(lang, 'confirm_password')}</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  required
                />
              </div>
              <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
                {loading ? <span className="spinner" style={{ width: 16, height: 16 }} /> : t(lang, 'reset_password')}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
