import React, { useEffect, useRef, useState } from 'react';
import { useLang } from '../App';
import { t } from '../i18n';
import type { Language } from '../i18n';
import { api } from '../api';
import type { ExpiryNoticeRule, MailTemplate } from '../../shared/types';

// ── UUID 단순 생성 ──────────────────────────────────────────────────────────
function genId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ── 폴링 소스 기본값 ────────────────────────────────────────────────────────
function emptySource() {
  return {
    id: genId(),
    name: '',
    url: '',
    login_url: '',
    login_id: '',
    login_pw: '',
    enabled: true,
    field_serial: '',
    field_customer: '',
    field_phone: '',
    field_purchase: '',
    field_expiry: '',
    field_product: '',
    product_filter: '',
    last_polled: '',
  };
}

function normalizeExpiryRules(settings: any): ExpiryNoticeRule[] {
  const rawRules = Array.isArray(settings.expiry_notice_rules) ? settings.expiry_notice_rules : [];
  const fallbackTemplate = settings.expiry_notice_renewal_template || 'renewal_reminder';
  const rules = rawRules
    .map((rule: any) => ({
      id: String(rule.id || genId()),
      days_before: Number(rule.days_before),
      renewal_template: String(rule.renewal_template || fallbackTemplate),
    }))
    .filter((rule: ExpiryNoticeRule) => Number.isInteger(rule.days_before) && rule.days_before >= 0 && rule.days_before <= 365);

  if (rules.length > 0) return rules;

  const legacyDays = Array.isArray(settings.expiry_notice_days) ? settings.expiry_notice_days : [90, 30, 10];
  return legacyDays
    .map((day: unknown) => Number(day))
    .filter((day: number) => Number.isInteger(day) && day >= 0 && day <= 365)
    .map((day: number) => ({ id: genId(), days_before: day, renewal_template: fallbackTemplate }));
}

function normalizeKeywordList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String).map(v => v.trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value.split(',').map(v => v.trim()).filter(Boolean);
  }
  return [];
}

// ── 매뉴얼 팝업 컴포넌트 ─────────────────────────────────────────────────────
function ManualPopup({ title, content, onClose }: { title: string; content: React.ReactNode; onClose: () => void }) {
  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
        backdropFilter: 'blur(4px)',
        zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--bg2)', border: '1px solid var(--border2)',
          borderRadius: 10, padding: '20px 24px',
          maxWidth: 520, width: '90%', maxHeight: '80vh', overflowY: 'auto',
          boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>📖 {title}</h3>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--text3)', lineHeight: 1 }}
          >✕</button>
        </div>
        <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.7 }}>{content}</div>
      </div>
    </div>
  );
}

// ── 섹션 헤더 (제목 + 매뉴얼 버튼) ───────────────────────────────────────────
function SectionHeader({ title, onManual }: { title: string; onManual: () => void }) {
  const { lang } = useLang();
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
      <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{title}</h3>
      <button
        onClick={onManual}
        title={t(lang, 'manual_tooltip')}
        style={{
          background: 'var(--bg4)', border: '1px solid var(--border2)', color: 'var(--text2)',
          borderRadius: 6, padding: '3px 10px', fontSize: 11.5, cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'inherit',
        }}
      >
        📖 {t(lang, 'manual_title')}
      </button>
    </div>
  );
}

