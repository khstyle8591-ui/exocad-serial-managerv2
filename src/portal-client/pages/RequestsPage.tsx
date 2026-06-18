import { useState, useEffect } from 'react';
import { api } from '../api';
import { useAuth } from '../contexts/AuthContext';
import { t } from '../i18n';

interface CreditPackage {
  id: string;
  label: string;
  quantity: number;
  price: number;
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

function statusBadge(status: string, lang: string) {
  const map: Record<string, { cls: string; label: string }> = {
    pending:          { cls: 'badge-yellow', label: '대기 중' },
    manager_review:   { cls: 'badge-blue',   label: '검토 중' },
    auto_done:        { cls: 'badge-accent',  label: '자동 처리' },
    approved:         { cls: 'badge-green',   label: '승인됨' },
    rejected:         { cls: 'badge-red',     label: '거절됨' },
  };
  const entry = map[status] ?? { cls: 'badge-gray', label: status };
  return <span className={`badge ${entry.cls}`}>{entry.label}</span>;
}

function typeLabel(type: string) {
  const map: Record<string, string> = {
    credit: '크레딧 신청',
    renewal_stop: '갱신 중단',
    renewal_resume: '갱신 재개',
  };
  return map[type] ?? type;
}

export default function RequestsPage() {
  const { lang } = useAuth();
  const [tab, setTab] = useState<TabType>('history');
  const [requests, setRequests] = useState<PortalRequest[]>([]);
  const [packages, setPackages] = useState<CreditPackage[]>([]);
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
      api.get<{ packages: CreditPackage[] }>('/packages'),
    ])
      .then(([r, p]) => {
        setRequests(r.requests);
        setPackages(p.packages);
        if (p.packages.length > 0) setPkgCode(p.packages[0].id);
      })
      .catch(() => { /* ignore */ })
      .finally(() => setLoadingData(false));
  }, []);

  function reloadRequests() {
    api.get<{ requests: PortalRequest[] }>('/requests')
      .then(r => setRequests(r.requests))
      .catch(() => { /* ignore */ });
  }

  async function submitCredit(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setSuccess(''); setSubmitting(true);
    try {
      const res = await api.post<{ request_id: number }>('/requests/credit', {
        exocad_id: exocadId,
        package_code: pkgCode,
      });
      setSuccess(`신청이 접수되었습니다. (신청 번호: #${res.request_id})`);
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
          ? `갱신 중단이 즉시 적용되었습니다. (신청 번호: #${res.request_id})`
          : `신청이 접수되었습니다. (신청 번호: #${res.request_id})`,
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
      setSuccess(`신청이 접수되었습니다. (신청 번호: #${res.request_id})`);
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
                    #{r.id} · {typeLabel(r.type)}
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
            크레딧 추가 구매를 신청합니다. 관리자 확인 후 처리됩니다.
          </p>
          <form onSubmit={submitCredit}>
            <div className="form-group">
              <label>{t(lang, 'exocad_id_label')}</label>
              <input
                type="text"
                placeholder="Exocad 계정 ID"
                value={exocadId}
                onChange={e => setExocadId(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label>{t(lang, 'select_package')}</label>
              {packages.length === 0 ? (
                <p style={{ color: 'var(--text3)', fontSize: 13 }}>현재 구매 가능한 패키지가 없습니다.</p>
              ) : (
                <select value={pkgCode} onChange={e => setPkgCode(e.target.value)} required>
                  {packages.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.label} — {p.quantity}개 ({p.price.toLocaleString()}원)
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
            갱신을 중단할 시리얼 번호를 입력하세요. 만료 당일/익일인 경우 즉시 처리됩니다.
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
            갱신 재개 또는 만료된 시리얼 재구독을 신청합니다.
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
