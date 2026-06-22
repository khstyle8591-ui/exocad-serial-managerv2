import React, { useEffect, useRef, useState } from 'react';
import { useLang } from '../App';
import { t, type Language, type TranslationKey } from '../i18n';
import { api } from '../client';
import type { CreditPackage, PortalRequestDescriptions, LocalizedText } from '../../shared/types';

// ── Types ──────────────────────────────────────────────────────────────────
interface PortalSettings {
  portal_enabled: boolean;
  credit_auto_alloc_enabled: boolean;
  credit_notification_email: string;
  credit_packages: CreditPackage[];
  portal_request_descriptions: PortalRequestDescriptions;
  portal_mismatch_message: LocalizedText;
  portal_resume_quote_prompt: LocalizedText;
  portal_resume_quote_sent: LocalizedText;
}

interface PortalAccount {
  id: number;
  login_id: string;
  email: string;
  phone: string;
  name: string;
  exocad_id: string;
  language: string;
  status: 'active' | 'disabled';
  created_at: string;
  customer_mismatch?: string | null;
}

interface AdminRequest {
  id: number;
  account_id: number;
  type: 'credit' | 'renewal_stop' | 'renewal_resume';
  target_serial: string;
  exocad_id: string;
  package_code: string;
  status: string;
  note: string;
  created_at: string;
  account_name: string;
  account_login_id: string;
  account_email: string;
}

type Tab = 'settings' | 'packages' | 'descriptions' | 'accounts' | 'requests';
type LangKey = 'ko' | 'en' | 'ja';

function genId(): string {
  return Math.random().toString(36).slice(2, 8);
}

const TYPE_KEY: Record<string, TranslationKey> = {
  credit: 'portal_type_credit',
  renewal_stop: 'portal_type_renewal_stop',
  renewal_resume: 'portal_type_renewal_resume',
};

const STATUS_KEY: Record<string, TranslationKey> = {
  pending: 'portal_st_pending',
  manager_review: 'portal_st_manager_review',
  auto_done: 'portal_st_auto_done',
  approved: 'portal_st_approved',
  rejected: 'portal_st_rejected',
  user_cancelled: 'portal_st_user_cancelled',
};

const STATUS_COLOR: Record<string, string> = {
  pending: 'var(--yellow)',
  manager_review: 'var(--blue)',
  auto_done: 'var(--accent)',
  approved: 'var(--green)',
  rejected: 'var(--red)',
  user_cancelled: 'var(--text3)',
};

