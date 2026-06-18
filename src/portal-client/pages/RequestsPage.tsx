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
  const [loadingData, setLoadingData] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // credit form
  const [exocadId, setExocadId] = useState('');
  const [pkgCode, setPkgCode] = useState('');
  // renewal forms
  const [stopSerial, setStopSerial] = useState('');
  const [resumeSerial, setResumeSerial] = useState('');
  const [includeQuote, setIncludeQuote] = useState(false);

  useEffect(() => {
    setLoadingData(true);
    Promise.all([
      api.get<{ requests: PortalRequest[] }>('/requests'),
      api.get<{ packages: CreditPackage[]; descriptions: RequestDescriptions }>('/config'),
    ])
      .then(([r, c]) => {
        setRequests(r.requests);
        setPackages(c.packages);
        setDescriptions(c.descriptions);
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

  async function submitRenewalResume(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setSuccess(''); setSubmitting(true);
    try {
      const res = await api.post<{ request_id: number }>(
        '/requests/renewal-resume',
        { target_serial: resumeSerial, include_quote: String(includeQuote) },
      );
      setSuccess(submittedMsg(res.request_id));
      setResumeSerial('');
      setIncludeQuote(false);
      setTab('history');
      reloadRequests();
    } catch (err) {
      setError(err instanceof Error ? err.message : '오류가 발생했습니다.');
    } finally {
      setSubmitting(false);
    }
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
            onClick={() => { setTab(tb.id); setError(''); setSuccess(''); }}
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
          <p style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 20 }}>
            {desc('renewal_resume')}
          </p>
          <form onSubmit={submitRenewalResume}>
            <div className="form-group">
              <label>{t(lang, 'target_serial')}</label>
              <input
                type="text"
                placeholder={t(lang, 'serial_placeholder')}
                value={resumeSerial}
                onChange={e => setResumeSerial(e.target.value)}
                required
              />
            </div>
            <div className="form-group" style={{ marginBottom: 20 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={includeQuote}
                  onChange={e => setIncludeQuote(e.target.checked)}
                  style={{ width: 'auto' }}
                />
                {t(lang, 'include_quote')}
              </label>
            </div>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? <span className="spinner" style={{ width: 16, height: 16 }} /> : t(lang, 'submit')}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
