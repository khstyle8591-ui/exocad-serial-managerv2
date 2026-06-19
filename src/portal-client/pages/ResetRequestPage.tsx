import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useAuth } from '../contexts/AuthContext';
import { t } from '../i18n';

export default function ResetRequestPage() {
  const { lang } = useAuth();
  const [loginId, setLoginId] = useState('');
  const [email, setEmail] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');
    try {
      await api.post<{ ok: boolean; code?: string }>('/auth/reset-request', { login_id: loginId, email });
      setSuccessMsg(t(lang, 'reset_link_sent'));
    } catch (err: unknown) {
      const code = err instanceof ApiError ? err.code : undefined;
      if (code === 'email_not_matched') setErrorMsg(t(lang, 'email_not_matched'));
      else if (code === 'mail_send_failed') setErrorMsg(t(lang, 'mail_send_failed'));
      else if (code === 'missing_fields') setErrorMsg(t(lang, 'error_required'));
      else setErrorMsg(t(lang, 'error_generic'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-wrapper">
      <div className="auth-card">
        <div className="auth-logo">
          <span>Exocad Portal</span>
        </div>

        <h2 className="auth-title">{t(lang, 'forgot_password')}</h2>
        <p style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 20, lineHeight: 1.5 }}>
          {t(lang, 'reset_hint')}
        </p>

        {successMsg ? (
          <div className="alert alert-info" style={{ marginBottom: 0 }}>{successMsg}</div>
        ) : (
          <form onSubmit={handleSubmit}>
            {errorMsg && <div className="alert alert-error" style={{ marginBottom: 12 }}>{errorMsg}</div>}
            <div className="form-group">
              <label>{t(lang, 'login_id')}</label>
              <input type="text" value={loginId} onChange={e => setLoginId(e.target.value)} required />
            </div>
            <div className="form-group">
              <label>{t(lang, 'email')}</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} required />
            </div>
            <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
              {loading ? <span className="spinner" style={{ width: 16, height: 16 }} /> : t(lang, 'send_reset_link')}
            </button>
          </form>
        )}

        <div className="mt-16 text-center" style={{ fontSize: 13 }}>
          <Link to="/login" style={{ color: 'var(--text3)', textDecoration: 'none' }}>
            {t(lang, 'back_to_login')}
          </Link>
        </div>
      </div>
    </div>
  );
}
