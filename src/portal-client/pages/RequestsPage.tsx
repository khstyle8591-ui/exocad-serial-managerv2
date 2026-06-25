import { useState, useEffect } from 'react';
import { api } from '../api';
import { useAuth } from '../contexts/AuthContext';
import { t, type Lang } from '../i18n';
import Modal from '../components/Modal';

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

function statusBadge(status: string, note: string, lang: Lang) {
  if (status === 'approved' && note === 'cancel_rejected') {
    return <span className="badge badge-red">{t(lang, 'req_status_cancel_rejected')}</span>;
  }
  const map: Record<string, { cls: string; key: Parameters<typeof t>[1] }> = {
    pending:        { cls: 'badge-yellow', key: 'req_status_pending' },
    manager_review: { cls: 'badge-blue',   key: 'req_status_manager_review' },
    auto_done:      { cls: 'badge-accent', key: 'req_status_auto_done' },
    approved:       { cls: 'badge-green',  key: 'req_status_approved' },
    rejected:         { cls: 'badge-red',    key: 'req_status_rejected' },
    user_cancelled:   { cls: 'badge-gray',   key: 'req_status_user_cancelled' },
    cancel_requested: { cls: 'badge-yellow', key: 'req_status_cancel_requested' },
  };
  const entry = map[status];
  if (!entry) return <span className="badge badge-gray">{status}</span>;
  return <span className={`badge ${entry.cls}`}>{t(lang, entry.key)}</span>;
}

// renewal_stop은 자동/수동 처리 구분 없이 고객에게는 승인/실패/대기/거절 4가지로만 표시.
// 매니저 승인 후 Playwright 실행만 실패한 경우(note=playwright_failed_manual)는 status가 'approved'로
// 유지되어 그냥 승인됨으로 보임 — 매니저가 이미 승인했으므로 고객에게 처리 실패를 노출하지 않음.
// status='rejected'는 (1) 시스템/고객 자동처리 실패(note=playwright_failed) 또는 (2) 매니저의 실제 거절,
// 두 경우만 존재 — 전자만 "처리 실패"로, 후자는 "거절됨"으로 구분 표시.
function renewalStopStatusBadge(status: string, note: string, lang: Lang) {
  if (status === 'approved' && note === 'cancel_rejected') {
    return <span className="badge badge-red">{t(lang, 'req_status_cancel_rejected')}</span>;
  }
  if (status === 'auto_done' || status === 'approved') {
    return <span className="badge badge-green">{t(lang, 'req_status_approved')}</span>;
  }
  if (status === 'rejected') {
    if (note === 'playwright_failed') {
      return <span className="badge badge-red">{t(lang, 'renewal_stop_failed')}</span>;
    }
    return <span className="badge badge-red">{t(lang, 'req_status_rejected')}</span>;
  }
  if (status === 'user_cancelled') {
    return <span className="badge badge-gray">{t(lang, 'req_status_user_cancelled')}</span>;
  }
  if (status === 'cancel_requested') {
    return <span className="badge badge-yellow">{t(lang, 'req_status_cancel_requested')}</span>;
  }
  // pending / manager_review
  return <span className="badge badge-yellow">{t(lang, 'req_status_pending')}</span>;
}

function serialStatusBadge(status: string, lang: Lang) {
  const map: Record<string, { cls: string; key: Parameters<typeof t>[1] }> = {
    active:         { cls: 'badge-green',  key: 'status_active' },
    cancelled:      { cls: 'badge-red',    key: 'status_cancelled' },
    expired:        { cls: 'badge-red',    key: 'status_expired' },
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
  const [warning, setWarning] = useState('');
  const [showFailurePopup, setShowFailurePopup] = useState(false);

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

  async function cancelRequest(id: number) {
    if (!window.confirm(t(lang, 'cancel_request_confirm'))) return;
    try {
      await api.post(`/requests/${id}/cancel`, {});
      setSuccess(t(lang, 'cancel_request_submitted'));
      reloadRequests();
    } catch (err) {
      setError(err instanceof Error ? err.message : t(lang, 'error_generic'));
    }
  }

  function pkgLabel(code: string) {
    const pkg = packages.find(p => p.id === code);
    return pkg ? `${pkg.label} (${pkg.quantity}${t(lang, 'credit_unit')})` : code;
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
    setError(''); setSuccess(''); setWarning(''); setSubmitting(true);
    try {
      const res = await api.post<{ request_id?: number; status?: string; auto_applied?: boolean; processing_failed?: boolean }>(
        '/requests/renewal-stop',
        { target_serial: stopSerial },
      );
      if (res.status === 'already_requested') {
        setWarning(t(lang, 'already_stop_requested_msg'));
      } else if (res.auto_applied) {
        setSuccess(`${t(lang, 'stop_applied_now')} (${t(lang, 'request_no')}: #${res.request_id})`);
      } else if (res.processing_failed) {
        setWarning(`${t(lang, 'stop_request_processing_failed')} (${t(lang, 'request_no')}: #${res.request_id})`);
        setShowFailurePopup(true);
      } else {
        setSuccess(submittedMsg(res.request_id!));
      }
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
            onClick={() => { setTab(tb.id); setError(''); setSuccess(''); setWarning(''); setShowQuotePrompt(false); }}
          >
            {tb.label}
          </button>
        ))}
      </div>

      {error   && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}
      {warning && <div className="alert alert-warn">{warning}</div>}

      <Modal
        open={showFailurePopup}
        title={t(lang, 'renewal_stop_failed_title')}
        onClose={() => setShowFailurePopup(false)}
        closeLabel={t(lang, 'confirm_ok')}
      >
        {t(lang, 'renewal_stop_failed_banner')}
      </Modal>

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
                <div className="request-row-main">
                  <div className="request-type">
                    #{r.id} · {typeLabel(r.type, lang)}
                    {r.target_serial && <span style={{ color: 'var(--text3)', fontWeight: 400, marginLeft: 8 }}>{r.target_serial}</span>}
                    {r.exocad_id    && <span style={{ color: 'var(--text3)', fontWeight: 400, marginLeft: 8 }}>{r.exocad_id}</span>}
                    {r.package_code && <span style={{ color: 'var(--text3)', fontWeight: 400, marginLeft: 8 }}>{pkgLabel(r.package_code)}</span>}
                  </div>
                  <div className="request-meta">{r.created_at.slice(0, 16).replace('T', ' ')}</div>
                </div>
                <div className="request-row-actions">
                  {r.status === 'pending' && (
                    <button
                      className="btn btn-sm btn-ghost"
                      style={{ fontSize: 12, color: 'var(--red)' }}
                      onClick={() => cancelRequest(r.id)}
                    >
                      {t(lang, 'cancel_request')}
                    </button>
                  )}
                  {r.type === 'renewal_stop'
                    ? renewalStopStatusBadge(r.status, r.note, lang)
                    : statusBadge(r.status, r.note, lang)
                  }
                </div>
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
