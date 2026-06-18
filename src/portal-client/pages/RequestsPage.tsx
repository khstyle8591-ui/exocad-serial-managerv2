import { useState, useEffect } from 'react';
import { api } from '../api';
import { useAuth } from '../contexts/AuthContext';
import { t, type Lang } from '../i18n';

interface CreditPackage {
  id: string;
  label: string;
  quantity: number;
  price: number;
}

interface LocalizedText { ko: string; en: string; ja: string }
interface RequestDescriptions {
  credit: LocalizedText;
  renewal_stop: LocalizedText;
  renewal_resume: LocalizedText;
}

interface OwnedSerial {
  serial_number: string;
  main_product: string;
  status: string;
}

interface ExpandedLink {
  customer_id: number;
  verified_serial: string;
  serials: OwnedSerial[];
}

interface PortalRequest {
  id: number;
  type: 'credit' | 'renewal_stop' | 'renewal_resume';
  target_serial: string;
  exocad_id: string;
  package_code: string;
  status: string;
  note: string;
  created_at: string;
}

type TabType = 'history' | 'credit' | 'renewal_stop' | 'renewal_resume';

function statusBadge(status: string, lang: Lang) {
  const map: Record<string, { cls: string; key: Parameters<typeof t>[1] }> = {
    pending:        { cls: 'badge-yellow', key: 'req_status_pending' },
    manager_review: { cls: 'badge-blue',   key: 'req_status_manager_review' },
    auto_done:      { cls: 'badge-accent', key: 'req_status_auto_done' },
    approved:       { cls: 'badge-green',  key: 'req_status_approved' },
    rejected:       { cls: 'badge-red',    key: 'req_status_rejected' },
  };
  const entry = map[status];
  if (!entry) return <span className="badge badge-gray">{status}</span>;
  return <span className={`badge ${entry.cls}`}>{t(lang, entry.key)}</span>;
}

function serialStatusBadge(status: string, lang: Lang) {
  const map: Record<string, { cls: string; key: Parameters<typeof t>[1] }> = {
    active:         { cls: 'badge-green',  key: 'status_active' },
    cancelled:      { cls: 'badge-red',    key: 'status_cancelled' },
    expired:        { cls: 'badge-gray',   key: 'status_expired' },
    stop_requested: { cls: 'badge-yellow', key: 'status_stop_requested' },
  };
  const entry = map[status];
  if (!entry) return <span className="badge badge-gray">{status}</span>;
  return <span className={`badge ${entry.cls}`}>{t(lang, entry.key)}</span>;
}

function typeLabel(type: string, lang: Lang) {
  const map: Record<string, Parameters<typeof t>[1]> = {
    credit: 'credit_request',
    renewal_stop: 'renewal_stop',
    renewal_resume: 'renewal_resume',
  };
  return map[type] ? t(lang, map[type]) : type;
}