export default function Portal() {
  const { lang } = useLang();
  const [tab, setTab] = useState<Tab>('settings');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [settings, setSettings] = useState<PortalSettings | null>(null);
  const [accounts, setAccounts] = useState<PortalAccount[]>([]);
  const [requests, setRequests] = useState<AdminRequest[]>([]);
  const [reqFilter, setReqFilter] = useState<string>('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    api.portal.getSettings<PortalSettings>()
      .then(setSettings)
      .catch(err => alert(t(lang, 'portal_save_fail') + (err instanceof Error ? err.message : '')))
      .finally(() => setLoading(false));
  }, []);

  function loadAccounts() {
    api.portal.listAccounts<{ accounts: PortalAccount[] }>()
      .then(d => setAccounts(d.accounts))
      .catch(() => { /* ignore */ });
  }

  function loadRequests(filter = reqFilter) {
    api.portal.listRequests<{ requests: AdminRequest[] }>(filter ? { type: filter } : undefined)
      .then(d => setRequests(d.requests))
      .catch(() => { /* ignore */ });
  }

  function goTab(next: Tab) {
    setTab(next);
    if (next === 'accounts') loadAccounts();
    if (next === 'requests') {
      loadRequests();
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(() => loadRequests(), 30_000);
    } else {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    }
  }

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  async function save() {
    if (!settings) return;
    setSaving(true);
    try {
      await api.portal.saveSettings(settings);
      alert(t(lang, 'portal_saved'));
    } catch (err) {
      alert(t(lang, 'portal_save_fail') + (err instanceof Error ? err.message : ''));
    } finally {
      setSaving(false);
    }
  }

  async function toggleAccount(acc: PortalAccount) {
    const next = acc.status === 'active' ? 'disabled' : 'active';
    try {
      await api.portal.setAccountStatus(acc.id, next);
      loadAccounts();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'error');
    }
  }

  async function syncAccountToCustomer(acc: PortalAccount) {
    if (!window.confirm(t(lang, 'portal_acc_sync') + '?')) return;
    try {
      await api.portal.syncAccountToCustomer(acc.id);
      loadAccounts();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'error');
    }
  }

  async function decide(req: AdminRequest, action: 'approve' | 'reject') {
    const confirmKey = action === 'approve' ? 'portal_confirm_approve' : 'portal_confirm_reject';
    if (!window.confirm(t(lang, confirmKey))) return;
    try {
      await api.portal.decideRequest(req.id, action);
      loadRequests();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'error');
    }
  }

  if (loading || !settings) return <div className="page-wrapper">{t(lang, 'loading')}</div>;

  const showSaveBtn = tab === 'settings' || tab === 'packages' || tab === 'descriptions';

  const TABS: { id: Tab; key: TranslationKey }[] = [
    { id: 'settings',     key: 'portal_tab_settings' },
    { id: 'packages',     key: 'portal_tab_packages' },
    { id: 'descriptions', key: 'portal_tab_descriptions' },
    { id: 'accounts',     key: 'portal_tab_accounts' },
    { id: 'requests',     key: 'portal_tab_requests' },
  ];

  return (
    <div className="page-wrapper">
      <div className="page-header">
        <div>
          <div className="page-title">{t(lang, 'page_title_portal')}</div>
          <div className="page-subtitle">{t(lang, 'page_subtitle_portal')}</div>
        </div>
        {showSaveBtn && (
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? t(lang, 'saving') : t(lang, 'save')}
          </button>
        )}
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid var(--border)' }}>
        {TABS.map(tb => (
          <button
            key={tb.id}
            onClick={() => goTab(tb.id)}
            style={{
              padding: '10px 16px', background: 'none', border: 'none',
              borderBottom: `2px solid ${tab === tb.id ? 'var(--accent)' : 'transparent'}`,
              color: tab === tb.id ? 'var(--accent)' : 'var(--text2)',
              fontWeight: tab === tb.id ? 600 : 400, cursor: 'pointer',
              fontSize: 13, fontFamily: 'inherit', marginBottom: -1,
            }}
          >
            {t(lang, tb.key)}
          </button>
        ))}
      </div>

      {tab === 'settings'     && <SettingsTab lang={lang} settings={settings} setSettings={setSettings} />}
      {tab === 'packages'     && <PackagesTab lang={lang} settings={settings} setSettings={setSettings} />}
      {tab === 'descriptions' && <DescriptionsTab lang={lang} settings={settings} setSettings={setSettings} />}
      {tab === 'accounts'     && <AccountsTab lang={lang} accounts={accounts} onToggle={toggleAccount} onSync={syncAccountToCustomer} />}
      {tab === 'requests'     && (
        <RequestsTab
          lang={lang}
          requests={requests}
          filter={reqFilter}
          onFilter={f => { setReqFilter(f); loadRequests(f); }}
          onDecide={decide}
          creditPackages={settings.credit_packages ?? []}
        />
      )}
    </div>
  );
}

