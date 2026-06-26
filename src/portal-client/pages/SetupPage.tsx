import { useState, useEffect } from 'react';
import { api, ApiError } from '../api';
import { useAuth } from '../contexts/AuthContext';
import { t } from '../i18n';
import SerialInput from '../components/SerialInput';
import Modal from '../components/Modal';

interface LocalizedText { ko: string; en: string; ja: string; color?: string; fontSize?: number; bold?: boolean }

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
    active:         { key: 'status_active',        cls: 'badge-success' },
    cancelled:      { key: 'status_cancelled',      cls: 'badge-error' },
    expired:        { key: 'status_expired',        cls: 'badge-warning' },
    stop_requested: { key: 'status_stop_requested', cls: 'badge-warning' },
  };
  const entry = map[status];
  return entry
    ? <span className={`badge ${entry.cls}`}>{t(lang, entry.key)}</span>
    : <span className="badge">{status}</span>;
}

export default function SetupPage() {
  const { lang } = useAuth();
  const [serial, setSerial] = useState('--');
  const [links, setLinks] = useState<ExpandedLink[]>([]);
  const [matches, setMatches] = useState<string[]>([]);
  const [hasMatch, setHasMatch] = useState<boolean | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [mismatchMsg, setMismatchMsg] = useState<LocalizedText | null>(null);
  const [showMismatch, setShowMismatch] = useState(false);

  function loadLinks() {
    api.get<{ links: ExpandedLink[] }>('/setup/links')
      .then(d => setLinks(d.links))
      .catch(() => {});
  }

  function loadMatches() {
    api.get<{ products: string[]; has_match: boolean }>('/setup/matches')
      .then(d => { setMatches(d.products); setHasMatch(d.has_match); })
      .catch(() => { setHasMatch(false); });
  }

  function loadMismatchMsg() {
    api.get<{ mismatch_message: LocalizedText }>('/config')
      .then(d => setMismatchMsg(d.mismatch_message))
      .catch(() => {});
  }

  useEffect(() => { loadLinks(); loadMatches(); loadMismatchMsg(); }, []);

  // 'XXXXXXXX-XXXX-XXXXXXXX' 형태가 모두 채워졌는지 (하이픈 제외 20자)
  const serialComplete = serial.replace(/-/g, '').length === 20;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!serialComplete) return;
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
      setSerial('--');
      loadLinks();
    } catch (err) {
      // DB 미매치 → PM 연락 안내 팝업, 그 외 → 인라인 에러
      if (err instanceof ApiError && err.code === 'identity_mismatch' && mismatchMsg) {
        setShowMismatch(true);
      } else {
        setError(err instanceof Error ? err.message : t(lang, 'error_generic'));
      }
    } finally {
      setLoading(false);
    }
  }

  const totalSerials = links.reduce((n, lk) => n + lk.serials.length, 0);

  return (
    <div className="portal-page">
      <h1 className="page-title">{t(lang, 'link_serial_title')}</h1>
      <p className="page-subtitle">{t(lang, 'setup_hint')}</p>

      {/* 매치된 제품 선표시 */}
      {hasMatch && matches.length > 0 && (
        <div className="portal-card">
          <div className="portal-card-title">{t(lang, 'setup_matched_title')}</div>
          <p style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 12 }}>
            {t(lang, 'setup_matched_hint')}
          </p>
          {matches.map(name => (
            <div key={name} className="product-card">
              <div className="product-card-info">
                <div className="product-card-name">{name}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      {hasMatch === false && (
        <div className="portal-card">
          <p style={{ fontSize: 13, color: 'var(--text3)', margin: 0 }}>
            {t(lang, 'setup_no_match_hint')}
          </p>
        </div>
      )}

      {/* 시리얼 입력 (8-4-8) */}
      <div className="portal-card">
        {error   && <div className="alert alert-error">{error}</div>}
        {success && <div className="alert alert-success">{success}</div>}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <SerialInput value={serial} onChange={setSerial} disabled={loading} />
          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading || !serialComplete}
            style={{ alignSelf: 'flex-start' }}
          >
            {loading ? <span className="spinner" style={{ width: 16, height: 16 }} /> : t(lang, 'link')}
          </button>
        </form>
      </div>

      {/* 연결된 시리얼 */}
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

      <Modal
        open={showMismatch}
        title={t(lang, 'mismatch_title')}
        onClose={() => setShowMismatch(false)}
        closeLabel={t(lang, 'confirm_ok')}
      >
        <div style={{
          color: mismatchMsg?.color || undefined,
          fontSize: mismatchMsg?.fontSize || undefined,
          fontWeight: mismatchMsg?.bold ? 700 : undefined,
          whiteSpace: 'pre-wrap',
        }}>
          {mismatchMsg ? mismatchMsg[lang] : ''}
        </div>
      </Modal>
    </div>
  );
}
