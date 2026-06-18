import { useState, useEffect } from 'react';
import { api } from '../api';
import { useAuth } from '../contexts/AuthContext';
import { t } from '../i18n';

interface SerialEntry {
  serial_number: string;
  main_product: string;
  status: string;
}

interface ExpandedLink {
  customer_id: number;
  verified_serial: string;
  serials: SerialEntry[];
}

function statusBadge(status: string, lang: ReturnType<typeof useAuth>['lang']) {
  const map: Record<string, { key: Parameters<typeof t>[1]; cls: string }> = {
    active:           { key: 'status_active',         cls: 'badge-success' },
    cancelled:        { key: 'status_cancelled',       cls: 'badge-error' },
    expired:          { key: 'status_expired',         cls: 'badge-warning' },
    stop_requested:   { key: 'status_stop_requested',  cls: 'badge-warning' },
  };
  const entry = map[status];
  return entry
    ? <span className={`badge ${entry.cls}`}>{t(lang, entry.key)}</span>
    : <span className="badge">{status}</span>;
}

export default function SetupPage() {
  const { lang } = useAuth();
  const [serial, setSerial] = useState('');
  const [links, setLinks] = useState<ExpandedLink[]>([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  function loadLinks() {
    api.get<{ links: ExpandedLink[] }>('/setup/links')
      .then(d => setLinks(d.links))
      .catch(() => {});
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
        setSuccess(t(lang, 'already_linked_msg'));
      } else {
        setSuccess(`${t(lang, 'link_done')}${data.main_product ? ` — ${data.main_product}` : ''}`);
      }
      setSerial('');
      loadLinks();
    } catch (err) {
      setError(err instanceof Error ? err.message : t(lang, 'error_generic'));
    } finally {
      setLoading(false);
    }
  }

  const totalSerials = links.reduce((n, lk) => n + lk.serials.length, 0);

  return (
    <div className="portal-page">
      <h1 className="page-title">{t(lang, 'link_serial_title')}</h1>
      <p className="page-subtitle">{t(lang, 'setup_hint')}</p>

      <div className="portal-card">
        {error   && <div className="alert alert-error">{error}</div>}
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

      {totalSerials > 0 && (
        <div className="portal-card">
          <div className="portal-card-title">{t(lang, 'linked_serials')}</div>
          {links.flatMap(lk =>
            lk.serials.map(s => (
              <div key={s.serial_number} className="product-card">
                <div className="product-card-info">
                  <div className="product-card-name">{s.main_product}</div>
                  <div className="product-card-serial" style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
                    {s.serial_number}
                  </div>
                </div>
                {statusBadge(s.status, lang)}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