// ── Settings tab ─────────────────────────────────────────────────────────────
function SettingsTab({ lang, settings, setSettings }: {
  lang: Language;
  settings: PortalSettings;
  setSettings: React.Dispatch<React.SetStateAction<PortalSettings | null>>;
}) {
  const patch = (p: Partial<PortalSettings>) => setSettings(s => (s ? { ...s, ...p } : s));
  return (
    <div className="settings-section">
      <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
        <label className="checkbox-row" style={{ fontWeight: 700 }}>
          <input type="checkbox" checked={settings.portal_enabled}
            onChange={e => patch({ portal_enabled: e.target.checked })} />
          {t(lang, 'portal_enabled_label')}
        </label>
        <span style={{ fontSize: 12, color: settings.portal_enabled ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
          {settings.portal_enabled ? 'ON' : 'OFF'}
        </span>
      </div>

      <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
        <label className="checkbox-row" style={{ fontWeight: 700 }}>
          <input type="checkbox" checked={settings.credit_auto_alloc_enabled}
            onChange={e => patch({ credit_auto_alloc_enabled: e.target.checked })} />
          {t(lang, 'portal_auto_alloc_label')}
        </label>
      </div>

      <div className="form-group">
        <label>{t(lang, 'portal_notify_email_label')}</label>
        <input type="email" value={settings.credit_notification_email}
          onChange={e => patch({ credit_notification_email: e.target.value })}
          placeholder="admin@example.com" />
      </div>
    </div>
  );
}

// ── Packages tab ─────────────────────────────────────────────────────────────
function PackagesTab({ lang, settings, setSettings }: {
  lang: Language;
  settings: PortalSettings;
  setSettings: React.Dispatch<React.SetStateAction<PortalSettings | null>>;
}) {
  const pkgs = settings.credit_packages;
  const update = (next: CreditPackage[]) => setSettings(s => (s ? { ...s, credit_packages: next } : s));
  const setField = (i: number, field: keyof CreditPackage, value: string | number) =>
    update(pkgs.map((p, idx) => (idx === i ? { ...p, [field]: value } : p)));
  const add = () => update([...pkgs, { id: genId(), label: '', quantity: 1, price: 0 }]);
  const remove = (i: number) => update(pkgs.filter((_, idx) => idx !== i));

  return (
    <div className="settings-section">
      {pkgs.length === 0 && (
        <p style={{ color: 'var(--text3)', fontSize: 13, marginBottom: 14 }}>{t(lang, 'portal_pkg_empty')}</p>
      )}
      {pkgs.map((p, i) => (
        <div key={p.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 10 }}>
          <div className="form-group" style={{ flex: 2, margin: 0 }}>
            <label>{t(lang, 'portal_pkg_name')}</label>
            <input value={p.label} onChange={e => setField(i, 'label', e.target.value)} />
          </div>
          <div className="form-group" style={{ flex: 1, margin: 0 }}>
            <label>{t(lang, 'portal_pkg_qty')}</label>
            <input type="number" value={p.quantity} min={0}
              onChange={e => setField(i, 'quantity', Number(e.target.value))} />
          </div>
          <div className="form-group" style={{ flex: 1, margin: 0 }}>
            <label>{t(lang, 'portal_pkg_price')}</label>
            <input type="number" value={p.price} min={0}
              onChange={e => setField(i, 'price', Number(e.target.value))} />
          </div>
          <button className="btn btn-secondary" style={{ flexShrink: 0 }} onClick={() => remove(i)}>
            {t(lang, 'delete')}
          </button>
        </div>
      ))}
      <button className="btn btn-secondary" onClick={add} style={{ marginTop: 8 }}>
        {t(lang, 'portal_pkg_add')}
      </button>
    </div>
  );
}

// ── Descriptions tab ───────────────────────────────────────────────────────────
function DescriptionsTab({ lang, settings, setSettings }: {
  lang: Language;
  settings: PortalSettings;
  setSettings: React.Dispatch<React.SetStateAction<PortalSettings | null>>;
}) {
  const d = settings.portal_request_descriptions;
  const setText = (type: keyof PortalRequestDescriptions, l: LangKey, value: string) =>
    setSettings(s => (s ? {
      ...s,
      portal_request_descriptions: { ...s.portal_request_descriptions, [type]: { ...s.portal_request_descriptions[type], [l]: value } },
    } : s));

  // 단일 LocalizedText 설정 편집 (미매치 안내 / 견적 안내 문구)
  type MsgKey = 'portal_mismatch_message' | 'portal_resume_quote_prompt' | 'portal_resume_quote_sent';
  const setMsg = (key: MsgKey, l: LangKey, value: string) =>
    setSettings(s => (s ? { ...s, [key]: { ...s[key], [l]: value } } : s));

  const blocks: { type: keyof PortalRequestDescriptions; title: TranslationKey }[] = [
    { type: 'credit', title: 'portal_desc_credit_title' },
    { type: 'renewal_stop', title: 'portal_desc_stop_title' },
    { type: 'renewal_resume', title: 'portal_desc_resume_title' },
  ];
  const msgBlocks: { key: MsgKey; title: TranslationKey }[] = [
    { key: 'portal_mismatch_message', title: 'portal_msg_mismatch_title' },
    { key: 'portal_resume_quote_prompt', title: 'portal_msg_resume_prompt_title' },
    { key: 'portal_resume_quote_sent', title: 'portal_msg_resume_sent_title' },
  ];
  const langs: { key: LangKey; label: string }[] = [
    { key: 'ko', label: '🇰🇷 한국어' },
    { key: 'en', label: '🇺🇸 English' },
    { key: 'ja', label: '🇯🇵 日本語' },
  ];

  return (
    <>
      {blocks.map(b => (
        <div className="settings-section" key={b.type} style={{ marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 14px', fontSize: 13, fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {t(lang, b.title)}
          </h3>
          {langs.map(l => (
            <div className="form-group" key={l.key} style={{ marginBottom: 10 }}>
              <label>{l.label}</label>
              <textarea
                value={d[b.type][l.key]}
                onChange={e => setText(b.type, l.key, e.target.value)}
                style={{ minHeight: 56, resize: 'vertical' }}
              />
            </div>
          ))}
        </div>
      ))}
      {msgBlocks.map(b => (
        <div className="settings-section" key={b.key} style={{ marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 14px', fontSize: 13, fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {t(lang, b.title)}
          </h3>
          {langs.map(l => (
            <div className="form-group" key={l.key} style={{ marginBottom: 10 }}>
              <label>{l.label}</label>
              <textarea
                value={settings[b.key][l.key]}
                onChange={e => setMsg(b.key, l.key, e.target.value)}
                style={{ minHeight: 56, resize: 'vertical' }}
              />
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

// ── Accounts tab ───────────────────────────────────────────────────────────────
function AccountsTab({ lang, accounts, onToggle, onSync }: {
  lang: Language;
  accounts: PortalAccount[];
  onToggle: (a: PortalAccount) => void;
  onSync: (a: PortalAccount) => void;
}) {
  if (accounts.length === 0) {
    return <div className="settings-section"><p style={{ color: 'var(--text3)', fontSize: 13 }}>{t(lang, 'portal_acc_empty')}</p></div>;
  }
  return (
    <div className="settings-section" style={{ padding: 0, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: 'var(--bg3)', textAlign: 'left' }}>
            <th style={cell}>ID</th>
            <th style={cell}>{t(lang, 'portal_req_applicant')}</th>
            <th style={cell}>Email</th>
            <th style={cell}>My.exocad ID</th>
            <th style={cell}>{t(lang, 'portal_acc_created')}</th>
            <th style={cell}>{t(lang, 'col_status')}</th>
            <th style={cell}></th>
          </tr>
        </thead>
        <tbody>
          {accounts.map(a => {
            const mismatch = a.customer_mismatch ? JSON.parse(a.customer_mismatch) as Record<string, [string, string]> : null;
            return (
              <tr key={a.id} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={cell}>{a.login_id}</td>
                <td style={cell}>
                  <div>{a.name}</div>
                  {mismatch && (
                    <div style={{ color: 'var(--orange)', fontSize: 11, marginTop: 2 }}>
                      ⚠ {t(lang, 'portal_acc_mismatch')}:{' '}
                      {Object.entries(mismatch).map(([f, [old, nw]]) => `${f}: "${old}"→"${nw}"`).join(', ')}
                    </div>
                  )}
                </td>
                <td style={cell}>{a.email}</td>
                <td style={cell}>{a.exocad_id || '—'}</td>
                <td style={cell}>{a.created_at?.slice(0, 10)}</td>
                <td style={cell}>
                  <span style={{ color: a.status === 'active' ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
                    {a.status === 'active' ? t(lang, 'portal_acc_active') : t(lang, 'portal_acc_disabled')}
                  </span>
                </td>
                <td style={{ ...cell, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {mismatch && (
                    <button className="btn btn-danger btn-sm" onClick={() => onSync(a)}>
                      {t(lang, 'portal_acc_sync')}
                    </button>
                  )}
                  <button className="btn btn-secondary btn-sm" onClick={() => onToggle(a)}>
                    {a.status === 'active' ? t(lang, 'portal_acc_disable') : t(lang, 'portal_acc_enable')}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Requests tab ───────────────────────────────────────────────────────────────
function RequestsTab({ lang, requests, filter, onFilter, onDecide, creditPackages }: {
  lang: Language;
  requests: AdminRequest[];
  filter: string;
  onFilter: (f: string) => void;
  onDecide: (r: AdminRequest, action: 'approve' | 'reject') => void;
  creditPackages: CreditPackage[];
}) {
  const FILTERS: { id: string; key: TranslationKey }[] = [
    { id: '', key: 'portal_req_filter_all' },
    { id: 'credit', key: 'portal_type_credit' },
    { id: 'renewal_stop', key: 'portal_type_renewal_stop' },
    { id: 'renewal_resume', key: 'portal_type_renewal_resume' },
  ];
  const isActionable = (r: AdminRequest) =>
    r.status === 'pending' || r.status === 'manager_review' ||
    (r.status === 'rejected' && r.note === 'playwright_failed');

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {FILTERS.map(f => (
          <button key={f.id}
            className={`btn btn-sm ${filter === f.id ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => onFilter(f.id)}>
            {t(lang, f.key)}
          </button>
        ))}
      </div>

      <div className="settings-section" style={{ padding: 0, overflow: 'hidden' }}>
        {requests.length === 0 ? (
          <p style={{ color: 'var(--text3)', fontSize: 13, padding: '14px 16px' }}>{t(lang, 'portal_req_empty')}</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--bg3)', textAlign: 'left' }}>
                <th style={cell}>#</th>
                <th style={cell}>{t(lang, 'portal_req_applicant')}</th>
                <th style={cell}>{t(lang, 'portal_tab_settings')}</th>
                <th style={cell}>{t(lang, 'portal_req_detail')}</th>
                <th style={cell}>{t(lang, 'col_status')}</th>
                <th style={cell}>{t(lang, 'col_date')}</th>
                <th style={cell}></th>
              </tr>
            </thead>
            <tbody>
              {requests.map(r => (
                <tr key={r.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={cell}>{r.id}</td>
                  <td style={cell}>
                    {r.account_name}
                    <div style={{ color: 'var(--text3)', fontSize: 11 }}>{r.account_login_id}</div>
                    <div style={{ color: 'var(--text3)', fontSize: 11 }}>{r.account_email}</div>
                  </td>
                  <td style={cell}>{TYPE_KEY[r.type] ? t(lang, TYPE_KEY[r.type]) : r.type}</td>
                  <td style={cell}>
                    {r.type === 'credit' ? (() => {
                      const pkg = r.package_code ? creditPackages.find(p => p.id === r.package_code) : null;
                      return <>
                        {pkg
                          ? <div>{pkg.label} <span style={{ color: 'var(--accent)', fontWeight: 600 }}>×{pkg.quantity}</span></div>
                          : r.package_code ? <div>{r.package_code}</div> : null}
                        {r.exocad_id && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>ID: {r.exocad_id}</div>}
                      </>;
                    })() : (
                      <div>{r.target_serial || r.exocad_id || '—'}</div>
                    )}
                    {r.note === 'quote_requested' && (
                      <div style={{ fontSize: 11, color: 'var(--accent)', marginTop: 2 }}>
                        {t(lang, 'portal_quote_requested')}
                      </div>
                    )}
                  </td>
                  <td style={cell}>
                    {r.status === 'rejected' && r.note === 'playwright_failed' ? (
                      <span style={{ color: 'var(--red)', fontWeight: 600 }}>
                        {t(lang, 'portal_st_cancel_failed')}
                      </span>
                    ) : (
                      <span style={{ color: STATUS_COLOR[r.status] || 'var(--text2)', fontWeight: 600 }}>
                        {STATUS_KEY[r.status] ? t(lang, STATUS_KEY[r.status]) : r.status}
                      </span>
                    )}
                  </td>
                  <td style={{ ...cell, fontSize: 12, color: 'var(--text3)', whiteSpace: 'nowrap' }}>
                    {r.created_at.slice(0, 16).replace('T', ' ')}
                  </td>
                  <td style={cell}>
                    {isActionable(r) && (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn-sm" style={{ background: 'var(--green)', color: '#0d0f12' }}
                          onClick={() => onDecide(r, 'approve')}>
                          {t(lang, 'portal_req_approve')}
                        </button>
                        <button className="btn btn-sm" style={{ background: 'var(--red)', color: '#fff' }}
                          onClick={() => onDecide(r, 'reject')}>
                          {t(lang, 'portal_req_reject')}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const cell: React.CSSProperties = { padding: '8px 12px', verticalAlign: 'middle' };
