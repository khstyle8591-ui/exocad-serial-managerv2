import React, { useState, useEffect, useCallback } from 'react';
import TemplateEditor from '../components/TemplateEditor';
import { useLang } from '../App';
import { t } from '../i18n';

interface MailTemplate {
  id: number;
  code: string;
  name: string;
  subject: string;
  body: string;
  is_builtin: number;
  enabled: number;
  updated_at: string;
}

type Tab = 'templates' | 'inbound' | 'smtp';

const badgeStyle = (color: string): React.CSSProperties => ({
  display: 'inline-block', padding: '1px 8px', borderRadius: 10,
  fontSize: 11, fontWeight: 600,
  background: color === 'blue' ? 'rgba(29,78,216,0.15)' : 'var(--bg3)',
  color: color === 'blue' ? '#60a5fa' : 'var(--text3)',
});

const CLASSIF_STYLE: Record<string, { bg: string; color: string }> = {
  stop_request_candidate: { bg: 'rgba(194,65,12,0.15)',  color: '#fb923c' },
  stop_request:           { bg: 'rgba(194,65,12,0.15)',  color: '#fb923c' },
  renewal_request:        { bg: 'rgba(34,197,94,0.12)',  color: '#22c55e' },
  missing_info:           { bg: 'rgba(234,179,8,0.14)',   color: '#facc15' },
  unrelated:              { bg: 'rgba(29,78,216,0.15)',  color: '#60a5fa' },
  unclassified:           { bg: 'var(--bg3)',             color: 'var(--text3)' },
  error:                  { bg: 'rgba(220,38,38,0.15)',   color: '#fc8181' },
};

const CLASSIF_I18N_KEY: Record<string, string> = {
  stop_request_candidate: 'mail_classif_stop_candidate',
  stop_request:           'mail_classif_stop_candidate',
  renewal_request:        'mail_classif_renewal_request',
  missing_info:           'mail_classif_missing_info',
  unrelated:              'mail_classif_unrelated',
  unclassified:           'mail_classif_unclassified',
  error:                  'mail_classif_error',
};

function btnStyle(color: string, disabled: boolean): React.CSSProperties {
  return {
    padding: '7px 14px', fontSize: 12, borderRadius: 6, border: 'none',
    background: disabled ? 'var(--bg4)' : color,
    color: disabled ? 'var(--text3)' : '#0d1117',
    cursor: disabled ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' as const,
  };
}