export default function Settings() {
  const { lang, setLang } = useLang();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [manualOpen, setManualOpen] = useState<string | null>(null);
  const [loadKey, setLoadKey] = useState(0); // increment to reset defaultValue inputs

  // UI-controlling state only (things that affect what renders)
  const [protocol, setProtocol] = useState<'pop3' | 'imap'>('pop3');
  const [autoCancelEnabled, setAutoCancelEnabled] = useState(false);
  const [autoCancelTime, setAutoCancelTime] = useState('09:00');
  const [appLanguage, setAppLanguage] = useState<Language>('ko');
  const [slackLanguage, setSlackLanguage] = useState<'ko' | 'en' | 'ja'>('ko');
  const [pop3Tls, setPop3Tls] = useState(true);
  const [pop3KeepCopy, setPop3KeepCopy] = useState(false);
  const [imapTls, setImapTls] = useState(true);
  const [smtpTls, setSmtpTls] = useState(false);
  const [slackEnabled, setSlackEnabled] = useState(true);
  const [expiryNoticeEnabled, setExpiryNoticeEnabled] = useState(true);
  const [stopRequestNoticeEnabled, setStopRequestNoticeEnabled] = useState(true);
  const [cancelCompleteNoticeEnabled, setCancelCompleteNoticeEnabled] = useState(true);
  const [mailTemplates, setMailTemplates] = useState<MailTemplate[]>([]);
  const [expiryNoticeRules, setExpiryNoticeRules] = useState<ExpiryNoticeRule[]>([]);
  const [expiryDryRunEmails, setExpiryDryRunEmails] = useState<Record<string, string>>({});
  const [expiryDryRunResults, setExpiryDryRunResults] = useState<Record<string, string>>({});
  const [expiryDryRunning, setExpiryDryRunning] = useState<Record<string, boolean>>({});
  const [stopDryRunDays, setStopDryRunDays] = useState(30);
  const [stopDryRunEmail, setStopDryRunEmail] = useState('');
  const [stopDryRunResult, setStopDryRunResult] = useState<string | null>(null);
  const [stopDryRunning, setStopDryRunning] = useState(false);
  const [lifecycleDryRunEmails, setLifecycleDryRunEmails] = useState<Record<string, string>>({});
  const [lifecycleDryRunResults, setLifecycleDryRunResults] = useState<Record<string, string>>({});
  const [lifecycleDryRunning, setLifecycleDryRunning] = useState<Record<string, boolean>>({});

  // Cancel Dry-Run state
  const [cancelDryRunning, setCancelDryRunning] = useState(false);
  const [cancelDryResults, setCancelDryResults] = useState<any[] | null>(null);

  // Renewal Dry-Run state
  const [renewalDryRunning, setRenewalDryRunning] = useState(false);
  const [renewalDryRunResult, setRenewalDryRunResult] = useState<any | null>(null);

  // Mail Connection Test state
  const [connTesting, setConnTesting] = useState(false);
  const [connTestResult, setConnTestResult] = useState<any | null>(null);
  const [requireSerial, setRequireSerial] = useState(true);
  const [productKeywords, setProductKeywords] = useState<string[]>([]);
  const [actionKeywords, setActionKeywords] = useState<string[]>([]);
  const [excludeKeywords, setExcludeKeywords] = useState<string[]>([]);
  const [keywordInputs, setKeywordInputs] = useState<Record<string, string>>({});
  const [missingInfoAutoReply, setMissingInfoAutoReply] = useState(false);

  // SMTP Connection Test state
  const [smtpTesting, setSmtpTesting] = useState(false);
  const [smtpTestResult, setSmtpTestResult] = useState<any | null>(null);

  // All text/number field values stored in a ref — no re-render on change
  const formVals = useRef<any>({});
  // Poll sources managed separately (already has its own local state in child)
  const pollSourcesRef = useRef<any[]>([]);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const [data, templates] = await Promise.all([
        api.getSettings() as Promise<any>,
        api.listMailTemplates() as Promise<MailTemplate[]>,
      ]);
      // Store all values in ref
      formVals.current = { ...data };
      const loadedRules = normalizeExpiryRules(data);
      pollSourcesRef.current = data.poll_sources || [];
      // Set UI-controlling state
      setProtocol(data.mail_protocol || 'pop3');
      setAutoCancelEnabled(data.auto_cancel_enabled ?? false);
      setAutoCancelTime(data.auto_cancel_time || '09:00');
      setAppLanguage(data.app_language || 'ko');
      setSlackLanguage(data.slack_language || 'ko');
      setSlackEnabled(data.slack_enabled ?? true);
      setExpiryNoticeEnabled(data.expiry_notice_enabled ?? true);
      setStopRequestNoticeEnabled(data.stop_request_notice_enabled ?? true);
      setCancelCompleteNoticeEnabled(data.cancel_complete_notice_enabled ?? true);
      setExpiryNoticeRules(loadedRules);
      setStopDryRunDays(loadedRules[0]?.days_before ?? 30);
      setMailTemplates(templates || []);
      setPop3Tls(data.pop3_tls ?? true);
      setPop3KeepCopy(data.pop3_keep_copy ?? false);
      setImapTls(data.imap_tls ?? true);
      setSmtpTls(data.smtp_tls ?? false);
      setRequireSerial(data.require_serial_format ?? true);
      setProductKeywords(normalizeKeywordList(data.renewal_product_keywords));
      setActionKeywords(normalizeKeywordList(data.renewal_action_keywords?.length ? data.renewal_action_keywords : data.renewal_keywords));
      setExcludeKeywords(normalizeKeywordList(data.renewal_exclude_keywords));
      setKeywordInputs({});
      setMissingInfoAutoReply(data.missing_info_auto_reply_enabled ?? false);
      // Increment key to reset all defaultValue inputs with new data
      setLoadKey(k => k + 1);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // Update ref only — no re-render
  const setVal = (key: string, value: any) => {
    formVals.current[key] = value;
  };

  const setKeywordInput = (key: string, value: string) => {
    setKeywordInputs(current => ({ ...current, [key]: value }));
  };

  const addKeyword = (key: string, list: string[], setter: React.Dispatch<React.SetStateAction<string[]>>) => {
    const value = (keywordInputs[key] || '').trim();
    if (!value) return;
    setter(current => current.some(item => item.toLowerCase() === value.toLowerCase()) ? current : [...current, value]);
    setKeywordInput(key, '');
  };

  const removeKeyword = (value: string, setter: React.Dispatch<React.SetStateAction<string[]>>) => {
    setter(current => current.filter(item => item !== value));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const cleanedExpiryRules = expiryNoticeRules
        .map(rule => ({
          id: rule.id || genId(),
          days_before: Number(rule.days_before),
          renewal_template: rule.renewal_template || 'renewal_reminder',
        }))
        .filter(rule => Number.isInteger(rule.days_before) && rule.days_before >= 0 && rule.days_before <= 365);
      const finalSettings = {
        ...formVals.current,
        mail_protocol: protocol,
        auto_cancel_enabled: autoCancelEnabled,
        auto_cancel_time: autoCancelTime,
        app_language: appLanguage,
        slack_language: slackLanguage,
        slack_enabled: slackEnabled,
        expiry_notice_enabled: expiryNoticeEnabled,
        stop_request_notice_enabled: stopRequestNoticeEnabled,
        cancel_complete_notice_enabled: cancelCompleteNoticeEnabled,
        pop3_tls: pop3Tls,
        pop3_keep_copy: pop3KeepCopy,
        imap_tls: imapTls,
        smtp_tls: smtpTls,
        poll_sources: pollSourcesRef.current,
        require_serial_format: requireSerial,
        renewal_product_keywords: productKeywords,
        renewal_action_keywords: actionKeywords,
        renewal_exclude_keywords: excludeKeywords,
        missing_info_auto_reply_enabled: missingInfoAutoReply,
        expiry_notice_rules: cleanedExpiryRules,
        expiry_notice_days: cleanedExpiryRules.map(rule => rule.days_before),
        expiry_notice_renewal_template: cleanedExpiryRules[0]?.renewal_template || 'renewal_reminder',
      };
      // Clean up temp keys
      delete finalSettings.renewal_keywords_raw;
      delete finalSettings.renewal_product_keywords_raw;
      delete finalSettings.renewal_action_keywords_raw;
      delete finalSettings.renewal_exclude_keywords_raw;
      await api.saveSettings(finalSettings);
      if (appLanguage) setLang(appLanguage);
      alert(t(lang, 'settings_saved'));
    } catch (err: any) {
      alert(`${t(lang, 'settings_save_fail')}${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const updateExpiryRule = (id: string, patch: Partial<ExpiryNoticeRule>) => {
    setExpiryNoticeRules(current => current.map(rule => rule.id === id ? { ...rule, ...patch } : rule));
  };

  const addExpiryRule = () => {
    setExpiryNoticeRules(current => [
      ...current,
      { id: genId(), days_before: 30, renewal_template: current[0]?.renewal_template || 'renewal_reminder' },
    ]);
  };

  const removeExpiryRule = (id: string) => {
    setExpiryNoticeRules(current => current.filter(rule => rule.id !== id));
  };

  const runExpiryDryRun = async (rule: ExpiryNoticeRule) => {
    const testEmail = (expiryDryRunEmails[rule.id] || '').trim();
    setExpiryDryRunning(current => ({ ...current, [rule.id]: true }));
    setExpiryDryRunResults(current => ({ ...current, [rule.id]: '' }));
    try {
      const result = await api.runExpiryNoticeDryRun({
        days_before: rule.days_before,
        template_code: rule.renewal_template,
        test_email: testEmail,
      }) as any;
      setExpiryDryRunResults(current => ({
        ...current,
        [rule.id]: `${result.success ? 'OK' : 'FAIL'} - ${result.message}${result.sample_serial ? ` (${result.sample_serial})` : ''}`,
      }));
    } catch (err: any) {
      setExpiryDryRunResults(current => ({ ...current, [rule.id]: `FAIL - ${err.message}` }));
    } finally {
      setExpiryDryRunning(current => ({ ...current, [rule.id]: false }));
    }
  };

  const runStopTemplateDryRun = async () => {
    setStopDryRunning(true);
    setStopDryRunResult(null);
    try {
      const result = await api.runExpiryNoticeDryRun({
        days_before: stopDryRunDays,
        template_code: formVals.current.expiry_notice_stop_template || 'stop_expiry_reminder',
        test_email: stopDryRunEmail,
        use_stop_template: true,
      }) as any;
      setStopDryRunResult(`${result.success ? 'OK' : 'FAIL'} - ${result.message}${result.sample_serial ? ` (${result.sample_serial})` : ''}`);
    } catch (err: any) {
      setStopDryRunResult(`FAIL - ${err.message}`);
    } finally {
      setStopDryRunning(false);
    }
  };

  const runLifecycleDryRun = async (
    key: 'stop_request' | 'cancel_complete',
    templateCode: string,
  ) => {
    const testEmail = (lifecycleDryRunEmails[key] || '').trim();
    setLifecycleDryRunning(current => ({ ...current, [key]: true }));
    setLifecycleDryRunResults(current => ({ ...current, [key]: '' }));
    try {
      const result = await api.runStopLifecycleNoticeDryRun({
        kind: key,
        template_code: templateCode,
        test_email: testEmail,
      }) as any;
      setLifecycleDryRunResults(current => ({
        ...current,
        [key]: `${result.success ? 'OK' : 'FAIL'} - ${result.message}${result.sample_serial ? ` (${result.sample_serial})` : ''}`,
      }));
    } catch (err: any) {
      setLifecycleDryRunResults(current => ({ ...current, [key]: `FAIL - ${err.message}` }));
    } finally {
      setLifecycleDryRunning(current => ({ ...current, [key]: false }));
    }
  };

  if (loading) return <div>{t(lang, 'loading')}</div>;

  const KeywordCardEditor = ({
    inputKey,
    label,
    hint,
    placeholder,
    values,
    onChange,
    danger = false,
  }: {
    inputKey: string;
    label: string;
    hint: string;
    placeholder: string;
    values: string[];
    onChange: React.Dispatch<React.SetStateAction<string[]>>;
    danger?: boolean;
  }) => (
    <div className="form-group" style={{ marginBottom: 16 }}>
      <label style={{ fontWeight: 600, color: danger ? 'var(--red)' : undefined }}>{label}</label>
      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        <input
          value={keywordInputs[inputKey] || ''}
          onChange={e => setKeywordInput(inputKey, e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addKeyword(inputKey, values, onChange);
            }
          }}
          placeholder={placeholder}
        />
        <button
          type="button"
          onClick={() => addKeyword(inputKey, values, onChange)}
          className="btn btn-secondary"
          style={{ whiteSpace: 'nowrap', padding: '7px 14px' }}
        >
          {t(lang, 'add')}
        </button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
        {values.length === 0 ? (
          <span style={{ color: 'var(--text3)', fontSize: 12 }}>—</span>
        ) : values.map(value => (
          <span
            key={value}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 9px',
              borderRadius: 6,
              border: `1px solid ${danger ? 'rgba(239,68,68,0.35)' : 'var(--border2)'}`,
              background: danger ? 'var(--red-dim)' : 'var(--bg3)',
              color: danger ? 'var(--red)' : 'var(--text)',
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            {value}
            <button
              type="button"
              onClick={() => removeKeyword(value, onChange)}
              title={t(lang, 'delete')}
              style={{ border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <small style={{ color: danger ? 'var(--red)' : 'var(--text)', fontSize: 12, display: 'block', marginTop: 6 }}>{hint}</small>
    </div>
  );

  // ── 매뉴얼 내용 정의 ────────────────────────────────────────────────────────
  const manuals: Record<string, { title: string; content: React.ReactNode }> = {
    language: {
      title: t(lang, 'section_language'),
      content: (
        <>
          <p>{t(lang, 'settings_manual_language')}</p>
          <ul style={{ paddingLeft: 18, margin: '8px 0' }}>
            <li><strong>{t(lang, 'settings_manual_language_ko')}</strong></li>
            <li><strong>{t(lang, 'settings_manual_language_en')}</strong></li>
            <li><strong>{t(lang, 'settings_manual_language_ja')}</strong></li>
          </ul>
          <p>{t(lang, 'settings_manual_language_apply')}</p>
        </>
      ),
    },
    autoCancel: {
      title: t(lang, 'section_auto_cancel'),
      content: (
        <>
          <p>{t(lang, 'settings_manual_autocancel_1')}</p>
          <p><strong>{t(lang, 'settings_manual_behavior')}</strong></p>
          <ul style={{ paddingLeft: 18, margin: '8px 0' }}>
            <li>{t(lang, 'settings_manual_autocancel_li1')}</li>
            <li>{t(lang, 'settings_manual_autocancel_li2')}</li>
            <li>{t(lang, 'settings_manual_autocancel_li3')}</li>
            <li>{t(lang, 'settings_manual_autocancel_li4')}</li>
          </ul>
          <p style={{ color: 'var(--red)', fontWeight: 600 }}>{t(lang, 'settings_manual_exocad_required')}</p>
        </>
      ),
    },
    mailRecv: {
      title: t(lang, 'section_mail_recv'),
      content: (
        <>
          <p>{t(lang, 'settings_manual_mailrecv_1')}</p>
          <p><strong>{t(lang, 'settings_manual_pop3_imap')}</strong></p>
          <ul style={{ paddingLeft: 18, margin: '8px 0' }}>
            <li>{t(lang, 'settings_manual_pop3')}</li>
            <li>{t(lang, 'settings_manual_imap')}</li>
          </ul>
          <p><strong>{t(lang, 'settings_manual_gmail_imap')}</strong></p>
          <p><strong>{t(lang, 'settings_manual_ports')}</strong></p>
          <hr style={{ margin: '12px 0', borderColor: 'var(--border)' }} />
          <p><strong>{t(lang, 'settings_manual_dedicated_title')}</strong></p>
          <p>{t(lang, 'settings_manual_dedicated_1')}</p>
          <ul style={{ paddingLeft: 18, margin: '8px 0' }}>
            <li>{t(lang, 'settings_manual_dedicated_li1')}</li>
            <li>{t(lang, 'settings_manual_dedicated_li2')}</li>
            <li>{t(lang, 'settings_manual_dedicated_li3')}</li>
          </ul>
          <p style={{ color: 'var(--text)' }}>{t(lang, 'settings_manual_dedicated_note')}</p>
          <p><strong>{t(lang, 'settings_manual_headers')}</strong> <code>Delivered-To, X-Forwarded-To, X-Original-To, To, Cc, Resent-To</code></p>
        </>
      ),
    },
    smtp: {
      title: t(lang, 'section_smtp'),
      content: (
        <>
          <p>{t(lang, 'settings_manual_smtp_1')}</p>
          <ul style={{ paddingLeft: 18, margin: '8px 0' }}>
            <li>{t(lang, 'settings_manual_smtp_host')}</li>
            <li>{t(lang, 'settings_manual_smtp_port')}</li>
            <li>{t(lang, 'settings_manual_smtp_report')}</li>
          </ul>
          <p><strong>{t(lang, 'settings_manual_smtp_gmail')}</strong></p>
        </>
      ),
    },
    slack: {
      title: t(lang, 'section_slack'),
      content: (
        <>
          <p>{t(lang, 'settings_manual_slack_1')}</p>
          <p><strong>{t(lang, 'settings_manual_webhook_how')}</strong></p>
          <ol style={{ paddingLeft: 18, margin: '8px 0' }}>
            <li>{t(lang, 'settings_manual_slack_li1')}</li>
            <li>{t(lang, 'settings_manual_slack_li2')}</li>
            <li>{t(lang, 'settings_manual_slack_li3')}</li>
            <li>{t(lang, 'settings_manual_slack_li4')}</li>
          </ol>
        </>
      ),
    },
    exocad: {
      title: t(lang, 'section_exocad'),
      content: (
        <>
          <p>{t(lang, 'settings_manual_exocad_1')}</p>
          <p><strong>{t(lang, 'settings_manual_required_items')}</strong></p>
          <ul style={{ paddingLeft: 18, margin: '8px 0' }}>
            <li>{t(lang, 'settings_manual_exocad_li1')}</li>
            <li>{t(lang, 'settings_manual_exocad_li2')}</li>
            <li>{t(lang, 'settings_manual_exocad_li3')}</li>
            <li>{t(lang, 'settings_manual_exocad_li4')}</li>
            <li>{t(lang, 'settings_manual_exocad_li5')}</li>
          </ul>
          <p style={{ color: 'var(--yellow)' }}>{t(lang, 'settings_manual_exocad_note')}</p>
        </>
      ),
    },
    polling: {
      title: t(lang, 'section_polling'),
      content: (
        <>
          <p>{t(lang, 'settings_manual_polling_1')}</p>
          <p><strong>{t(lang, 'settings_manual_how')}</strong></p>
          <ol style={{ paddingLeft: 18, margin: '8px 0' }}>
            <li>{t(lang, 'settings_manual_polling_li1')}</li>
            <li>{t(lang, 'settings_manual_polling_li2')}</li>
            <li>{t(lang, 'settings_manual_polling_li3')}</li>
            <li>{t(lang, 'settings_manual_polling_li4')}</li>
          </ol>
          <p>{t(lang, 'settings_manual_field_mapping')}</p>
          <p>{t(lang, 'settings_manual_polling_result')}</p>
        </>
      ),
    },
    other: {
      title: t(lang, 'section_other'),
      content: (
        <>
          <p><strong>{t(lang, 'settings_manual_keywords')}</strong></p>
          <ul style={{ paddingLeft: 18, margin: '8px 0' }}>
            <li>{t(lang, 'settings_manual_keywords_default')}</li>
            <li>{t(lang, 'settings_manual_keywords_comma')}</li>
          </ul>
          <p><strong>{t(lang, 'settings_manual_mail_interval')}</strong></p>
        </>
      ),
    },
  };

  return (
    <div className="page-wrapper">
      {/* 매뉴얼 팝업 */}
      {manualOpen && manuals[manualOpen] && (
        <ManualPopup
          title={manuals[manualOpen].title}
          content={manuals[manualOpen].content}
          onClose={() => setManualOpen(null)}
        />
      )}

      <div className="page-header">
        <div>
          <div className="page-title">{t(lang, 'page_title_settings')}</div>
          <div className="page-subtitle">{t(lang, 'page_subtitle_settings')}</div>
        </div>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? t(lang, 'saving') : t(lang, 'btn_save_settings')}
        </button>
      </div>

      {/* ─── 언어 설정 ──────────────────────────────────────────────────────── */}
      <div className="settings-section">
        <SectionHeader title={t(lang, 'section_language')} onManual={() => setManualOpen('language')} />
        <div className="form-group">
          <label>{t(lang, 'label_language')}</label>
          <div style={{ display: 'flex', gap: 12, marginTop: 6 }}>
            {([
              { value: 'ko', label: '🇰🇷 한국어' },
              { value: 'en', label: '🇺🇸 English' },
              { value: 'ja', label: '🇯🇵 日本語' },
            ] as { value: Language; label: string }[]).map(opt => (
              <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', padding: '6px 14px', borderRadius: 8, border: `2px solid ${appLanguage === opt.value ? 'var(--accent)' : 'var(--border2)'}`, background: appLanguage === opt.value ? 'var(--accent-dim2)' : 'var(--bg3)', fontWeight: appLanguage === opt.value ? 700 : 400, color: appLanguage === opt.value ? 'var(--accent)' : 'var(--text2)', fontSize: 13 }}>
                <input
                  type="radio"
                  name="app_language"
                  value={opt.value}
                  checked={appLanguage === opt.value}
                  onChange={() => setAppLanguage(opt.value)}
                  style={{ display: 'none' }}
                />
                {opt.label}
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* ─── 자동 Cancel 설정 ──────────────────────────────────────────────── */}
      <div className="settings-section">
        <SectionHeader title={t(lang, 'section_auto_cancel')} onManual={() => setManualOpen('autoCancel')} />
        <div className="form-group" style={{ marginBottom: 12 }}>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={autoCancelEnabled}
              onChange={e => setAutoCancelEnabled(e.target.checked)}
            />
            {t(lang, 'label_auto_cancel_enabled')}
          </label>
        </div>
        {autoCancelEnabled && (
          <>
            <div className="form-row">
              <div className="form-group">
                <label>{t(lang, 'label_auto_cancel_days')}</label>
                <input
                  key={`acd-${loadKey}`}
                  type="number"
                  defaultValue={formVals.current.auto_cancel_days_before ?? 1}
                  onChange={e => setVal('auto_cancel_days_before', Number(e.target.value))}
                  min={1}
                  max={30}
                  style={{ width: 100 }}
                />
              </div>
              <div className="form-group">
                <label>{t(lang, 'label_auto_cancel_time')}</label>
                <input
                  type="time"
                  value={autoCancelTime}
                  onChange={e => setAutoCancelTime(e.target.value)}
                  style={{ width: 130 }}
                />
                <small style={{ color: 'var(--text3)', fontSize: 12, display: 'block', marginTop: 2 }}>
                  {t(lang, 'auto_cancel_time_note')}
                </small>
              </div>
            </div>
            <small style={{ color: 'var(--text3)', fontSize: 12, display: 'block', marginBottom: 12 }}>
              {t(lang, 'auto_cancel_note')}
            </small>

            {/* Dry-Run Check Button */}
            <div style={{ marginTop: 8 }}>
              <button
                className="btn btn-secondary"
                style={{ background: 'var(--bg3)', color: 'var(--accent)', border: '1px solid #c4b5fd' }}
                onClick={async () => {
                  setCancelDryRunning(true);
                  setCancelDryResults(null);
                  try {
                    const results = await api.cancelDryRun() as any[];
                    setCancelDryResults(results);
                  } catch (e: any) {
                    setCancelDryResults([{ error: e.message }]);
                  } finally {
                    setCancelDryRunning(false);
                  }
                }}
                disabled={cancelDryRunning}
              >
                {cancelDryRunning ? t(lang, 'cancel_dryrun_running') : t(lang, 'btn_cancel_dryrun')}
              </button>
            </div>

            {/* Dry-Run Results Panel */}
            {cancelDryResults !== null && (
              <div style={{ marginTop: 14, border: '1px solid #c4b5fd', borderRadius: 8, overflow: 'hidden' }}>
                <div style={{ padding: '8px 14px', background: 'var(--bg3)', fontWeight: 700, fontSize: 13, color: 'var(--accent)' }}>
                  🔍 {t(lang, 'cancel_dryrun_result_count').replace('{n}', String(cancelDryResults.length))}
                </div>
                {cancelDryResults.length === 0 ? (
                  <div style={{ padding: '16px 14px', color: 'var(--text)', fontSize: 13 }}>
                    {t(lang, 'cancel_dryrun_no_targets')}
                  </div>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr style={{ background: 'var(--bg3)', borderBottom: '1px solid #e5e7eb' }}>
                          <th style={thStyle}>{t(lang, 'cancel_dryrun_col_serial')}</th>
                          <th style={thStyle}>{t(lang, 'cancel_dryrun_col_customer')}</th>
                          <th style={thStyle}>{t(lang, 'cancel_dryrun_col_expiry')}</th>
                          <th style={thStyle}>{t(lang, 'cancel_dryrun_col_skip')}</th>
                          <th style={thStyle}>{t(lang, 'cancel_dryrun_col_login')}</th>
                          <th style={thStyle}>{t(lang, 'cancel_dryrun_col_found')}</th>
                          <th style={thStyle}>Product</th>
                          <th style={thStyle}>{t(lang, 'cancel_dryrun_col_option')}</th>
                          <th style={thStyle}>Button</th>
                          <th style={thStyle}>{t(lang, 'cancel_dryrun_col_cancel_item')}</th>
                          <th style={thStyle}>Clicked</th>
                          <th style={thStyle}>{t(lang, 'cancel_dryrun_col_error')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cancelDryResults.map((r: any, i: number) => {
                          const isSkipped = r.has_renewal;
                          const allOk = !isSkipped && r.login_ok && r.serial_found && r.option_btn_found && r.cancel_item_found && r.cancel_item_clicked;
                          const hasError = r.error && !isSkipped;
                          const rowBg = isSkipped ? '#fefce8' : allOk ? '#f0fdf4' : '#fef2f2';
                          return (
                            <tr key={i} style={{ background: rowBg, borderBottom: '1px solid #f3f4f6' }}>
                              <td style={tdStyle}>
                                <code style={{ fontSize: 11 }}>{r.serial_number}</code>
                                {r.is_test_serial && (
                                  <span style={{ marginLeft: 4, fontSize: 10, background: 'var(--yellow-dim)', color: 'var(--yellow)', border: '1px solid #fde68a', borderRadius: 3, padding: '1px 4px', fontWeight: 600 }}>TEST</span>
                                )}
                              </td>
                              <td style={tdStyle}>{r.customer_name}</td>
                              <td style={tdStyle}>{r.expiry_date}</td>
                              <td style={{ ...tdStyle, textAlign: 'center' }}>
                                {isSkipped ? <span style={{ color: 'var(--yellow)', fontWeight: 600 }}>⚠ {t(lang, 'cancel_dryrun_skipped')}</span> : <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{t(lang, 'cancel_dryrun_would_cancel')}</span>}
                              </td>
                              <td style={{ ...tdStyle, textAlign: 'center' }}>{isSkipped ? '—' : checkIcon(r.login_ok)}</td>
                              <td style={{ ...tdStyle, textAlign: 'center' }}>{isSkipped ? '—' : checkIcon(r.serial_found)}</td>
                              <td style={{ ...tdStyle, fontSize: 11, color: 'var(--text)' }}>{r.product_name || '—'}</td>
                              <td style={{ ...tdStyle, textAlign: 'center' }}>{isSkipped ? '—' : checkIcon(r.option_btn_found)}</td>
                              <td style={{ ...tdStyle, fontSize: 11, color: 'var(--accent)', whiteSpace: 'nowrap' }}>{r.cancel_btn_label || '—'}</td>
                              <td style={{ ...tdStyle, textAlign: 'center' }}>{isSkipped ? '—' : checkIcon(r.cancel_item_found)}</td>
                              <td style={{ ...tdStyle, textAlign: 'center' }}>{isSkipped ? '—' : checkIcon(r.cancel_item_clicked)}</td>
                              <td style={{ ...tdStyle, color: 'var(--red)', fontSize: 11 }}>{hasError ? r.error : ''}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* ─── 메일 수신 설정 ─────────────────────────────────────────────────── */}
      <div className="settings-section">
        <SectionHeader title={t(lang, 'section_mail_recv')} onManual={() => setManualOpen('mailRecv')} />

        <div className="form-group">
          <label>{t(lang, 'label_mail_protocol')}</label>
          <div style={{ display: 'flex', gap: 24, marginTop: 6 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input type="radio" name="mail_protocol" value="pop3" checked={protocol === 'pop3'} onChange={() => setProtocol('pop3')} />
              POP3
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input type="radio" name="mail_protocol" value="imap" checked={protocol === 'imap'} onChange={() => setProtocol('imap')} />
              IMAP
            </label>
          </div>
        </div>

        {protocol === 'pop3' && (
          <>
            <div className="form-row">
              <div className="form-group">
                <label>{t(lang, 'label_host')} (POP3)</label>
                <input key={`pop3h-${loadKey}`} defaultValue={formVals.current.pop3_host || ''} onChange={e => setVal('pop3_host', e.target.value)} placeholder="mail.example.com" />
              </div>
              <div className="form-group">
                <label>{t(lang, 'label_port')}</label>
                <input key={`pop3p-${loadKey}`} type="number" defaultValue={formVals.current.pop3_port || 995} onChange={e => setVal('pop3_port', Number(e.target.value))} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>{t(lang, 'label_username')}</label>
                <input key={`pop3u-${loadKey}`} defaultValue={formVals.current.pop3_user || ''} onChange={e => setVal('pop3_user', e.target.value)} placeholder="user@example.com" />
              </div>
              <div className="form-group">
                <label>{t(lang, 'label_password')}</label>
                <input key={`pop3pw-${loadKey}`} type="password" defaultValue={formVals.current.pop3_password || ''} onChange={e => setVal('pop3_password', e.target.value)} />
              </div>
            </div>
            <div className="form-group" style={{ display: 'flex', gap: 24, marginBottom: 8 }}>
              <label className="checkbox-row">
                <input type="checkbox" checked={pop3Tls} onChange={e => setPop3Tls(e.target.checked)} />
                {t(lang, 'label_tls')}
              </label>
              <label className="checkbox-row">
                <input type="checkbox" checked={pop3KeepCopy} onChange={e => setPop3KeepCopy(e.target.checked)} />
                {t(lang, 'label_pop3_keep_copy')}
              </label>
            </div>
          </>
        )}

        {protocol === 'imap' && (
          <>
            <div className="form-row">
              <div className="form-group">
                <label>{t(lang, 'label_host')} (IMAP)</label>
                <input key={`imaph-${loadKey}`} defaultValue={formVals.current.imap_host || ''} onChange={e => setVal('imap_host', e.target.value)} placeholder="imap.example.com" />
              </div>
              <div className="form-group">
                <label>{t(lang, 'label_port')}</label>
                <input key={`imapp-${loadKey}`} type="number" defaultValue={formVals.current.imap_port || 993} onChange={e => setVal('imap_port', Number(e.target.value))} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>{t(lang, 'label_username')}</label>
                <input key={`imapu-${loadKey}`} defaultValue={formVals.current.imap_user || ''} onChange={e => setVal('imap_user', e.target.value)} placeholder="user@example.com" />
              </div>
              <div className="form-group">
                <label>{t(lang, 'label_password')}</label>
                <input key={`imappw-${loadKey}`} type="password" defaultValue={formVals.current.imap_password || ''} onChange={e => setVal('imap_password', e.target.value)} />
              </div>
            </div>
            <div className="form-group" style={{ marginBottom: 8 }}>
              <label className="checkbox-row">
                <input type="checkbox" checked={imapTls} onChange={e => setImapTls(e.target.checked)} />
                {t(lang, 'label_tls')}
              </label>
            </div>
            <small style={{ color: 'var(--text3)', fontSize: 12 }}>{t(lang, 'imap_note')}</small>
          </>
        )}

        {/* ── 앱 전용 이메일 주소 (Forward 감지) ── */}
        <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px dashed #e5e7eb' }}>
          <div className="form-group">
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              📮 {t(lang, 'label_dedicated_email')}
            </label>
            <input
              key={`dmail-${loadKey}`}
              type="email"
              defaultValue={formVals.current.dedicated_email || ''}
              onChange={e => setVal('dedicated_email', e.target.value)}
              placeholder="renewal@yourcompany.com"
              style={{ fontFamily: 'monospace' }}
            />
            <div style={{ marginTop: 6, padding: '10px 12px', background: 'var(--bg3)', borderRadius: 8, border: '1px solid #bae6fd' }}>
              <small style={{ color: 'var(--text)', fontSize: 12, lineHeight: 1.6, display: 'block' }}>
                💡 {t(lang, 'dedicated_email_note')}
              </small>
              <small style={{ color: 'var(--text)', fontSize: 11.5, lineHeight: 1.6, display: 'block', marginTop: 4 }}>
                {t(lang, 'dedicated_email_how')}
              </small>
              <small style={{ color: 'var(--text)', fontSize: 11, display: 'block', marginTop: 6 }}>
                {t(lang, 'detect_headers')}{' '}
                <code style={{ background: 'var(--bg4)', padding: '1px 4px', borderRadius: 3 }}>Delivered-To</code>{' '}
                <code style={{ background: 'var(--bg4)', padding: '1px 4px', borderRadius: 3 }}>X-Forwarded-To</code>{' '}
                <code style={{ background: 'var(--bg4)', padding: '1px 4px', borderRadius: 3 }}>X-Original-To</code>{' '}
                <code style={{ background: 'var(--bg4)', padding: '1px 4px', borderRadius: 3 }}>To</code>{' '}
                <code style={{ background: 'var(--bg4)', padding: '1px 4px', borderRadius: 3 }}>Cc</code>{' '}
                <code style={{ background: 'var(--bg4)', padding: '1px 4px', borderRadius: 3 }}>Resent-To</code>
              </small>
            </div>
          </div>
        </div>

        {/* ── 갱신 & 제품 조건 설정 (다중 조건) ── */}
        <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px dashed #e5e7eb' }}>
          <KeywordCardEditor
            inputKey="product"
            label={t(lang, 'renewal_product_keywords_label')}
            hint={t(lang, 'renewal_product_keywords_hint')}
            placeholder="exocad"
            values={productKeywords}
            onChange={setProductKeywords}
          />
          <KeywordCardEditor
            inputKey="action"
            label={t(lang, 'renewal_action_keywords_label')}
            hint={t(lang, 'renewal_action_keywords_hint')}
            placeholder={t(lang, 'renewal_action_keywords_placeholder')}
            values={actionKeywords}
            onChange={setActionKeywords}
          />
          <div style={{ borderLeft: '3px solid #fca5a5', background: 'var(--red-dim)', borderRadius: 4, padding: '10px 12px', marginBottom: 16 }}>
            <KeywordCardEditor
              inputKey="exclude"
              label={t(lang, 'renewal_exclude_keywords_label')}
              hint={t(lang, 'renewal_exclude_keywords_hint')}
              placeholder={t(lang, 'renewal_exclude_keywords_placeholder')}
              values={excludeKeywords}
              onChange={setExcludeKeywords}
              danger
            />
          </div>
          <div className="form-row" style={{ alignItems: 'flex-start', marginBottom: 16 }}>
            <div className="form-group" style={{ flex: 1 }}>
              <label style={{ fontWeight: 600 }}>{t(lang, 'mail_serial_pattern_label' as any)}</label>
              <input
                key={`serial-pattern-${loadKey}`}
                defaultValue={formVals.current.mail_serial_pattern || 'XXXXXXXX-XXXX-XXXXXXXX'}
                onChange={e => setVal('mail_serial_pattern', e.target.value)}
                placeholder="XXXXXXXX-XXXX-XXXXXXXX"
                style={{ fontFamily: 'monospace' }}
              />
              <small style={{ color: 'var(--text)', fontSize: 12 }}>{t(lang, 'mail_serial_pattern_hint' as any)}</small>
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label style={{ fontWeight: 600 }}>{t(lang, 'missing_info_template_label' as any)}</label>
              <select
                key={`missing-template-${loadKey}`}
                defaultValue={formVals.current.missing_info_template || 'missing_info_request'}
                onChange={e => setVal('missing_info_template', e.target.value)}
              >
                {mailTemplates.map(template => (
                  <option key={template.code} value={template.code}>{template.name} ({template.code})</option>
                ))}
              </select>
              <label className="checkbox-row" style={{ marginTop: 8 }}>
                <input
                  type="checkbox"
                  checked={missingInfoAutoReply}
                  onChange={e => setMissingInfoAutoReply(e.target.checked)}
                />
                {t(lang, 'missing_info_auto_reply_label' as any)}
              </label>
              <small style={{ color: 'var(--text)', fontSize: 12 }}>{t(lang, 'missing_info_auto_reply_hint' as any)}</small>
            </div>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="checkbox-row" style={{ fontWeight: 600 }}>
              <input
                type="checkbox"
                checked={requireSerial}
                onChange={e => setRequireSerial(e.target.checked)}
              />
              {t(lang, 'require_serial_label')}
            </label>
            <small style={{ color: 'var(--text)', fontSize: 12, marginLeft: 22, display: 'block', marginTop: 4 }}>{t(lang, 'require_serial_hint')}</small>
          </div>
        </div>

        {/* ── 연결 테스트 + Renewal Dry-Run ── */}
        <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px dashed #e5e7eb', display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {/* Connection Test */}
          <div>
            <button
              className="btn btn-secondary"
              style={{ background: 'var(--bg3)', color: 'var(--text)', border: '1px solid #bae6fd' }}
              disabled={connTesting}
              onClick={async () => {
                setConnTesting(true);
                setConnTestResult(null);
                try {
                  // 저장 전 form 값을 직접 전달 — formVals.current에서 현재 입력값 추출
                  const f = formVals.current;
                  const settingsOverride = {
                    mail_protocol: protocol,  // radio state
                    pop3_host: f.pop3_host, pop3_port: f.pop3_port,
                    pop3_user: f.pop3_user, pop3_password: f.pop3_password,
                    pop3_tls: pop3Tls,
                    pop3_keep_copy: pop3KeepCopy,
                    imap_host: f.imap_host, imap_port: f.imap_port,
                    imap_user: f.imap_user, imap_password: f.imap_password,
                    imap_tls: imapTls,
                  };
                  const res = await api.testMailConnection(settingsOverride);
                  setConnTestResult(res);
                } catch (e: any) {
                  setConnTestResult({ success: false, message: e.message });
                } finally {
                  setConnTesting(false);
                }
              }}
            >
              {connTesting ? t(lang, 'conn_testing') : t(lang, 'conn_test_btn')}
            </button>
            {connTestResult && (
              <div style={{
                marginTop: 8, padding: '8px 12px', borderRadius: 8, fontSize: 13,
                background: connTestResult.success ? '#f0fdf4' : '#fef2f2',
                border: `1px solid ${connTestResult.success ? '#86efac' : '#fca5a5'}`,
                color: connTestResult.success ? '#166534' : '#dc2626',
              }}>
                {connTestResult.success ? '✅' : '❌'} {connTestResult.message}
                {connTestResult.mail_count !== undefined && (
                  <span style={{ marginLeft: 8, color: 'var(--text)', fontSize: 12 }}>{t(lang, 'conn_mail_count').replace('{n}', String(connTestResult.mail_count))}</span>
                )}
              </div>
            )}
          </div>

          {/* Renewal Dry-Run */}
          <div style={{ flex: 1, minWidth: 200 }}>
            <button
              className="btn btn-secondary"
              style={{ background: 'var(--bg3)', color: 'var(--accent)', border: '1px solid #d8b4fe' }}
              disabled={renewalDryRunning}
              onClick={async () => {
                setRenewalDryRunning(true);
                setRenewalDryRunResult(null);
                try {
                  const res = await api.renewalDryRun();
                  setRenewalDryRunResult(res);
                } catch (e: any) {
                  setRenewalDryRunResult({ total_checked: 0, matched: 0, emails: [], error: e.message });
                } finally {
                  setRenewalDryRunning(false);
                }
              }}
            >
              {renewalDryRunning ? t(lang, 'renewal_dryrun_running') : t(lang, 'renewal_dryrun_label')}
            </button>
            <small style={{ display: 'block', marginTop: 4, color: 'var(--text)', fontSize: 11.5 }}>
              {t(lang, 'renewal_dryrun_note')}
            </small>
          </div>
        </div>

        {/* Renewal Dry-Run 결과 */}
        {renewalDryRunResult !== null && (
          <div style={{ marginTop: 14, border: '1px solid #d8b4fe', borderRadius: 8, overflow: 'hidden' }}>
            {(() => {
              const dryEntries = renewalDryRunResult.emails || renewalDryRunResult.entries || [];
              const detected = renewalDryRunResult.matched ?? dryEntries.length;
              return (
                <>
            <div style={{ padding: '8px 14px', background: 'var(--bg3)', fontWeight: 700, fontSize: 13, color: 'var(--accent)', display: 'flex', gap: 12, alignItems: 'center' }}>
              <span>{t(lang, 'renewal_dryrun_result_title')}</span>
              <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--text)' }}>({t(lang, 'renewal_dryrun_checked').replace('{n}', String(renewalDryRunResult.total_checked))} / {t(lang, 'renewal_dryrun_detected').replace('{n}', String(detected))})</span>
              {renewalDryRunResult.error && <span style={{ color: 'var(--red)', fontSize: 12 }}>❌ {renewalDryRunResult.error}</span>}
            </div>
            {dryEntries.length === 0 ? (
              <div style={{ padding: '14px', color: 'var(--text)', fontSize: 13 }}>{t(lang, 'renewal_dryrun_empty')}</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: 'var(--bg3)', borderBottom: '1px solid #e5e7eb' }}>
                      <th style={thStyle}>From</th>
                      <th style={thStyle}>Subject</th>
                      <th style={thStyle}>Date</th>
                      <th style={thStyle}>{t(lang, 'renewal_dryrun_col_type')}</th>
                      <th style={thStyle}>{t(lang, 'renewal_dryrun_col_keyword')}</th>
                      <th style={thStyle}>Dedicated</th>
                      <th style={thStyle}>{t(lang, 'renewal_dryrun_col_serial')}</th>
                      <th style={thStyle}>{t(lang, 'renewal_dryrun_col_db')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dryEntries.map((em: any, i: number) => (
                      <tr key={i} style={{ borderBottom: '1px solid #f3f4f6', background: em.serial_exists ? 'var(--green-dim)' : 'var(--yellow-dim)' }}>
                        <td style={{ ...tdStyle, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{em.from}</td>
                        <td style={{ ...tdStyle, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{em.subject}</td>
                        <td style={{ ...tdStyle, whiteSpace: 'nowrap', fontSize: 11 }}>{em.date ? new Date(em.date).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'}</td>
                        <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 600, fontSize: 11 }}>
                          {em.classification === 'stop_request_candidate' ? <span style={{ color: 'var(--red)' }}>{t(lang, 'mail_classif_stop_candidate' as any)}</span> :
                            em.is_renewal || em.classification === 'renewal_request' ? <span style={{ color: 'var(--green)' }}>{t(lang, 'renewal_type_request')}</span> :
                            em.is_related ? <span style={{ color: 'var(--yellow)' }}>{t(lang, 'renewal_type_related')}</span> : '—'}
                        </td>
                        <td style={tdStyle}>
                          {(em.matched_keywords || []).map((kw: string, ki: number) => (
                            <span key={ki} style={{ display: 'inline-block', background: 'var(--bg3)', color: 'var(--accent)', borderRadius: 4, padding: '1px 6px', fontSize: 11, marginRight: 3 }}>{kw}</span>
                          ))}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'center' }}>{em.is_dedicated ? '✅' : '—'}</td>
                        <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 11 }}>{em.serial_number || em.extracted_serial || '—'}</td>
                        <td style={{ ...tdStyle, textAlign: 'center' }}>{(em.serial_number || em.extracted_serial) ? (em.serial_exists ? '✅' : <span style={{ color: 'var(--yellow)' }}>?</span>) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
                </>
              );
            })()}
          </div>
        )}
      </div>

      {/* ─── SMTP 리포트 발신 ─────────────────────────────────────────────────── */}
      <div className="settings-section">
        <SectionHeader title={t(lang, 'section_smtp')} onManual={() => setManualOpen('smtp')} />
        <div className="form-row">
          <div className="form-group">
            <label>{t(lang, 'label_host')} (SMTP)</label>
            <input key={`smtph-${loadKey}`} defaultValue={formVals.current.smtp_host || ''} onChange={e => setVal('smtp_host', e.target.value)} placeholder="smtp.example.com" />
          </div>
          <div className="form-group">
            <label>{t(lang, 'label_port')}</label>
            <input key={`smtpp-${loadKey}`} type="number" defaultValue={formVals.current.smtp_port || 587} onChange={e => setVal('smtp_port', Number(e.target.value))} />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>{t(lang, 'label_username')}</label>
            <input key={`smtpu-${loadKey}`} defaultValue={formVals.current.smtp_user || ''} onChange={e => setVal('smtp_user', e.target.value)} />
          </div>
          <div className="form-group">
            <label>{t(lang, 'label_password')}</label>
            <input key={`smtppw-${loadKey}`} type="password" defaultValue={formVals.current.smtp_password || ''} onChange={e => setVal('smtp_password', e.target.value)} />
          </div>
        </div>

        {/* Gmail App Password 안내 */}
        <div style={{
          marginTop: 4, marginBottom: 8, padding: '10px 14px',
          background: 'var(--yellow-dim)', border: '1px solid #fed7aa', borderRadius: 8, fontSize: 12,
        }}>
          {t(lang, 'gmail_app_password_notice')}{' '}
          <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer"
            style={{ color: 'var(--yellow)', fontWeight: 700 }}>
            {t(lang, 'gmail_app_password_link')}
          </a>
          {' '}{t(lang, 'gmail_app_password_2fa')}
        </div>
        <div className="form-group">
          <label>{t(lang, 'label_report_email')}</label>
          <input key={`rmail-${loadKey}`} defaultValue={formVals.current.report_email_to || ''} onChange={e => setVal('report_email_to', e.target.value)} placeholder="admin@example.com" />
        </div>
        <div className="form-group" style={{ marginBottom: 8 }}>
          <label className="checkbox-row">
            <input type="checkbox" checked={smtpTls} onChange={e => setSmtpTls(e.target.checked)} />
            {t(lang, 'label_tls')}
          </label>
        </div>

        {/* ── SMTP Test Email Button ── */}
        <div style={{ marginTop: 12 }}>
          <button
            className="btn btn-secondary"
            style={{ background: 'var(--green-dim)', color: 'var(--green)', border: '1px solid #bbf7d0' }}
            disabled={smtpTesting}
            onClick={async () => {
              setSmtpTesting(true);
              setSmtpTestResult(null);
              try {
                // 저장 전 form 값을 직접 전달
                const f = formVals.current;
                const settingsOverride = {
                  smtp_host: f.smtp_host, smtp_port: f.smtp_port,
                  smtp_user: f.smtp_user, smtp_password: f.smtp_password,
                  smtp_tls: smtpTls,
                  report_email_to: f.report_email_to,
                };
                const res = await api.testSmtp(settingsOverride);
                setSmtpTestResult(res);
              } catch (e: any) {
                setSmtpTestResult({ success: false, message: e.message });
              } finally {
                setSmtpTesting(false);
              }
            }}
          >
            {smtpTesting ? t(lang, 'smtp_test_sending') : t(lang, 'smtp_test_btn')}
          </button>
          {smtpTestResult && (
            <div style={{
              marginTop: 8, padding: '10px 14px', borderRadius: 8, fontSize: 13,
              background: smtpTestResult.success ? '#f0fdf4' : '#fef2f2',
              border: `1px solid ${smtpTestResult.success ? '#86efac' : '#fca5a5'}`,
              color: smtpTestResult.success ? '#166534' : '#dc2626',
              whiteSpace: 'pre-wrap',    // \n 줄바꽔으로 표시
              lineHeight: 1.8,
            }}>
              {smtpTestResult.message}
            </div>
          )}
        </div>
      </div>

      {/* ─── Slack ─────────────────────────────────────────────────────────────── */}
      <div className="settings-section">
        <SectionHeader title={t(lang, 'section_slack')} onManual={() => setManualOpen('slack')} />
        
        <div className="form-group" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
          <label className="checkbox-row" style={{ fontWeight: 700 }}>
            <input
              type="checkbox"
              checked={slackEnabled}
              onChange={e => setSlackEnabled(e.target.checked)}
            />
            {t(lang, 'label_slack_enabled')}
          </label>
          <span style={{ fontSize: 12, color: slackEnabled ? '#16a34a' : '#dc2626', fontWeight: 600 }}>
            {slackEnabled ? 'ON' : 'OFF'}
          </span>
        </div>

        <div className="form-group">
          <label>{t(lang, 'slack_default_webhook_label')}</label>
          <input key={`slack-${loadKey}`} defaultValue={formVals.current.slack_webhook_url || ''} onChange={e => setVal('slack_webhook_url', e.target.value)} placeholder="https://hooks.slack.com/services/..." />
        </div>

        <div className="form-group" style={{ marginTop: 14 }}>
          <label>{t(lang, 'slack_related_webhook_label')}</label>
          <input key={`slack-related-${loadKey}`} defaultValue={formVals.current.slack_webhook_url_related || ''} onChange={e => setVal('slack_webhook_url_related', e.target.value)} placeholder={t(lang, 'slack_related_webhook_placeholder')} />
        </div>

        {/* Slack 메시지 언어 선택 */}
        <div className="form-group" style={{ marginTop: 14 }}>
          <label style={{ display: 'block', marginBottom: 8, fontWeight: 600 }}>
            {t(lang, 'slack_msg_lang_label')}
            <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 400, color: 'var(--text)' }}>
              {t(lang, 'slack_msg_lang_note')}
            </span>
          </label>
          <div style={{ display: 'flex', gap: 10 }}>
            {([
              { value: 'ko', label: '🇰🇷 한국어' },
              { value: 'en', label: '🇺🇸 English' },
              { value: 'ja', label: '🇯🇵 日本語' },
            ] as { value: 'ko' | 'en' | 'ja'; label: string }[]).map(opt => (
              <label
                key={opt.value}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                  padding: '6px 14px', borderRadius: 8,
                  border: `2px solid ${slackLanguage === opt.value ? '#f59e0b' : '#e5e7eb'}`,
                  background: slackLanguage === opt.value ? '#fefce8' : '#fff',
                  fontWeight: slackLanguage === opt.value ? 700 : 400,
                  fontSize: 13,
                }}
              >
                <input
                  type="radio"
                  name="slack_language"
                  value={opt.value}
                  checked={slackLanguage === opt.value}
                  onChange={() => setSlackLanguage(opt.value)}
                  style={{ display: 'none' }}
                />
                {opt.label}
              </label>
            ))}
          </div>
        </div>

        {/* Slack Webhook Test */}
        <div style={{ marginTop: 12, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <button
              className="btn btn-secondary"
              style={{ background: 'var(--yellow-dim)', color: 'var(--yellow)', border: '1px solid #fde68a' }}
              disabled={(window as any).__slackTesting}
              onClick={async (e) => {
                const btn = e.currentTarget;
                btn.disabled = true;
                btn.textContent = t(lang, 'slack_test_sending');
                const resultDiv = btn.parentElement?.querySelector('.slack-test-result') as HTMLElement;
                if (resultDiv) resultDiv.style.display = 'none';
                try {
                  const res = await api.testSlack({
                    slack_webhook_url: formVals.current.slack_webhook_url,
                    slack_language: slackLanguage,
                  }) as any;
                  if (resultDiv) {
                    resultDiv.style.display = 'block';
                    resultDiv.style.background = res.success ? '#f0fdf4' : '#fef2f2';
                    resultDiv.style.borderColor = res.success ? '#86efac' : '#fca5a5';
                    resultDiv.style.color = res.success ? '#166534' : '#dc2626';
                    resultDiv.textContent = `${res.success ? '✅' : '❌'} ${res.message}`;
                  }
                } catch (err: any) {
                  if (resultDiv) {
                    resultDiv.style.display = 'block';
                    resultDiv.style.background = '#fef2f2';
                    resultDiv.style.borderColor = '#fca5a5';
                    resultDiv.style.color = '#dc2626';
                    resultDiv.textContent = `❌ ${err.message}`;
                  }
                } finally {
                  btn.disabled = false;
                  btn.textContent = t(lang, 'slack_default_test');
                }
              }}
            >
              {t(lang, 'slack_default_test')}
            </button>
            <div
              className="slack-test-result"
              style={{
                display: 'none', marginTop: 8, padding: '8px 12px',
                borderRadius: 8, fontSize: 13, border: '1px solid #e5e7eb',
              }}
            />
          </div>

          <div>
            <button
              className="btn btn-secondary"
              style={{ background: 'var(--green-dim)', color: 'var(--green)', border: '1px solid #a7f3d0' }}
              disabled={(window as any).__slackTestingRelated}
              onClick={async (e) => {
                const btn = e.currentTarget;
                btn.disabled = true;
                btn.textContent = t(lang, 'testing');
                const resultDiv = btn.parentElement?.querySelector('.slack-test-related-result') as HTMLElement;
                if (resultDiv) resultDiv.style.display = 'none';
                try {
                  const res = await api.testSlackRelated({
                    slack_webhook_url_related: formVals.current.slack_webhook_url_related,
                    slack_language: slackLanguage,
                  }) as any;
                  if (resultDiv) {
                    resultDiv.style.display = 'block';
                    resultDiv.style.background = res.success ? '#f0fdf4' : '#fef2f2';
                    resultDiv.style.borderColor = res.success ? '#86efac' : '#fca5a5';
                    resultDiv.style.color = res.success ? '#166534' : '#dc2626';
                    resultDiv.textContent = `${res.success ? '✅' : '❌'} ${res.message}`;
                  }
                } catch (err: any) {
                  if (resultDiv) {
                    resultDiv.style.display = 'block';
                    resultDiv.style.background = '#fef2f2';
                    resultDiv.style.borderColor = '#fca5a5';
                    resultDiv.style.color = '#dc2626';
                    resultDiv.textContent = `❌ ${err.message}`;
                  }
                } finally {
                  btn.disabled = false;
                  btn.textContent = t(lang, 'slack_related_test');
                }
              }}
            >
              {t(lang, 'slack_related_test')}
            </button>
            <div
              className="slack-test-related-result"
              style={{
                display: 'none', marginTop: 8, padding: '8px 12px',
                borderRadius: 8, fontSize: 13, border: '1px solid #e5e7eb',
              }}
            />
          </div>
        </div>
      </div>

      {/* ─── Exocad Cancel 자동화 ──────────────────────────────────────────────── */}
      <div className="settings-section">
        <SectionHeader title={t(lang, 'section_exocad')} onManual={() => setManualOpen('exocad')} />
        <div className="form-group">
          <label>{t(lang, 'label_license_url')}</label>
          <input key={`esite-${loadKey}`} defaultValue={formVals.current.exocad_site_url || ''} onChange={e => setVal('exocad_site_url', e.target.value)} placeholder="https://partner.exocad.com/license-management" />
        </div>
        <div className="form-group">
          <label>{t(lang, 'label_login_url')}</label>
          <input key={`elogin-${loadKey}`} defaultValue={formVals.current.exocad_login_url || ''} onChange={e => setVal('exocad_login_url', e.target.value)} placeholder="https://myaccount-us.aligntech.com/u/login?..." />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>{t(lang, 'label_login_email')}</label>
            <input key={`euser-${loadKey}`} defaultValue={formVals.current.exocad_username || ''} onChange={e => setVal('exocad_username', e.target.value)} placeholder="email@example.com" />
          </div>
          <div className="form-group">
            <label>{t(lang, 'label_login_password')}</label>
            <input key={`epw-${loadKey}`} type="password" defaultValue={formVals.current.exocad_password || ''} onChange={e => setVal('exocad_password', e.target.value)} />
          </div>
        </div>
        <div className="form-row-3">
          <div className="form-group">
            <label>{t(lang, 'label_cancel_btn_text')}</label>
            <input key={`cbtn-${loadKey}`} defaultValue={formVals.current.cancel_button_text || ''} onChange={e => setVal('cancel_button_text', e.target.value)} placeholder="opt out upgrade" />
            <small style={{ color: 'var(--text3)', fontSize: 12 }}>{t(lang, 'cancel_btn_hint')}</small>
          </div>
          <div className="form-group">
            <label>{t(lang, 'label_cancel_confirm_text')}</label>
            <input key={`cconf-${loadKey}`} defaultValue={formVals.current.cancel_confirm_text || ''} onChange={e => setVal('cancel_confirm_text', e.target.value)} placeholder="okay" />
            <small style={{ color: 'var(--text3)', fontSize: 12 }}>{t(lang, 'cancel_confirm_hint')}</small>
          </div>
          <div className="form-group">
            <label>{t(lang, 'label_cancel_option_btn_text')}</label>
            <input key={`copt-${loadKey}`} defaultValue={formVals.current.cancel_option_button_text || ''} onChange={e => setVal('cancel_option_button_text', e.target.value)} placeholder="more options, actions, ..." />
            <small style={{ color: 'var(--text3)', fontSize: 12 }}>{t(lang, 'cancel_option_hint')}</small>
          </div>
        </div>
      </div>

      {/* ─── 주문 연동 (URL 폴링) ──────────────────────────────────────────────── */}
      <PollSourcesSection
        initialSources={formVals.current.poll_sources || []}
        loadKey={loadKey}
        onSourcesChange={(s: any[]) => { pollSourcesRef.current = s; }}
        onManual={() => setManualOpen('polling')}
        lang={lang}
      />

      {/* ─── Product Code 그룹 설정 ──────────────────────────────────────────── */}
      <ProductCodeRulesSection
        initialRules={formVals.current.custom_product_code_rules || []}
        loadKey={loadKey}
        onRulesChange={(rules: any[]) => setVal('custom_product_code_rules', rules)}
        lang={lang}
      />

      {/* ─── 기타 설정 ───────────────────────────────────────────────────────── */}
      <div className="settings-section">
        <SectionHeader title={t(lang, 'section_scheduling')} onManual={() => setManualOpen('other')} />
        <div className="form-group" style={{ marginBottom: 18 }}>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={expiryNoticeEnabled}
              onChange={e => setExpiryNoticeEnabled(e.target.checked)}
            />
            {t(lang, 'label_expiry_notice_enabled')}
          </label>
          <small style={{ color: 'var(--text3)', fontSize: 12, display: 'block', marginTop: 4 }}>
            {t(lang, 'expiry_notice_note')}
          </small>
        </div>
        <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 14, marginBottom: 18, background: 'var(--bg3)' }}>
          {expiryNoticeEnabled && (
            <>
            <div className="form-row">
              <div className="form-group">
                <label>{t(lang, 'label_expiry_notice_time')}</label>
                <input
                  key={`entime-${loadKey}`}
                  type="time"
                  defaultValue={formVals.current.expiry_notice_time || '05:00'}
                  onChange={e => setVal('expiry_notice_time', e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>{t(lang, 'label_expiry_notice_stop_template')}</label>
                <select
                  key={`enstop-${loadKey}`}
                  defaultValue={formVals.current.expiry_notice_stop_template || 'stop_expiry_reminder'}
                  onChange={e => setVal('expiry_notice_stop_template', e.target.value)}
                >
                  {mailTemplates.map(template => (
                    <option key={template.code} value={template.code}>
                      {template.name} ({template.code})
                    </option>
                  ))}
                </select>
                <small style={{ color: 'var(--text3)', fontSize: 12 }}>{t(lang, 'expiry_notice_stop_hint')}</small>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
              {expiryNoticeRules.map((rule, index) => (
                <div key={rule.id} style={{ border: '1px solid var(--border2)', borderRadius: 8, padding: 12, background: 'var(--bg2)' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '140px minmax(220px, 1fr) minmax(190px, 1fr) auto auto', gap: 8, alignItems: 'end' }}>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label>{t(lang, 'label_expiry_notice_days')}</label>
                      <input
                        type="number"
                        min={0}
                        max={365}
                        value={rule.days_before}
                        onChange={e => updateExpiryRule(rule.id, { days_before: Number(e.target.value) })}
                      />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label>{t(lang, 'label_expiry_notice_renewal_template')}</label>
                      <select
                        value={rule.renewal_template}
                        onChange={e => updateExpiryRule(rule.id, { renewal_template: e.target.value })}
                      >
                        {mailTemplates.map(template => (
                          <option key={template.code} value={template.code}>
                            {template.name} ({template.code})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label>{t(lang, 'label_expiry_notice_test_email')}</label>
                      <input
                        type="email"
                        value={expiryDryRunEmails[rule.id] || ''}
                        onChange={e => setExpiryDryRunEmails(current => ({ ...current, [rule.id]: e.target.value }))}
                        placeholder="test@example.com"
                      />
                    </div>
                    <button
                      className="btn btn-sm btn-secondary"
                      disabled={!!expiryDryRunning[rule.id]}
                      onClick={() => runExpiryDryRun(rule)}
                    >
                      {expiryDryRunning[rule.id] ? t(lang, 'expiry_notice_dryrun_sending') : t(lang, 'expiry_notice_dryrun')}
                    </button>
                    <button
                      className="btn btn-sm"
                      disabled={expiryNoticeRules.length === 1}
                      style={{ background: 'var(--red-dim)', color: 'var(--red)' }}
                      onClick={() => removeExpiryRule(rule.id)}
                    >
                      {t(lang, 'delete')}
                    </button>
                  </div>
                  {expiryDryRunResults[rule.id] && (
                    <div style={{ marginTop: 8, fontSize: 12, color: expiryDryRunResults[rule.id].startsWith('OK') ? 'var(--green)' : 'var(--red)' }}>
                      {expiryDryRunResults[rule.id]}
                    </div>
                  )}
                  <small style={{ color: 'var(--text3)', fontSize: 12 }}>
                    {t(lang, 'expiry_notice_rule_label').replace('{n}', String(index + 1))}
                  </small>
                </div>
              ))}
              <button className="btn btn-sm btn-secondary" style={{ alignSelf: 'flex-start' }} onClick={addExpiryRule}>
                {t(lang, 'expiry_notice_add_rule')}
              </button>
            </div>

            <div style={{ borderTop: '1px solid var(--border)', marginTop: 14, paddingTop: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '140px minmax(190px, 1fr) auto', gap: 8, alignItems: 'end' }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label>{t(lang, 'label_expiry_notice_stop_dryrun_days')}</label>
                  <input
                    type="number"
                    min={0}
                    max={365}
                    value={stopDryRunDays}
                    onChange={e => setStopDryRunDays(Number(e.target.value))}
                  />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label>{t(lang, 'label_expiry_notice_stop_test_email')}</label>
                  <input
                    type="email"
                    value={stopDryRunEmail}
                    onChange={e => setStopDryRunEmail(e.target.value)}
                    placeholder="test@example.com"
                  />
                </div>
                <button className="btn btn-sm btn-secondary" disabled={stopDryRunning} onClick={runStopTemplateDryRun}>
                  {stopDryRunning ? t(lang, 'expiry_notice_dryrun_sending') : t(lang, 'expiry_notice_stop_dryrun')}
                </button>
              </div>
              {stopDryRunResult && (
                <div style={{ marginTop: 8, fontSize: 12, color: stopDryRunResult.startsWith('OK') ? 'var(--green)' : 'var(--red)' }}>
                  {stopDryRunResult}
                </div>
              )}
            </div>
            </>
          )}

            <div style={{ borderTop: '1px solid var(--border)', marginTop: 14, paddingTop: 12, display: 'grid', gridTemplateColumns: 'repeat(2, minmax(280px, 1fr))', gap: 12 }}>
              <div style={{ border: '1px solid var(--border2)', borderRadius: 8, padding: 12, background: 'var(--bg2)' }}>
                <label className="checkbox-row" style={{ marginBottom: 10 }}>
                  <input
                    type="checkbox"
                    checked={stopRequestNoticeEnabled}
                    onChange={e => setStopRequestNoticeEnabled(e.target.checked)}
                  />
                  {t(lang, 'label_stop_request_notice_enabled')}
                </label>
                <div className="form-group">
                  <label>{t(lang, 'label_stop_request_notice_template')}</label>
                  <select
                    key={`stopreqtmpl-${loadKey}`}
                    defaultValue={formVals.current.stop_request_notice_template || 'stop_request_received'}
                    onChange={e => setVal('stop_request_notice_template', e.target.value)}
                  >
                    {mailTemplates.map(template => (
                      <option key={template.code} value={template.code}>
                        {template.name} ({template.code})
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'end' }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label>{t(lang, 'label_lifecycle_test_email')}</label>
                    <input
                      type="email"
                      value={lifecycleDryRunEmails.stop_request || ''}
                      onChange={e => setLifecycleDryRunEmails(current => ({ ...current, stop_request: e.target.value }))}
                      placeholder="test@example.com"
                    />
                  </div>
                  <button
                    className="btn btn-sm btn-secondary"
                    disabled={!!lifecycleDryRunning.stop_request}
                    onClick={() => runLifecycleDryRun('stop_request', formVals.current.stop_request_notice_template || 'stop_request_received')}
                  >
                    {lifecycleDryRunning.stop_request ? t(lang, 'expiry_notice_dryrun_sending') : t(lang, 'expiry_notice_dryrun')}
                  </button>
                </div>
                {lifecycleDryRunResults.stop_request && (
                  <div style={{ marginTop: 8, fontSize: 12, color: lifecycleDryRunResults.stop_request.startsWith('OK') ? 'var(--green)' : 'var(--red)' }}>
                    {lifecycleDryRunResults.stop_request}
                  </div>
                )}
              </div>

              <div style={{ border: '1px solid var(--border2)', borderRadius: 8, padding: 12, background: 'var(--bg2)' }}>
                <label className="checkbox-row" style={{ marginBottom: 10 }}>
                  <input
                    type="checkbox"
                    checked={cancelCompleteNoticeEnabled}
                    onChange={e => setCancelCompleteNoticeEnabled(e.target.checked)}
                  />
                  {t(lang, 'label_cancel_complete_notice_enabled')}
                </label>
                <div className="form-group">
                  <label>{t(lang, 'label_cancel_complete_notice_template')}</label>
                  <select
                    key={`cancelcompletetmpl-${loadKey}`}
                    defaultValue={formVals.current.cancel_complete_notice_template || 'cancel_confirmation'}
                    onChange={e => setVal('cancel_complete_notice_template', e.target.value)}
                  >
                    {mailTemplates.map(template => (
                      <option key={template.code} value={template.code}>
                        {template.name} ({template.code})
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'end' }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label>{t(lang, 'label_lifecycle_test_email')}</label>
                    <input
                      type="email"
                      value={lifecycleDryRunEmails.cancel_complete || ''}
                      onChange={e => setLifecycleDryRunEmails(current => ({ ...current, cancel_complete: e.target.value }))}
                      placeholder="test@example.com"
                    />
                  </div>
                  <button
                    className="btn btn-sm btn-secondary"
                    disabled={!!lifecycleDryRunning.cancel_complete}
                    onClick={() => runLifecycleDryRun('cancel_complete', formVals.current.cancel_complete_notice_template || 'cancel_confirmation')}
                  >
                    {lifecycleDryRunning.cancel_complete ? t(lang, 'expiry_notice_dryrun_sending') : t(lang, 'expiry_notice_dryrun')}
                  </button>
                </div>
                {lifecycleDryRunResults.cancel_complete && (
                  <div style={{ marginTop: 8, fontSize: 12, color: lifecycleDryRunResults.cancel_complete.startsWith('OK') ? 'var(--green)' : 'var(--red)' }}>
                    {lifecycleDryRunResults.cancel_complete}
                  </div>
                )}
              </div>
            </div>
          </div>
        <div className="form-group">
          <label>{t(lang, 'label_mail_check_times')}</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {(formVals.current.mail_check_times || []).map((time: string, idx: number) => (
              <div key={idx} style={{ display: 'flex', gap: 6 }}>
                <input
                  type="time"
                  defaultValue={time}
                  onChange={e => {
                    const newTimes = [...(formVals.current.mail_check_times || [])];
                    newTimes[idx] = e.target.value;
                    setVal('mail_check_times', newTimes);
                  }}
                />
                <button
                  className="btn btn-sm"
                  style={{ padding: '0 8px', background: 'var(--red-dim)', color: 'var(--red)' }}
                  onClick={() => {
                    const newTimes = (formVals.current.mail_check_times || []).filter((_: any, i: number) => i !== idx);
                    setVal('mail_check_times', newTimes);
                    // 강제 렌더링용 임시 state 업데이트
                    setLoadKey(k => k + 1);
                  }}
                >{t(lang, 'delete')}</button>
              </div>
            ))}
            <button
              className="btn btn-sm btn-secondary"
              style={{ alignSelf: 'flex-start', fontSize: 11 }}
              onClick={() => {
                const newTimes = [...(formVals.current.mail_check_times || []), '12:00'];
                setVal('mail_check_times', newTimes);
                setLoadKey(k => k + 1);
              }}
            >{t(lang, 'btn_add_time')}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 주문 URL 폴링 섹션 ─────────────────────────────────────────────────────
function PollSourcesSection({ initialSources, loadKey, onSourcesChange, onManual, lang }: {
  initialSources: any[];
  loadKey: number;
  onSourcesChange: (sources: any[]) => void;
  onManual: () => void;
  lang: any;
}) {
  const [sources, setSources] = useState<any[]>(initialSources);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const [pollMsg, setPollMsg] = useState('');
  // Per-source dry-run state: { [sourceId]: { running: bool, result: PollDryRunSourceResult | null } }
  const [dryRunState, setDryRunState] = useState<Record<string, { running: boolean; result: any | null }>>({});

  // Reset when parent reloads settings
  useEffect(() => {
    setSources(initialSources);
  }, [loadKey]);

  const save = (newSources: any[]) => {
    setSources(newSources);
    onSourcesChange(newSources);
  };

  const addSource = () => {
    const s = emptySource();
    save([...sources, s]);
    setExpanded(s.id);
  };

  const removeSource = (id: string) => save(sources.filter((s: any) => s.id !== id));

  const updateSource = (id: string, field: string, value: any) =>
    save(sources.map((s: any) => s.id === id ? { ...s, [field]: value } : s));

  const handlePollNow = async (sourceId?: string) => {
    setPolling(true);
    setPollMsg(t(lang, 'polling_now'));
    try {
      const result = await api.pollNow(sourceId) as any;
      setPollMsg(`${t(lang, 'poll_complete')}${result.found}${t(lang, 'poll_collected')}${result.errors.length > 0 ? `${t(lang, 'poll_error_count')}${result.errors.length}${t(lang, 'poll_error_suffix')}` : ''}`);
      if (result.errors.length > 0) alert(t(lang, 'orders_poll_errors') + result.errors.join('\n'));
    } catch (e: any) {
      setPollMsg(`${t(lang, 'orders_poll_error')}${e.message}`);
    } finally {
      setPolling(false);
    }
  };

  const handlePollDryRun = async (sourceId: string) => {
    setDryRunState(prev => ({ ...prev, [sourceId]: { running: true, result: null } }));
    try {
      // \ud604\uc7ac form\uc5d0 \uc785\ub825\ub41c \uac12\uc744 \uc800\uc7a5 \uc804\uc5d0\ub3c4 \ubc18\uc601\ud558\uae30 \uc704\ud574 source \uac1d\uccb4 \uc790\uccb4\ub97c overrides\ub85c \uc804\ub2ec
      const currentSrc = sources.find((s: any) => s.id === sourceId);
      const dryResult = await api.pollDryRun(sourceId, currentSrc || {}) as any;
      // dryResult.sources[0] is the result for this source
      const sourceResult = dryResult.sources && dryResult.sources[0] ? dryResult.sources[0] : null;
      setDryRunState(prev => ({ ...prev, [sourceId]: { running: false, result: sourceResult } }));
    } catch (e: any) {
      setDryRunState(prev => ({ ...prev, [sourceId]: { running: false, result: { error: e.message, rows: [], would_insert: 0, already_fetched: 0 } } }));
    }
  };

  return (
    <div className="settings-section">
      <SectionHeader title={t(lang, 'section_polling')} onManual={onManual} />
      <p style={{ color: 'var(--text)', fontSize: 13, marginBottom: 16 }}>
        {t(lang, 'polling_desc')}<strong>{t(lang, 'polling_desc2')}</strong>{t(lang, 'polling_desc3')}
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button
          className="btn btn-primary"
          onClick={() => handlePollNow()}
          disabled={polling || sources.filter((s: any) => s.enabled).length === 0}
        >
          {polling ? t(lang, 'polling_now') : t(lang, 'btn_poll_all')}
        </button>
        {pollMsg && <span style={{ fontSize: 13, color: 'var(--text)' }}>{pollMsg}</span>}
      </div>

      {sources.length === 0 && (
        <div style={{ padding: '20px', textAlign: 'center', background: 'var(--bg3)', borderRadius: 8, color: 'var(--text)', marginBottom: 12 }}>
          {t(lang, 'no_poll_sources')}
        </div>
      )}

      {sources.map((src: any) => (
        <div key={src.id} style={{ border: '1px solid #e5e7eb', borderRadius: 8, marginBottom: 12, overflow: 'hidden' }}>
          <div
            style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', background: 'var(--bg3)', cursor: 'pointer', gap: 10 }}
            onClick={() => setExpanded(expanded === src.id ? null : src.id)}
          >
            <input
              type="checkbox"
              checked={src.enabled}
              onClick={e => e.stopPropagation()}
              onChange={e => updateSource(src.id, 'enabled', e.target.checked)}
            />
            <span style={{ flex: 1, fontWeight: 600, fontSize: 14 }}>{src.name || t(lang, 'polling_default_name')}</span>
            {src.last_polled && (
              <span style={{ fontSize: 11, color: 'var(--text)' }}>{t(lang, 'last_polled')}{src.last_polled.slice(0, 16).replace('T', ' ')}</span>
            )}
            <button
              className="btn btn-sm btn-primary"
              style={{ fontSize: 11, padding: '2px 8px' }}
              onClick={e => { e.stopPropagation(); handlePollNow(src.id); }}
              disabled={polling}
            >{t(lang, 'btn_poll_now')}</button>
            <button
              className="btn btn-sm"
              style={{ fontSize: 11, padding: '2px 8px', background: 'var(--bg3)', color: 'var(--accent)', border: '1px solid #c4b5fd' }}
              onClick={e => { e.stopPropagation(); handlePollDryRun(src.id); }}
              disabled={dryRunState[src.id]?.running}
            >{dryRunState[src.id]?.running ? t(lang, 'poll_dryrun_running') : t(lang, 'btn_poll_dryrun')}</button>
            <button
              className="btn btn-sm"
              style={{ fontSize: 11, padding: '2px 8px', background: 'var(--red-dim)', color: 'var(--red)' }}
              onClick={e => { e.stopPropagation(); if (confirm(t(lang, 'confirm_delete_source'))) removeSource(src.id); }}
            >{t(lang, 'delete')}</button>
            <span>{expanded === src.id ? '▲' : '▼'}</span>
          </div>

          {/* Poll Dry-Run Result Panel */}
          {dryRunState[src.id]?.result !== null && dryRunState[src.id]?.result !== undefined && (() => {
            const dr = dryRunState[src.id].result;
            return (
              <div style={{ borderTop: '1px solid #e5e7eb', background: 'var(--bg3)' }}>
                <div style={{ padding: '8px 14px', background: 'var(--bg3)', fontWeight: 700, fontSize: 12, color: 'var(--accent)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>{t(lang, 'poll_dryrun_result')}</span>
                  {!dr.error && (
                    <span style={{ fontWeight: 400, color: 'var(--accent)', fontSize: 11 }}>
                      {dr.rows.length}{t(lang, 'poll_dryrun_summary')}{dr.would_insert}{t(lang, 'poll_dryrun_summary2')}{dr.already_fetched}{t(lang, 'poll_dryrun_summary3')}{dr.rows.filter((r: any) => r.filtered_out).length}{t(lang, 'poll_dryrun_summary4')}
                    </span>
                  )}
                </div>
                {dr.error ? (
                  <div style={{ padding: '10px 14px', color: 'var(--red)', fontSize: 12 }}>⚠ {dr.error}</div>
                ) : dr.rows.length === 0 ? (
                  <div style={{ padding: '10px 14px', color: 'var(--text)', fontSize: 12 }}>{t(lang, 'poll_dryrun_no_rows')}</div>
                ) : (
                  <div style={{ overflowX: 'auto', maxHeight: 260 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                      <thead>
                        <tr style={{ background: 'var(--bg3)', position: 'sticky', top: 0 }}>
                          <th style={thStyle}>Status</th>
                          <th style={thStyle}>{t(lang, 'cancel_dryrun_col_serial')}</th>
                          <th style={thStyle}>{t(lang, 'cancel_dryrun_col_customer')}</th>
                          <th style={thStyle}>{t(lang, 'col_phone')}</th>
                          <th style={thStyle}>{t(lang, 'label_product_col')}</th>
                          <th style={thStyle}>{t(lang, 'label_purchase_col')}</th>
                          <th style={thStyle}>{t(lang, 'label_expiry_col')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dr.rows.map((row: any, ri: number) => {
                          const status = row.filtered_out ? 'filtered' : row.already_exists ? 'dup' : 'new';
                          const bg = status === 'new' ? '#f0fdf4' : status === 'dup' ? '#fefce8' : '#f3f4f6';
                          const badge = status === 'new'
                            ? <span style={{ background: 'var(--green-dim)', color: 'var(--green)', borderRadius: 4, padding: '1px 6px', fontWeight: 700 }}>{t(lang, 'poll_dryrun_new')}</span>
                            : status === 'dup'
                              ? <span style={{ background: 'var(--yellow-dim)', color: 'var(--yellow)', borderRadius: 4, padding: '1px 6px', fontWeight: 700 }}>{t(lang, 'poll_dryrun_already')}</span>
                              : <span style={{ background: 'var(--bg4)', color: 'var(--text)', borderRadius: 4, padding: '1px 6px', fontWeight: 700 }}>{t(lang, 'poll_dryrun_filtered')}</span>;
                          return (
                            <tr key={ri} style={{ background: bg, borderBottom: '1px solid #f3f4f6' }}>
                              <td style={tdStyle}>{badge}</td>
                              <td style={tdStyle}><code style={{ fontSize: 10 }}>{row.serial_number}</code></td>
                              <td style={tdStyle}>{row.customer_name}</td>
                              <td style={tdStyle}>{row.phone}</td>
                              <td style={tdStyle}>{row.product}</td>
                              <td style={tdStyle}>{row.purchase_date}</td>
                              <td style={tdStyle}>{row.expiry_date}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })()}

          {expanded === src.id && (
            <div style={{ padding: '14px 16px' }}>
              <div style={sectionLabel}>{t(lang, 'section_basic_info')}</div>
              <div className="form-row">
                <div className="form-group">
                  <label>{t(lang, 'label_source_name')}</label>
                  <input value={src.name} onChange={e => updateSource(src.id, 'name', e.target.value)} placeholder={t(lang, 'poll_source_name_placeholder')} />
                </div>
                <div className="form-group">
                  <label>{t(lang, 'poll_schedule_label')}</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {(src.schedule_times || []).map((time: string, idx: number) => (
                      <div key={idx} style={{ display: 'flex', gap: 6 }}>
                        <input
                          type="time"
                          value={time}
                          onChange={e => {
                            const newTimes = [...(src.schedule_times || [])];
                            newTimes[idx] = e.target.value;
                            updateSource(src.id, 'schedule_times', newTimes);
                          }}
                        />
                        <button
                          className="btn btn-sm"
                          style={{ padding: '0 8px', background: 'var(--red-dim)', color: 'var(--red)' }}
                          onClick={() => {
                            const newTimes = (src.schedule_times || []).filter((_: any, i: number) => i !== idx);
                            updateSource(src.id, 'schedule_times', newTimes);
                          }}
                        >{t(lang, 'delete')}</button>
                      </div>
                    ))}
                    <button
                      className="btn btn-sm btn-secondary"
                      style={{ alignSelf: 'flex-start', fontSize: 11 }}
                      onClick={() => {
                        const newTimes = [...(src.schedule_times || []), '09:00'];
                        updateSource(src.id, 'schedule_times', newTimes);
                      }}
                    >{t(lang, 'btn_add_time')}</button>
                  </div>
                </div>
              </div>
              <div className="form-group">
                <label>{t(lang, 'label_order_url')} <span style={{ color: 'var(--red)' }}>*</span></label>
                <input value={src.url} onChange={e => updateSource(src.id, 'url', e.target.value)} placeholder="https://admin.myshop.com/orders" />
                <small style={{ color: 'var(--text3)', fontSize: 12 }}>{t(lang, 'poll_url_hint')}</small>
              </div>

              <div style={{ ...sectionLabel, marginTop: 14 }}>{t(lang, 'section_login_info')}</div>
              <div className="form-group">
                <label>{t(lang, 'label_login_page')}</label>
                <input value={src.login_url} onChange={e => updateSource(src.id, 'login_url', e.target.value)} placeholder={t(lang, 'poll_login_url_placeholder')} />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>{t(lang, 'label_login_id')}</label>
                  <input value={src.login_id} onChange={e => updateSource(src.id, 'login_id', e.target.value)} placeholder="admin@example.com" />
                </div>
                <div className="form-group">
                  <label>{t(lang, 'label_password')}</label>
                  <input type="password" value={src.login_pw} onChange={e => updateSource(src.id, 'login_pw', e.target.value)} />
                </div>
              </div>

              <div style={{ ...sectionLabel, marginTop: 14 }}>{t(lang, 'section_field_mapping')}</div>
              <small style={{ color: 'var(--text3)', fontSize: 12, display: 'block', marginBottom: 10 }}>
                {t(lang, 'field_mapping_note')}
              </small>
              <div className="form-row">
                <div className="form-group">
                  <label>{t(lang, 'label_serial_col')}</label>
                  <input value={src.field_serial} onChange={e => updateSource(src.id, 'field_serial', e.target.value)} placeholder={t(lang, 'poll_serial_placeholder')} />
                </div>
                <div className="form-group">
                  <label>{t(lang, 'label_customer_col')}</label>
                  <input value={src.field_customer} onChange={e => updateSource(src.id, 'field_customer', e.target.value)} placeholder={t(lang, 'poll_customer_placeholder')} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>{t(lang, 'label_phone_col')}</label>
                  <input value={src.field_phone} onChange={e => updateSource(src.id, 'field_phone', e.target.value)} placeholder={t(lang, 'poll_phone_placeholder')} />
                </div>
                <div className="form-group">
                  <label>{t(lang, 'label_product_col')}</label>
                  <input value={src.field_product} onChange={e => updateSource(src.id, 'field_product', e.target.value)} placeholder={t(lang, 'poll_product_placeholder')} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>{t(lang, 'label_purchase_col')}</label>
                  <input value={src.field_purchase} onChange={e => updateSource(src.id, 'field_purchase', e.target.value)} placeholder={t(lang, 'poll_purchase_placeholder')} />
                </div>
                <div className="form-group">
                  <label>{t(lang, 'label_expiry_col')}</label>
                  <input value={src.field_expiry} onChange={e => updateSource(src.id, 'field_expiry', e.target.value)} placeholder={t(lang, 'poll_expiry_placeholder')} />
                </div>
              </div>
              <div className="form-group" style={{ marginTop: 10 }}>
                <label>{t(lang, 'label_product_filter')}</label>
                <input value={src.product_filter || ''} onChange={e => updateSource(src.id, 'product_filter', e.target.value)} placeholder="exocad, DentalCAD, ..." />
                <small style={{ color: 'var(--text3)', fontSize: 12 }}>{t(lang, 'poll_filter_hint')}</small>
              </div>
            </div>
          )}
        </div>
      ))}

      <button className="btn btn-secondary" onClick={addSource}>{t(lang, 'btn_add_source')}</button>
    </div>
  );
}

const sectionLabel: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.07em',
  color: 'var(--accent)',
  borderBottom: '1px solid #e5e7eb',
  paddingBottom: 4,
  marginBottom: 10,
};

const thStyle: React.CSSProperties = {
  padding: '6px 10px',
  textAlign: 'left',
  fontWeight: 600,
  fontSize: 11,
  color: 'var(--text)',
  whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
  padding: '5px 10px',
  verticalAlign: 'middle',
};

function checkIcon(val: boolean | undefined): React.ReactNode {
  if (val === undefined) return '—';
  return val
    ? <span style={{ color: 'var(--green)', fontWeight: 700 }}>✓</span>
    : <span style={{ color: 'var(--red)', fontWeight: 700 }}>✗</span>;
}

// ── Product Code 그룹 설정 섹션 ─────────────────────────────────────────────
type ProductCodeGroup = 'renewal' | 'addon' | 'main' | 'memo' | 'version_update' | 'ignore';
interface ProductCodeRule { code: string; group: ProductCodeGroup; note?: string; }

const GROUP_META: Record<ProductCodeGroup, { label: string; color: string; bg: string; descKey: string }> = {
  renewal: { label: 'A · Renewal', color: 'var(--blue)', bg: 'var(--blue-dim)', descKey: 'group_desc_renewal' },
  addon: { label: 'B · Add-On', color: 'var(--green)', bg: 'var(--green-dim)', descKey: 'group_desc_addon' },
  main: { label: 'C · Main Product', color: 'var(--accent)', bg: 'var(--accent-dim)', descKey: 'group_desc_main' },
  memo: { label: 'D · Memo', color: 'var(--yellow)', bg: 'var(--yellow-dim)', descKey: 'group_desc_memo' },
  version_update: { label: 'E · Version Update', color: 'var(--red)', bg: 'var(--red-dim)', descKey: 'group_desc_version_update' },
  ignore: { label: 'F · Ignore', color: 'var(--text)', bg: 'var(--bg4)', descKey: 'group_desc_ignore' },
};

const BUILT_IN_DISPLAY: Record<ProductCodeGroup, string[]> = {
  renewal: ['006-001017', '006-001035', '006-005200', '006-005201', '006-005212', '006-005213', '006-005214', '006-005215'],
  addon: ['006-001002', '006-001003', '006-001004', '006-001005', '006-001006', '006-001007', '006-001008', '006-001009',
    '006-001010', '006-001011', '006-001012', '006-001013', '006-001014', '006-001015', '006-001016', '006-001037',
    '006-001039', '006-005100', '006-005101', '006-005102', '006-005103', '006-005104', '006-005105', '006-005106',
    '006-005107', '006-005108', '006-005109', '006-005110'],
  main: ['006-001001', '006-001034', '006-001020', '006-005082', '006-005083', '006-005098', '006-005099'],
  memo: ['006-001031', '006-001033', '006-001036', '006-001040', '006-001041', '006-005080', '006-005081', '006-006100', '006-006104'],
  version_update: ['006-001032'],
  ignore: ['006-001018', '006-001019', '006-001021', '006-001022', '006-001023', '006-001024', '006-001025', '006-001026',
    '006-001027', '006-001028', '006-001029', '006-001030', '006-001038', '006-005198', '006-005199', '006-005202',
    '006-005203', '006-005204', '006-005205', '006-005206', '006-005207', '006-005208', '006-005209', '006-005210', '006-005211'],
};

function ProductCodeRulesSection({ initialRules, loadKey, onRulesChange, lang }: {
  initialRules: ProductCodeRule[];
  loadKey: number;
  onRulesChange: (rules: ProductCodeRule[]) => void;
  lang: any;
}) {
  const [rules, setRules] = useState<ProductCodeRule[]>(initialRules);
  const [newCode, setNewCode] = useState('');
  const [newGroup, setNewGroup] = useState<ProductCodeGroup>('addon');
  const [newNote, setNewNote] = useState('');
  const [collapsed, setCollapsed] = useState<Record<ProductCodeGroup, boolean>>({
    renewal: true, addon: true, main: true, memo: true, version_update: true, ignore: true,
  });

  useEffect(() => { setRules(initialRules); }, [loadKey]);

  const save = (next: ProductCodeRule[]) => { setRules(next); onRulesChange(next); };

  const addRule = () => {
    const code = newCode.trim();
    if (!code) return;
    if (rules.some(r => r.code === code)) {
      alert(t(lang, 'product_code_duplicate').replace('{code}', code));
      return;
    }
    save([...rules, { code, group: newGroup, note: newNote.trim() || undefined }]);
    setNewCode(''); setNewNote('');
  };

  const removeRule = (code: string) => save(rules.filter(r => r.code !== code));

  const toggleCollapse = (g: ProductCodeGroup) =>
    setCollapsed(prev => ({ ...prev, [g]: !prev[g] }));

  return (
    <div className="settings-section">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h3 style={{ margin: 0 }}>{t(lang, 'product_code_title')}</h3>
        <span style={{ fontSize: 12, color: 'var(--text)' }}>{t(lang, 'product_code_sub')}</span>
      </div>

      {/* 그룹별 내장 코드 목록 */}
      <div style={{ marginBottom: 20 }}>
        <p style={{ fontSize: 12, color: 'var(--text)', margin: '0 0 10px' }}>
          {t(lang, 'product_code_note')}
        </p>
        {(Object.keys(GROUP_META) as ProductCodeGroup[]).map(g => {
          const meta = GROUP_META[g];
          const builtIn = BUILT_IN_DISPLAY[g];
          const custom = rules.filter(r => r.group === g);
          const isOpen = !collapsed[g];
          return (
            <div key={g} style={{ marginBottom: 8, border: `1px solid ${meta.color}33`, borderRadius: 8, overflow: 'hidden' }}>
              <button
                onClick={() => toggleCollapse(g)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '8px 12px', background: meta.bg, border: 'none', cursor: 'pointer',
                  fontWeight: 600, fontSize: 13, color: meta.color,
                }}
              >
                <span>{meta.label}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text)' }}>{t(lang, meta.descKey as any)}</span>
                  <span style={{ fontSize: 11, background: meta.color, color: '#fff', borderRadius: 10, padding: '1px 7px' }}>
                    {t(lang, 'product_code_count').replace('{n}', String(builtIn.length + custom.length))}
                  </span>
                  <span style={{ fontSize: 12 }}>{isOpen ? '▲' : '▼'}</span>
                </span>
              </button>
              {isOpen && (
                <div style={{ padding: '10px 12px', background: 'var(--bg2)' }}>
                  {/* 내장 코드 (read-only) */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: custom.length > 0 ? 8 : 0 }}>
                    {builtIn.map(code => (
                      <span key={code} style={{
                        fontSize: 11, fontFamily: 'monospace', background: meta.bg,
                        border: `1px solid ${meta.color}44`, borderRadius: 4, padding: '2px 6px', color: meta.color,
                      }}>{code}</span>
                    ))}
                  </div>
                  {/* 커스텀 코드 목록 */}
                  {custom.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, paddingTop: 6, borderTop: `1px dashed ${meta.color}33` }}>
                      {custom.map(r => (
                        <span key={r.code} style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          fontSize: 11, fontFamily: 'monospace',
                          background: 'var(--yellow-dim)', border: '1px solid #fbbf24', borderRadius: 4, padding: '2px 6px', color: 'var(--yellow)',
                        }}>
                          ★ {r.code}{r.note ? ` (${r.note})` : ''}
                          <button
                            onClick={() => removeRule(r.code)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--red)', fontSize: 12, lineHeight: 1, padding: 0 }}
                          >✕</button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 커스텀 코드 추가 */}
      <div style={{ background: 'var(--bg3)', border: '1px solid #e2e8f0', borderRadius: 8, padding: '14px 16px' }}>
        <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)', marginBottom: 10 }}>{t(lang, 'product_code_add_title')}</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 140px' }}>
            <label style={{ fontSize: 11, color: 'var(--text)', display: 'block', marginBottom: 3 }}>Product Code</label>
            <input
              value={newCode}
              onChange={e => setNewCode(e.target.value)}
              placeholder="006-001099"
              style={{ fontFamily: 'monospace', fontSize: 13, width: '100%' }}
              onKeyDown={e => { if (e.key === 'Enter') addRule(); }}
            />
          </div>
          <div style={{ flex: '1 1 160px' }}>
            <label style={{ fontSize: 11, color: 'var(--text)', display: 'block', marginBottom: 3 }}>{t(lang, 'product_code_group_label')}</label>
            <select
              value={newGroup}
              onChange={e => setNewGroup(e.target.value as ProductCodeGroup)}
              style={{ width: '100%', fontSize: 13, padding: '6px 8px', borderRadius: 6, border: '1px solid #d1d5db' }}
            >
              {(Object.keys(GROUP_META) as ProductCodeGroup[]).map(g => (
                <option key={g} value={g}>{GROUP_META[g].label}</option>
              ))}
            </select>
          </div>
          <div style={{ flex: '2 1 160px' }}>
            <label style={{ fontSize: 11, color: 'var(--text)', display: 'block', marginBottom: 3 }}>{t(lang, 'product_code_memo_label')}</label>
            <input
              value={newNote}
              onChange={e => setNewNote(e.target.value)}
              placeholder="예: 신제품 모듈"
              style={{ fontSize: 13, width: '100%' }}
            />
          </div>
          <button
            onClick={addRule}
            className="btn btn-primary"
            style={{ flexShrink: 0, height: 36, alignSelf: 'flex-end' }}
          >{t(lang, 'product_code_add_btn')}</button>
        </div>
        {rules.length > 0 && (
          <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text)' }}>
            {t(lang, 'product_code_registered').replace('{n}', String(rules.length))}
          </div>
        )}
      </div>
    </div>
  );
}
