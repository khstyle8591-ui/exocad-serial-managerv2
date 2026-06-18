import { useState, useEffect } from 'react';
import { api } from '../api';
import { useAuth } from '../contexts/AuthContext';
import { t } from '../i18n';

interface AccountLink {
  customer_id: number;
  verified_serial: string;
}

export default function SetupPage() {
  const { lang } = useAuth();
  const [serial, setSerial] = useState('');
  const [links, setLinks] = useState<AccountLink[]>([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  function loadLinks() {
    api.get<{ links: AccountLink[] }>('/setup/links')
      .then(d => setLinks(d.links))
      .catch(() => { /* ignore */ });
  }

  useEffect(() => { loadLinks(); }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);
    try {
      const data = await api.post<{ ok: boolean; main_product?: string; already_linked?: boolean }>(
        '/setup/link-serial',
        { serial },
      );
      if (data.already_linked) {
        setSuccess('이미 연결된 시리얼입니다.');
      } else {
        setSuccess(`연결 완료${data.main_product ? ` — ${data.main_product}` : ''}`);
      }
      setSerial('');
      loadLinks();
    } catch (err) {
      setError(err instanceof Error ? err.message : '오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="portal-page">
      <h1 className="page-title">{t(lang, 'link_serial_title')}</h1>
      <p className="page-subtitle">시리얼 번호를 입력하면 본인 계정에 연결됩니다.</p>

      <div className="portal-card">
        {error && <div className="alert alert-error">{error}</div>}
        {success && <div className="alert alert-success">{success}</div>}

        <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            className="form-group"
            placeholder={t(lang, 'serial_placeholder')}
            value={serial}
            onChange={e => setSerial(e.target.value)}
            required
            style={{ flex: 1, margin: 0 }}
          />
          <button type="submit" className="btn btn-primary" disabled={loading} style={{ flexShrink: 0 }}>
            {loading ? <span className="spinner" style={{ width: 16, height: 16 }} /> : t(lang, 'link')}
          </button>
        </form>
      </div>

      {links.length > 0 && (
        <div className="portal-card">
          <div className="portal-card-title">{t(lang, 'linked_serials')}</div>
          {links.map(lk => (
            <div key={lk.customer_id} className="product-card">
              <div className="product-card-info">
                <div className="product-card-serial" style={{ fontSize: 13, color: 'var(--text2)' }}>
                  {lk.verified_serial}
                </div>
              </div>
              <span className="badge badge-accent">연결됨</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