function resultBox(ok: boolean): React.CSSProperties {
  return {
    marginTop: 10, padding: '9px 12px', borderRadius: 7, fontSize: 13,
    background: ok ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
    border: `1px solid ${ok ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
    color: ok ? '#22c55e' : '#fc8181',
  };
}

export default function MailSystem() {
  const { lang } = useLang();
  const [tab, setTab] = useState<Tab>('templates');
  const [templates, setTemplates] = useState<MailTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [editorTarget, setEditorTarget] = useState<MailTemplate | null | 'new'>(undefined as any);

  const [inboundMails, setInboundMails] = useState<any[]>([]);
  const [inboundLoading, setInboundLoading] = useState(false);
  const [inboundFilter, setInboundFilter] = useState<string>('all');
  const [checkLoading, setCheckLoading] = useState(false);
  const [checkResult, setCheckResult] = useState<{ processed: number; saved: number; errors: string[] } | null>(null);
  const [dryRunInboundLoading, setDryRunInboundLoading] = useState(false);
  const [dryRunInboundResult, setDryRunInboundResult] = useState<any | null>(null);
  const [connTestLoading, setConnTestLoading] = useState(false);
  const [connTestResult, setConnTestResult] = useState<{ success: boolean; message: string; mail_count?: number } | null>(null);
  const [inboundSettings, setInboundSettings] = useState<any>(null);
  const [selectedMail, setSelectedMail] = useState<any | null>(null);
  const [confirmingMailId, setConfirmingMailId] = useState<number | null>(null);
  const [sendingMissingInfoId, setSendingMissingInfoId] = useState<number | null>(null);

  const [smtpTesting, setSmtpTesting] = useState(false);
  const [smtpResult, setSmtpResult] = useState<{ success: boolean; message: string } | null>(null);
  const [dryRunLoading, setDryRunLoading] = useState(false);
  const [dryRunResult, setDryRunResult] = useState<{ success: boolean; message: string } | null>(null);
  const [settings, setSettings] = useState<any>(null);

  const classifBadge = (c: string) => {
    const style = CLASSIF_STYLE[c] ?? CLASSIF_STYLE.unclassified;
    const i18nKey = CLASSIF_I18N_KEY[c] ?? 'mail_classif_unclassified';
    return (
      <span style={{ display: 'inline-block', padding: '1px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, background: style.bg, color: style.color }}>
        {t(lang, i18nKey as any)}
      </span>
    );
  };

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const list = await window.electronAPI.listMailTemplates();
      setTemplates(list);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSettings = useCallback(async () => {
    const s = await window.electronAPI.getSettings();
    setSettings(s);
  }, []);

  useEffect(() => { loadTemplates(); }, [loadTemplates]);

  const loadInboundMails = useCallback(async (filter?: string) => {
    setInboundLoading(true);
    try {
      const f = filter ?? inboundFilter;
      const classification = f === 'all' ? undefined : [f];
      const list = await window.electronAPI.listInboundMails({ classification, limit: 100 });
      setInboundMails(list);
    } finally {
      setInboundLoading(false);
    }
  }, [inboundFilter]);

  const loadInboundSettings = useCallback(async () => {
    if (!inboundSettings) {
      const s = await window.electronAPI.getSettings();
      setInboundSettings(s);
    }
  }, [inboundSettings]);

  useEffect(() => {
    if (tab === 'smtp') loadSettings();
    if (tab === 'inbound') { loadInboundMails(); loadInboundSettings(); }
  }, [tab, loadSettings, loadInboundMails, loadInboundSettings]);

  const handleSave = async (input: any) => {
    await window.electronAPI.upsertMailTemplate(input);
    setEditorTarget(undefined as any);
    await loadTemplates();
  };

  const handleDelete = async (tmpl: MailTemplate) => {
    const msg = t(lang, 'mail_delete_confirm').replace('{name}', tmpl.name);
    if (!confirm(msg)) return;
    try {
      await window.electronAPI.deleteMailTemplate(tmpl.code);
      await loadTemplates();
    } catch (e: any) {
      alert(e.message ?? t(lang, 'mail_delete_fail'));
    }
  };

  const handleToggleEnabled = async (tmpl: MailTemplate) => {
    await window.electronAPI.upsertMailTemplate({
      id: tmpl.id, code: tmpl.code, name: tmpl.name,
      subject: tmpl.subject, body: tmpl.body, enabled: tmpl.enabled === 0,
    });
    await loadTemplates();
  };

  const handleSmtpTest = async () => {
    setSmtpTesting(true); setSmtpResult(null);
    try { setSmtpResult(await window.electronAPI.testSmtp()); }
    finally { setSmtpTesting(false); }
  };

  const handleConnTest = async () => {
    setConnTestLoading(true); setConnTestResult(null);
    try { setConnTestResult(await window.electronAPI.testMailConnection()); }
    finally { setConnTestLoading(false); }
  };

  const handleCheckNow = async () => {
    setCheckLoading(true); setCheckResult(null);
    try {
      const r = await window.electronAPI.checkInboundNow();
      setCheckResult(r);
      await loadInboundMails();
    } finally { setCheckLoading(false); }
  };

  const handleDryRunInbound = async () => {
    setDryRunInboundLoading(true); setDryRunInboundResult(null);
    try { setDryRunInboundResult(await window.electronAPI.inboundDryRun()); }
    finally { setDryRunInboundLoading(false); }
  };

  const handleFilterChange = (f: string) => {
    setInboundFilter(f);
    loadInboundMails(f);
  };

  const matchedKeywords = (raw: string | null | undefined): string[] => {
    try {
      const parsed = JSON.parse(raw || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const missingFields = (raw: string | null | undefined): string[] => {
    try {
      const parsed = JSON.parse(raw || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const missingFieldText = (field: string) => {
    if (field === 'serial') return t(lang, 'mail_missing_serial' as any);
    if (field === 'stop_keyword') return t(lang, 'mail_missing_stop_keyword' as any);
    return field;
  };

  const handleConfirmStopRequest = async (mail: any) => {
    if (!mail?.id) return;
    if (!mail.extracted_serial && !mail.linked_serial_id) {
      alert(t(lang, 'mail_confirm_stop_no_serial' as any));
      return;
    }
    if (!confirm(t(lang, 'mail_confirm_stop_prompt' as any).replace('{serial}', mail.extracted_serial || ''))) return;

    setConfirmingMailId(mail.id);
    try {
      const result = await window.electronAPI.confirmStopRequestFromMail(mail.id);
      if (!result.success) {
        alert(result.error || t(lang, 'mail_confirm_stop_fail' as any));
        return;
      }
      alert(t(lang, 'mail_confirm_stop_done' as any).replace('{serial}', result.serial_number || ''));
      setSelectedMail(null);
      await loadInboundMails();
    } finally {
      setConfirmingMailId(null);
    }
  };

  const handleSendMissingInfoTemplate = async (mail: any) => {
    if (!mail?.id) return;
    setSendingMissingInfoId(mail.id);
    try {
      const result = await window.electronAPI.sendMissingInfoTemplateForMail(mail.id);
      alert(result.message);
      if (result.success) {
        setSelectedMail(null);
        await loadInboundMails();
      }
    } finally {
      setSendingMissingInfoId(null);
    }
  };

  const handleDryRun = async () => {
    setDryRunLoading(true); setDryRunResult(null);
    try { setDryRunResult(await window.electronAPI.sendTestDryRun()); }
    finally { setDryRunLoading(false); }
  };

  const tabBtn = (id: Tab, labelKey: string) => (
    <button
      onClick={() => setTab(id)}
      style={{
        padding: '8px 20px', fontSize: 13, fontWeight: 600,
        border: 'none', background: 'none', cursor: 'pointer',
        borderBottom: tab === id ? '2px solid var(--accent)' : '2px solid transparent',
        color: tab === id ? 'var(--accent)' : 'var(--text3)',
      }}
    >
      {t(lang, labelKey as any)}
    </button>
  );

  const checkResultText = checkResult
    ? t(lang, 'mail_check_result')
        .replace('{saved}', String(checkResult.saved))
        .replace('{processed}', String(checkResult.processed)) +
      (checkResult.errors.length > 0
        ? t(lang, 'mail_check_result_error_suffix').replace('{n}', String(checkResult.errors.length))
        : '')
    : '';

  const dryRunHeaderText = dryRunInboundResult
    ? t(lang, 'mail_dryrun_header')
        .replace('{total}', String(dryRunInboundResult.total_checked))
        .replace('{would_save}', String(dryRunInboundResult.would_save))
        .replace('{would_skip}', String(dryRunInboundResult.would_skip))
    : '';

  return (
    <div style={{ padding: 28, minHeight: '100%' }}>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>Mail System</h2>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text3)' }}>
          {t(lang, 'mail_subtitle')}
        </p>
      </div>

      {/* Tab bar */}
      <div style={{
        display: 'flex', borderBottom: '1px solid var(--border)',
        marginBottom: 24, background: 'var(--bg2)',
        borderRadius: '8px 8px 0 0', padding: '0 4px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
      }}>
        {tabBtn('templates', 'mail_tab_templates')}
        {tabBtn('inbound', 'mail_tab_inbound')}
        {tabBtn('smtp', 'mail_tab_smtp')}
      </div>

      {/* Templates tab */}
      {tab === 'templates' && (
        <div style={{ background: 'var(--bg2)', borderRadius: 10, border: '1px solid var(--border)' }}>
          <div style={{
            padding: '14px 20px', borderBottom: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
              {t(lang, 'mail_template_list')} ({templates.length})
            </span>
            <button
              onClick={() => setEditorTarget('new')}
              style={{
                padding: '6px 14px', fontSize: 13, borderRadius: 6,
                border: 'none', background: 'var(--accent)', color: '#0d1117', cursor: 'pointer',
              }}
            >
              {t(lang, 'mail_btn_new')}
            </button>
          </div>

          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
              {t(lang, 'loading')}
            </div>
          ) : templates.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
              {t(lang, 'mail_no_templates')}
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--bg3)' }}>
                  {(['mail_col_enabled', 'mail_col_name', 'mail_col_code', 'mail_col_type', 'mail_col_updated', 'col_actions'] as const).map(hKey => (
                    <th key={hKey} style={{
                      padding: '9px 16px', fontSize: 11, fontWeight: 700,
                      color: 'var(--text3)', textAlign: 'left', borderBottom: '1px solid var(--border)',
                    }}>{t(lang, hKey)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {templates.map((tmpl, i) => (
                  <tr key={tmpl.id} style={{ background: i % 2 === 0 ? 'var(--bg2)' : 'var(--bg3)' }}>
                    <td style={{ padding: '10px 16px' }}>
                      <input
                        type="checkbox"
                        checked={tmpl.enabled === 1}
                        onChange={() => handleToggleEnabled(tmpl)}
                        style={{ cursor: 'pointer', width: 15, height: 15 }}
                      />
                    </td>
                    <td style={{ padding: '10px 16px', fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>
                      {tmpl.name}
                    </td>
                    <td style={{ padding: '10px 16px' }}>
                      <code style={{ fontSize: 11, background: 'var(--bg3)', padding: '2px 6px', borderRadius: 4, color: 'var(--text)' }}>
                        {tmpl.code}
                      </code>
                    </td>
                    <td style={{ padding: '10px 16px' }}>
                      {tmpl.is_builtin === 1
                        ? <span style={badgeStyle('blue')}>{t(lang, 'mail_builtin')}</span>
                        : <span style={badgeStyle('gray')}>{t(lang, 'mail_custom')}</span>
                      }
                    </td>
                    <td style={{ padding: '10px 16px', fontSize: 12, color: 'var(--text3)' }}>
                      {tmpl.updated_at?.slice(0, 10) ?? '—'}
                    </td>
                    <td style={{ padding: '10px 16px' }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          onClick={() => setEditorTarget(tmpl)}
                          style={{
                            padding: '3px 10px', fontSize: 12, borderRadius: 5,
                            border: '1px solid var(--border2)', background: 'var(--bg3)',
                            color: 'var(--text)', cursor: 'pointer',
                          }}
                        >
                          {t(lang, 'edit')}
                        </button>
                        {tmpl.is_builtin === 0 && (
                          <button
                            onClick={() => handleDelete(tmpl)}
                            style={{
                              padding: '3px 10px', fontSize: 12, borderRadius: 5,
                              border: '1px solid rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.1)',
                              color: '#fc8181', cursor: 'pointer',
                            }}
                          >
                            {t(lang, 'delete')}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Inbound tab */}
      {tab === 'inbound' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ background: 'var(--bg2)', borderRadius: 10, border: '1px solid var(--border)', padding: 20 }}>
            <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{t(lang, 'mail_inbound_settings_title')}</h4>
            {inboundSettings && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 24px', fontSize: 13, marginBottom: 14 }}>
                {[
                  [t(lang, 'mail_col_protocol'), inboundSettings.mail_protocol?.toUpperCase() || '—'],
                  [t(lang, 'mail_col_host'), (inboundSettings.mail_protocol === 'imap' ? inboundSettings.imap_host : inboundSettings.pop3_host) || '—'],
                  [t(lang, 'mail_col_port'), (inboundSettings.mail_protocol === 'imap' ? inboundSettings.imap_port : inboundSettings.pop3_port) || '—'],
                  [t(lang, 'mail_col_user_label'), (inboundSettings.mail_protocol === 'imap' ? inboundSettings.imap_user : inboundSettings.pop3_user) || '—'],
                ].map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', gap: 8 }}>
                    <span style={{ color: 'var(--text3)', minWidth: 80 }}>{k}</span>
                    <span style={{ fontWeight: 500, color: 'var(--text)' }}>{v}</span>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <button onClick={handleConnTest} disabled={connTestLoading} style={btnStyle('var(--accent)', connTestLoading)}>
                {connTestLoading ? t(lang, 'mail_btn_conn_testing') : t(lang, 'mail_btn_conn_test')}
              </button>
              <button onClick={handleCheckNow} disabled={checkLoading} style={btnStyle('var(--accent)', checkLoading)}>
                {checkLoading ? t(lang, 'mail_checking') : t(lang, 'mail_btn_check_now')}
              </button>
              <button onClick={handleDryRunInbound} disabled={dryRunInboundLoading} style={btnStyle('#22c55e', dryRunInboundLoading)}>
                {dryRunInboundLoading ? t(lang, 'mail_dryrun_loading') : t(lang, 'mail_btn_dryrun')}
              </button>
            </div>
            {connTestResult && (
              <div style={resultBox(connTestResult.success)}>
                {connTestResult.success ? '✅ ' : '❌ '}{connTestResult.message}
                {connTestResult.mail_count !== undefined && ` (${connTestResult.mail_count}${t(lang, 'mail_count_suffix')})`}
              </div>
            )}
            {checkResult && (
              <div style={resultBox(checkResult.errors.length === 0)}>
                {checkResult.errors.length === 0 ? '✅ ' : '⚠️ '}
                {checkResultText}
              </div>
            )}
          </div>

          {dryRunInboundResult && (
            <div style={{ background: 'var(--bg2)', borderRadius: 10, border: '1px solid var(--border)', padding: 20 }}>
              <h4 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
                {dryRunHeaderText}
              </h4>
              {dryRunInboundResult.error && (
                <div style={{ color: '#fc8181', fontSize: 13 }}>{t(lang, 'mail_dryrun_error')}{dryRunInboundResult.error}</div>
              )}
              {dryRunInboundResult.entries?.length > 0 && (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: 'var(--bg3)' }}>
                      {(['mail_col_classif', 'mail_col_from', 'mail_col_subject', 'mail_col_date_label', 'mail_col_serial_label', 'mail_col_duplicate'] as const).map(hKey => (
                        <th key={hKey} style={{ padding: '6px 10px', textAlign: 'left', borderBottom: '1px solid var(--border)', color: 'var(--text3)', fontWeight: 700 }}>
                          {t(lang, hKey)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {dryRunInboundResult.entries.map((e: any, i: number) => (
                      <tr key={i} style={{ background: i % 2 === 0 ? 'var(--bg2)' : 'var(--bg3)' }}>
                        <td style={{ padding: '6px 10px' }}>{classifBadge(e.classification)}</td>
                        <td style={{ padding: '6px 10px', color: 'var(--text)', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.from}</td>
                        <td style={{ padding: '6px 10px', color: 'var(--text)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.subject}</td>
                        <td style={{ padding: '6px 10px', color: 'var(--text3)' }}>{e.date?.slice(0, 10)}</td>
                        <td style={{ padding: '6px 10px' }}>
                          {e.extracted_serial
                            ? <code style={{ fontSize: 11, background: 'var(--bg3)', padding: '1px 5px', borderRadius: 3, color: 'var(--text)' }}>{e.extracted_serial}</code>
                            : <span style={{ color: 'var(--text3)' }}>—</span>}
                        </td>
                        <td style={{ padding: '6px 10px', color: 'var(--text)' }}>{e.is_duplicate ? t(lang, 'mail_duplicate') : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          <div style={{ background: 'var(--bg2)', borderRadius: 10, border: '1px solid var(--border)' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{t(lang, 'mail_inbound_list')} ({inboundMails.length})</span>
              <div style={{ display: 'flex', gap: 6 }}>
                {(['all', 'stop_request_candidate', 'missing_info', 'renewal_request', 'unrelated', 'error'] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => handleFilterChange(f)}
                    style={{
                      padding: '3px 10px', fontSize: 11, borderRadius: 10,
                      border: `1px solid ${inboundFilter === f ? 'var(--accent)' : 'var(--border2)'}`,
                      background: inboundFilter === f ? 'var(--accent)' : 'var(--bg3)',
                      color: inboundFilter === f ? '#0d1117' : 'var(--text)',
                      cursor: 'pointer',
                    }}
                  >
                    {f === 'all' ? t(lang, 'mail_filter_all') : t(lang, (CLASSIF_I18N_KEY[f] ?? 'mail_classif_unclassified') as any)}
                  </button>
                ))}
                <button onClick={() => loadInboundMails()} style={{ padding: '3px 10px', fontSize: 11, borderRadius: 6, border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--text)', cursor: 'pointer' }}>
                  {t(lang, 'mail_btn_refresh')}
                </button>
              </div>
            </div>

            {inboundLoading ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>{t(lang, 'loading')}</div>
            ) : inboundMails.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>{t(lang, 'mail_no_inbound')}</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--bg3)' }}>
                    {(['mail_col_classif', 'mail_col_from', 'mail_col_subject', 'mail_col_received', 'mail_col_serial_label', 'mail_col_processed_label'] as const).map(hKey => (
                      <th key={hKey} style={{ padding: '8px 14px', fontSize: 11, fontWeight: 700, color: 'var(--text3)', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                        {t(lang, hKey)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {inboundMails.map((m, i) => (
                    <tr
                      key={m.id}
                      onClick={() => setSelectedMail(m)}
                      style={{ background: i % 2 === 0 ? 'var(--bg2)' : 'var(--bg3)', cursor: 'pointer' }}
                    >
                      <td style={{ padding: '8px 14px' }}>{classifBadge(m.classification)}</td>
                      <td style={{ padding: '8px 14px', fontSize: 12, color: 'var(--text)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.mail_from}</td>
                      <td style={{ padding: '8px 14px', fontSize: 12, color: 'var(--text)', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.subject}</div>
                        <div style={{ color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String(m.body || '').slice(0, 90)}</div>
                      </td>
                      <td style={{ padding: '8px 14px', fontSize: 11, color: 'var(--text3)' }}>{m.received_at?.slice(0, 16)}</td>
                      <td style={{ padding: '8px 14px' }}>
                        {m.extracted_serial
                          ? <code style={{ fontSize: 11, background: 'var(--bg3)', padding: '1px 5px', borderRadius: 3, color: 'var(--text)' }}>{m.extracted_serial}</code>
                          : <span style={{ color: 'var(--text3)', fontSize: 11 }}>—</span>}
                      </td>
                      <td style={{ padding: '8px 14px' }}>
                        <span style={{ fontSize: 11, color: m.processed ? '#22c55e' : 'var(--text3)' }}>
                          {m.template_sent_at ? t(lang, 'mail_template_sent' as any) : m.processed ? t(lang, 'mail_processed') : t(lang, 'mail_not_processed')}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* SMTP tab */}
      {tab === 'smtp' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ background: 'var(--bg2)', borderRadius: 10, border: '1px solid var(--border)', padding: 20 }}>
            <h4 style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{t(lang, 'mail_smtp_current_title')}</h4>
            {settings ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 24px', fontSize: 13 }}>
                {[
                  [t(lang, 'mail_col_host'), settings.smtp_host || '—'],
                  [t(lang, 'mail_col_port'), settings.smtp_port || '—'],
                  [t(lang, 'mail_col_user_label'), settings.smtp_user || '—'],
                  [t(lang, 'mail_smtp_tls_label'), settings.smtp_tls ? 'ON' : 'OFF'],
                  [t(lang, 'mail_smtp_report_to'), settings.report_email_to || '—'],
                  [t(lang, 'mail_smtp_test_addr'), settings.smtp_test_address || '—'],
                ].map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', gap: 8 }}>
                    <span style={{ color: 'var(--text3)', minWidth: 110 }}>{k}</span>
                    <span style={{ fontWeight: 500, color: 'var(--text)' }}>{v}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ color: 'var(--text3)', fontSize: 13 }}>{t(lang, 'loading')}</p>
            )}
            <p style={{ margin: '12px 0 0', fontSize: 12, color: 'var(--text3)' }}>
              {t(lang, 'mail_smtp_change_note')}
            </p>
          </div>

          <div style={{ background: 'var(--bg2)', borderRadius: 10, border: '1px solid var(--border)', padding: 20 }}>
            <h4 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{t(lang, 'mail_smtp_conn_title')}</h4>
            <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--text3)' }}>
              {t(lang, 'mail_smtp_conn_desc')}
            </p>
            <button
              onClick={handleSmtpTest}
              disabled={smtpTesting}
              style={{
                padding: '8px 20px', fontSize: 13, borderRadius: 6,
                border: 'none', background: 'var(--accent)', color: '#0d1117',
                cursor: smtpTesting ? 'not-allowed' : 'pointer',
                opacity: smtpTesting ? 0.7 : 1,
              }}
            >
              {smtpTesting ? t(lang, 'mail_smtp_testing') : t(lang, 'mail_smtp_btn_test')}
            </button>
            {smtpResult && (
              <div style={{
                marginTop: 12, padding: '10px 14px', borderRadius: 8,
                background: smtpResult.success ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
                border: `1px solid ${smtpResult.success ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
                fontSize: 13,
                color: smtpResult.success ? '#22c55e' : '#fc8181',
              }}>
                {smtpResult.success ? '✅ ' : '❌ '}{smtpResult.message}
              </div>
            )}
          </div>

          <div style={{ background: 'var(--bg2)', borderRadius: 10, border: '1px solid var(--border)', padding: 20 }}>
            <h4 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{t(lang, 'mail_smtp_send_title')}</h4>
            <p style={{ margin: '0 0 6px', fontSize: 13, color: 'var(--text3)' }}>
              {t(lang, 'mail_smtp_send_desc')}
            </p>
            <p style={{ margin: '0 0 14px', fontSize: 12, color: 'var(--text3)' }}>
              {settings?.smtp_test_address || settings?.report_email_to || t(lang, 'mail_smtp_not_set')}
            </p>
            <button
              onClick={handleDryRun}
              disabled={dryRunLoading}
              style={{
                padding: '8px 20px', fontSize: 13, borderRadius: 6,
                border: 'none', background: '#22c55e', color: '#0d1117',
                cursor: dryRunLoading ? 'not-allowed' : 'pointer',
                opacity: dryRunLoading ? 0.7 : 1,
              }}
            >
              {dryRunLoading ? t(lang, 'mail_smtp_sending') : t(lang, 'mail_smtp_btn_send')}
            </button>
            {dryRunResult && (
              <div style={{
                marginTop: 12, padding: '10px 14px', borderRadius: 8,
                background: dryRunResult.success ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
                border: `1px solid ${dryRunResult.success ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
                fontSize: 13,
                color: dryRunResult.success ? '#22c55e' : '#fc8181',
              }}>
                {dryRunResult.success ? '✅ ' : '❌ '}{dryRunResult.message}
              </div>
            )}
          </div>
        </div>
      )}

      {editorTarget !== undefined && (
        <TemplateEditor
          template={editorTarget === 'new' ? null : editorTarget}
          onSave={handleSave}
          onClose={() => setEditorTarget(undefined as any)}
        />
      )}

      {selectedMail && (
        <div
          onClick={() => setSelectedMail(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.62)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ width: 'min(820px, 94vw)', maxHeight: '86vh', overflow: 'hidden', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: '0 24px 80px rgba(0,0,0,0.45)', display: 'flex', flexDirection: 'column' }}
          >
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                  {classifBadge(selectedMail.classification)}
                  <span style={{ color: 'var(--text3)', fontSize: 12 }}>{selectedMail.received_at?.slice(0, 16)}</span>
                </div>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {selectedMail.subject || t(lang, 'mail_no_subject' as any)}
                </div>
              </div>
              <button onClick={() => setSelectedMail(null)} style={{ border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--text)', borderRadius: 6, padding: '5px 10px', cursor: 'pointer' }}>
                {t(lang, 'close' as any)}
              </button>
            </div>

            <div style={{ padding: '14px 18px', overflow: 'auto' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: '7px 12px', fontSize: 13, marginBottom: 14 }}>
                <span style={{ color: 'var(--text3)' }}>{t(lang, 'mail_col_from')}</span>
                <span style={{ color: 'var(--text)' }}>{selectedMail.mail_from}</span>
                <span style={{ color: 'var(--text3)' }}>To</span>
                <span style={{ color: 'var(--text)' }}>{selectedMail.mail_to || '—'}</span>
                <span style={{ color: 'var(--text3)' }}>{t(lang, 'mail_col_serial_label')}</span>
                <span>{selectedMail.extracted_serial ? <code style={{ fontSize: 12, background: 'var(--bg3)', padding: '2px 6px', borderRadius: 4, color: 'var(--text)' }}>{selectedMail.extracted_serial}</code> : <span style={{ color: 'var(--text3)' }}>—</span>}</span>
                <span style={{ color: 'var(--text3)' }}>{t(lang, 'mail_dryrun_col_keyword' as any)}</span>
                <span style={{ color: 'var(--text)' }}>{matchedKeywords(selectedMail.matched_keywords).join(', ') || '—'}</span>
                {selectedMail.classification === 'missing_info' && (
                  <>
                    <span style={{ color: 'var(--text3)' }}>{t(lang, 'mail_missing_fields' as any)}</span>
                    <span style={{ color: '#facc15', fontWeight: 700 }}>
                      {missingFields(selectedMail.missing_fields).map(missingFieldText).join(', ') || '—'}
                    </span>
                  </>
                )}
              </div>

              {selectedMail.classification === 'stop_request_candidate' && (
                <div style={{ marginBottom: 14, padding: 12, border: '1px solid rgba(251,146,60,0.35)', background: 'rgba(194,65,12,0.12)', borderRadius: 7 }}>
                  <div style={{ fontSize: 13, color: '#fb923c', fontWeight: 700, marginBottom: 8 }}>
                    {t(lang, 'mail_stop_candidate_notice' as any)}
                  </div>
                  <button
                    disabled={confirmingMailId === selectedMail.id || !!selectedMail.processed}
                    onClick={() => handleConfirmStopRequest(selectedMail)}
                    style={{
                      padding: '7px 12px', borderRadius: 6, border: 'none',
                      background: selectedMail.processed ? 'var(--bg4)' : '#fb923c',
                      color: selectedMail.processed ? 'var(--text3)' : '#111827',
                      cursor: confirmingMailId === selectedMail.id || selectedMail.processed ? 'not-allowed' : 'pointer',
                      fontSize: 12, fontWeight: 700,
                    }}
                  >
                    {selectedMail.processed ? t(lang, 'mail_confirm_stop_processed' as any) : confirmingMailId === selectedMail.id ? t(lang, 'saving') : t(lang, 'mail_confirm_stop_action' as any)}
                  </button>
                </div>
              )}

              {selectedMail.classification === 'missing_info' && (
                <div style={{ marginBottom: 14, padding: 12, border: '1px solid rgba(234,179,8,0.35)', background: 'rgba(234,179,8,0.1)', borderRadius: 7 }}>
                  <div style={{ fontSize: 13, color: '#facc15', fontWeight: 700, marginBottom: 8 }}>
                    {selectedMail.template_sent_at
                      ? t(lang, 'mail_missing_template_sent' as any).replace('{date}', selectedMail.template_sent_at)
                      : t(lang, 'mail_missing_info_notice' as any)}
                  </div>
                  <button
                    disabled={sendingMissingInfoId === selectedMail.id || !!selectedMail.template_sent_at}
                    onClick={() => handleSendMissingInfoTemplate(selectedMail)}
                    style={{
                      padding: '7px 12px', borderRadius: 6, border: 'none',
                      background: selectedMail.template_sent_at ? 'var(--bg4)' : '#facc15',
                      color: selectedMail.template_sent_at ? 'var(--text3)' : '#111827',
                      cursor: sendingMissingInfoId === selectedMail.id || selectedMail.template_sent_at ? 'not-allowed' : 'pointer',
                      fontSize: 12, fontWeight: 700,
                    }}
                  >
                    {sendingMissingInfoId === selectedMail.id ? t(lang, 'saving' as any) : t(lang, 'mail_send_missing_template' as any)}
                  </button>
                  {selectedMail.error && (
                    <div style={{ marginTop: 8, color: '#fc8181', fontSize: 12 }}>{selectedMail.error}</div>
                  )}
                </div>
              )}

              <pre style={{ margin: 0, padding: 14, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'inherit', fontSize: 13, lineHeight: 1.6, color: 'var(--text)', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 7 }}>
                {selectedMail.body || t(lang, 'mail_empty_body' as any)}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