export default function RequestsPage() {
  const { lang } = useAuth();
  const [tab, setTab] = useState<TabType>('history');
  const [requests, setRequests] = useState<PortalRequest[]>([]);
  const [packages, setPackages] = useState<CreditPackage[]>([]);
  const [descriptions, setDescriptions] = useState<RequestDescriptions | null>(null);
  const [quotePrompt, setQuotePrompt] = useState<LocalizedText | null>(null);
  const [quoteSent, setQuoteSent] = useState<LocalizedText | null>(null);
  const [ownedSerials, setOwnedSerials] = useState<OwnedSerial[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // credit form
  const [exocadId, setExocadId] = useState('');
  const [pkgCode, setPkgCode] = useState('');
  // renewal forms
  const [stopSerial, setStopSerial] = useState('');
  const [checkedSerials, setCheckedSerials] = useState<Record<string, boolean>>({});
  const [showQuotePrompt, setShowQuotePrompt] = useState(false);

  useEffect(() => {
    setLoadingData(true);
    Promise.all([
      api.get<{ requests: PortalRequest[] }>('/requests'),
      api.get<{ packages: CreditPackage[]; descriptions: RequestDescriptions; resume_quote_prompt: LocalizedText; resume_quote_sent: LocalizedText }>('/config'),
      api.get<{ links: ExpandedLink[] }>('/setup/links'),
    ])
      .then(([r, c, l]) => {
        setRequests(r.requests);
        setPackages(c.packages);
        setDescriptions(c.descriptions);
        setQuotePrompt(c.resume_quote_prompt);
        setQuoteSent(c.resume_quote_sent);
        setOwnedSerials(l.links.flatMap(lk => lk.serials));
        if (c.packages.length > 0) setPkgCode(c.packages[0].id);
      })
      .catch(() => { /* ignore */ })
      .finally(() => setLoadingData(false));
  }, []);

  function reloadRequests() {
    api.get<{ requests: PortalRequest[] }>('/requests')
      .then(r => setRequests(r.requests))
      .catch(() => { /* ignore */ });
  }

  function submittedMsg(id: number) {
    return `${t(lang, 'request_submitted')} (${t(lang, 'request_no')}: #${id})`;
  }

  function desc(type: keyof RequestDescriptions) {
    return descriptions ? descriptions[type][lang] : '';
  }

  async function submitCredit(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setSuccess(''); setSubmitting(true);
    try {
      const res = await api.post<{ request_id: number }>('/requests/credit', {
        exocad_id: exocadId,
        package_code: pkgCode,
      });
      setSuccess(submittedMsg(res.request_id));
      setExocadId('');
      setTab('history');
      reloadRequests();
    } catch (err) {
      setError(err instanceof Error ? err.message : '오류가 발생했습니다.');
    } finally {
      setSubmitting(false);
    }
  }

  async function submitRenewalStop(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setSuccess(''); setSubmitting(true);
    try {
      const res = await api.post<{ request_id: number; auto_applied?: boolean }>(
        '/requests/renewal-stop',
        { target_serial: stopSerial },
      );
      setSuccess(
        res.auto_applied
          ? `${t(lang, 'stop_applied_now')} (${t(lang, 'request_no')}: #${res.request_id})`
          : submittedMsg(res.request_id),
      );
      setStopSerial('');
      setTab('history');
      reloadRequests();
    } catch (err) {
      setError(err instanceof Error ? err.message : '오류가 발생했습니다.');
    } finally {
      setSubmitting(false);
    }
  }

  const selectedSerials = ownedSerials.filter(s => checkedSerials[s.serial_number]);

  // 체크된 시리얼 전부에 대해 갱신재개 신청 (시리얼당 1건). include_quote 여부 전달.
  async function submitResume(includeQuote: boolean) {
    if (selectedSerials.length === 0) return;
    setError(''); setSuccess(''); setSubmitting(true);
    try {
      const ids: number[] = [];
      for (const s of selectedSerials) {
        const res = await api.post<{ request_id: number }>(
          '/requests/renewal-resume',
          { target_serial: s.serial_number, include_quote: String(includeQuote) },
        );
        ids.push(res.request_id);
      }
      if (includeQuote && quoteSent) {
        setSuccess(quoteSent[lang]);
      } else {
        setSuccess(`${t(lang, 'request_submitted')} (${t(lang, 'request_no')}: #${ids.join(', #')})`);
      }
      setCheckedSerials({});
      setShowQuotePrompt(false);
      setTab('history');
      reloadRequests();
    } catch (err) {
      setError(err instanceof Error ? err.message : t(lang, 'error_generic'));
    } finally {
      setSubmitting(false);
    }
  }

  // 신청 버튼 1차 클릭 → 견적서 안내 프롬프트 표시 / 2차 클릭 → 실제 신청
  function handleResumeSubmitClick() {
    if (selectedSerials.length === 0) return;
    if (!showQuotePrompt) { setShowQuotePrompt(true); return; }
    submitResume(false);
  }

  const TABS: { id: TabType; label: string }[] = [
    { id: 'history',       label: t(lang, 'request_history') },
    { id: 'credit',        label: t(lang, 'credit_request') },
    { id: 'renewal_stop',  label: t(lang, 'renewal_stop') },
    { id: 'renewal_resume',label: t(lang, 'renewal_resume') },
  ];

  return (
    <div className="portal-page">
      <h1 className="page-title">{t(lang, 'requests')}</h1>
      <p className="page-subtitle" style={{ marginBottom: 20 }} />

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, flexWrap: 'wrap' }}>
        {TABS.map(tb => (
          <button
            key={tb.id}
            className={`btn btn-sm ${tab === tb.id ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => { setTab(tb.id); setError(''); setSuccess(''); setShowQuotePrompt(false); }}
          >
            {tb.label}
          </button>
        ))}
      </div>

      {error   && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {/* History */}
      {tab === 'history' && (
        <div className="portal-card" style={{ padding: 0 }}>
          {loadingData ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
              <div className="spinner" />
            </div>
          ) : requests.length === 0 ? (
            <p style={{ color: 'var(--text3)', fontSize: 13, padding: '16px 20px' }}>
              {t(lang, 'no_requests')}
            </p>
          ) : (
            requests.map(r => (
              <div key={r.id} className="request-row">
                <div style={{ flex: 1 }}>
                  <div className="request-type">
                    #{r.id} · {typeLabel(r.type, lang)}
                    {r.target_serial && <span style={{ color: 'var(--text3)', fontWeight: 400, marginLeft: 8 }}>{r.target_serial}</span>}
                    {r.exocad_id   && <span style={{ color: 'var(--text3)', fontWeight: 400, marginLeft: 8 }}>{r.exocad_id}</span>}
                  </div>
                  <div className="request-meta">{r.created_at.slice(0, 16).replace('T', ' ')}</div>
                </div>
                {statusBadge(r.status, lang)}
              </div>
            ))
          )}
        </div>
      )}

      {/* Credit */}
      {tab === 'credit' && (
        <div className="portal-card">
          <p style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 20 }}>
            {desc('credit')}
          </p>
          <form onSubmit={submitCredit}>
            <div className="form-group">
              <label>{t(lang, 'exocad_id_label')}</label>
              <input
                type="text"
                placeholder={t(lang, 'credit_exocad_placeholder')}
                value={exocadId}
                onChange={e => setExocadId(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label>{t(lang, 'select_package')}</label>
              {packages.length === 0 ? (
                <p style={{ color: 'var(--text3)', fontSize: 13 }}>{t(lang, 'no_packages')}</p>
              ) : (
                <select value={pkgCode} onChange={e => setPkgCode(e.target.value)} required>
                  {packages.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.label} — {p.quantity}{t(lang, 'credit_unit')} ({p.price.toLocaleString()}{t(lang, 'currency_suffix')})
                    </option>
                  ))}
                </select>
              )}
            </div>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={submitting || packages.length === 0}
            >
              {submitting ? <span className="spinner" style={{ width: 16, height: 16 }} /> : t(lang, 'submit')}
            </button>
          </form>
        </div>
      )}

      {/* Renewal Stop */}
      {tab === 'renewal_stop' && (
        <div className="portal-card">
          <p style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 20 }}>
            {desc('renewal_stop')}
          </p>
          <form onSubmit={submitRenewalStop}>
            <div className="form-group">
              <label>{t(lang, 'target_serial')}</label>
              <input
                type="text"
                placeholder={t(lang, 'serial_placeholder')}
                value={stopSerial}
                onChange={e => setStopSerial(e.target.value)}
                required
              />
            </div>
            <button type="submit" className="btn btn-danger" disabled={submitting}>
              {submitting ? <span className="spinner" style={{ width: 16, height: 16 }} /> : t(lang, 'submit')}
            </button>
          </form>
        </div>
      )}

      {/* Renewal Resume */}
      {tab === 'renewal_resume' && (
        <div className="portal-card">
          <p style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 16 }}>
            {desc('renewal_resume')}
          </p>

          {ownedSerials.length === 0 ? (
            <p style={{ color: 'var(--text3)', fontSize: 13 }}>{t(lang, 'no_owned_serials')}</p>
          ) : (
            <>
              <div className="form-group">
                <label>{t(lang, 'resume_select_hint')}</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
                  {ownedSerials.map(s => (
                    <label key={s.serial_number} className="product-card" style={{ cursor: 'pointer', gap: 10 }}>
                      <input
                        type="checkbox"
                        checked={!!checkedSerials[s.serial_number]}
                        onChange={e => {
                          setShowQuotePrompt(false);
                          setCheckedSerials(c => ({ ...c, [s.serial_number]: e.target.checked }));
                        }}
                        style={{ width: 'auto', flexShrink: 0 }}
                      />
                      <div className="product-card-info">
                        <div className="product-card-name">{s.main_product}</div>
                        <div className="product-card-serial" style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
                          {s.serial_number}
                        </div>
                      </div>
                      {serialStatusBadge(s.status, lang)}
                    </label>
                  ))}
                </div>
              </div>

              {/* 2단계 견적서 안내 프롬프트 */}
              {showQuotePrompt && quotePrompt && (
                <div className="alert alert-info" style={{ marginBottom: 16 }}>
                  {quotePrompt[lang]}
                </div>
              )}

              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={submitting || selectedSerials.length === 0}
                  onClick={handleResumeSubmitClick}
                >
                  {submitting && !showQuotePrompt ? <span className="spinner" style={{ width: 16, height: 16 }} /> : t(lang, 'submit')}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={submitting || selectedSerials.length === 0}
                  onClick={() => submitResume(true)}
                >
                  {t(lang, 'request_quote')}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
