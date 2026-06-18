import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../contexts/AuthContext';
import { t } from '../i18n';

export default function ResetRequestPage() {
  const { lang } = useAuth();
  const [loginId, setLoginId] = useState('');
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const data = await api.post<{ message: string }>('/auth/reset-request', { login_id: loginId, email });
      setMsg(data.message || '');
    } catch (err) {
      setMsg(err instanceof Error ? err.message : '오류가 발생했습니다.');
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

        {msg ? (
          <div className="alert alert-info" style={{ marginBottom: 0 }}>{msg}</div>
        ) : (
          <form onSubmit={handleSubmit}>
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
