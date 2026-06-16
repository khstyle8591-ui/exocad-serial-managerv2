import React, { useEffect, useRef, useState } from 'react';
import { genId } from './settings/SettingsShared';
import { AutoCancelSection } from './settings/AutoCancelSection';
import { ExocadSection } from './settings/ExocadSection';
import { MailReceiveSection } from './settings/MailReceiveSection';
import { LanguageSection } from './settings/LanguageSection';
import { PollSourcesSection } from './settings/PollSourcesSection';
import { ProductCodeRulesSection } from './settings/ProductCodeRulesSection';
import { SchedulingSection } from './settings/SchedulingSection';
import { SlackSection } from './settings/SlackSection';
import { SmtpSection } from './settings/SmtpSection';
import { getErrorMessage, type SettingsFormValues } from './settings/settingsTypes';
import { useLang } from '../App';
import { t } from '../i18n';
import type { Language } from '../i18n';
import { api } from '../client';
import type { AppSettings, CancelDryRunResult, ExpiryNoticeRule, MailConnectionResult, MailTemplate, PollSource, ProductCodeRule } from '../../shared/types';
import type { SettingsRenewalDryRunResult } from './settings/settingsTypes';


type RawExpiryNoticeRule = Partial<ExpiryNoticeRule> & {
  id?: unknown;
  days_before?: unknown;
  renewal_template?: unknown;
};

function normalizeExpiryRules(settings: Partial<AppSettings>): ExpiryNoticeRule[] {
  const rawRules = Array.isArray(settings.expiry_notice_rules) ? settings.expiry_notice_rules : [];
  const fallbackTemplate = settings.expiry_notice_renewal_template || 'renewal_reminder';
  const rules = rawRules
    .map((rule: RawExpiryNoticeRule) => ({
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
  const [imapMarkSeen, setImapMarkSeen] = useState(false);
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
  const [cancelDryResults, setCancelDryResults] = useState<CancelDryRunResult[] | null>(null);

  // Renewal Dry-Run state
  const [renewalDryRunning, setRenewalDryRunning] = useState(false);
  const [renewalDryRunResult, setRenewalDryRunResult] = useState<SettingsRenewalDryRunResult | null>(null);

  // Mail Connection Test state
  const [connTesting, setConnTesting] = useState(false);
  const [connTestResult, setConnTestResult] = useState<MailConnectionResult | null>(null);
  const [requireSerial, setRequireSerial] = useState(true);
  const [productKeywords, setProductKeywords] = useState<string[]>([]);
  const [actionKeywords, setActionKeywords] = useState<string[]>([]);
  const [excludeKeywords, setExcludeKeywords] = useState<string[]>([]);
  const [keywordInputs, setKeywordInputs] = useState<Record<string, string>>({});
  const [missingInfoAutoReply, setMissingInfoAutoReply] = useState(false);
  const [invalidResponseAutoReply, setInvalidResponseAutoReply] = useState(false);

  // SMTP Connection Test state
  const [smtpTesting, setSmtpTesting] = useState(false);
  const [smtpTestResult, setSmtpTestResult] = useState<MailConnectionResult | null>(null);

  // All text/number field values stored in a ref — no re-render on change
  const formVals = useRef<SettingsFormValues>({});
  // Poll sources managed separately (already has its own local state in child)
  const pollSourcesRef = useRef<PollSource[]>([]);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const [data, templates] = await Promise.all([
        api.getSettings() as Promise<AppSettings>,
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
      setImapMarkSeen(data.imap_mark_seen_after_check ?? false);
      setSmtpTls(data.smtp_tls ?? false);
      setRequireSerial(data.require_serial_format ?? true);
      setProductKeywords(normalizeKeywordList(data.renewal_product_keywords));
      setActionKeywords(normalizeKeywordList(data.renewal_action_keywords?.length ? data.renewal_action_keywords : data.renewal_keywords));
      setExcludeKeywords(normalizeKeywordList(data.renewal_exclude_keywords));
      setKeywordInputs({});
      setMissingInfoAutoReply(data.missing_info_auto_reply_enabled ?? false);
      setInvalidResponseAutoReply(data.invalid_response_auto_reply_enabled ?? false);
      // Increment key to reset all defaultValue inputs with new data
      setLoadKey(k => k + 1);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // Update ref only — no re-render
  const setVal = (key: string, value: unknown) => {
    formVals.current[key] = value;
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
        imap_mark_seen_after_check: imapMarkSeen,
        smtp_tls: smtpTls,
        poll_sources: pollSourcesRef.current,
        require_serial_format: requireSerial,
        renewal_product_keywords: productKeywords,
        renewal_action_keywords: actionKeywords,
        renewal_exclude_keywords: excludeKeywords,
        missing_info_auto_reply_enabled: missingInfoAutoReply,
        invalid_response_auto_reply_enabled: invalidResponseAutoReply,
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
    } catch (err: unknown) {
      alert(`${t(lang, 'settings_save_fail')}${getErrorMessage(err)}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div>{t(lang, 'loading')}</div>;

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

      <LanguageSection
        lang={lang}
        appLanguage={appLanguage}
        setAppLanguage={setAppLanguage}
        onManual={() => setManualOpen('language')}
      />

      <AutoCancelSection
        lang={lang}
        loadKey={loadKey}
        formVals={formVals}
        setVal={setVal}
        autoCancelEnabled={autoCancelEnabled}
        setAutoCancelEnabled={setAutoCancelEnabled}
        autoCancelTime={autoCancelTime}
        setAutoCancelTime={setAutoCancelTime}
        cancelDryRunning={cancelDryRunning}
        setCancelDryRunning={setCancelDryRunning}
        cancelDryResults={cancelDryResults}
        setCancelDryResults={setCancelDryResults}
        onManual={() => setManualOpen('autoCancel')}
      />

      <MailReceiveSection
        lang={lang}
        loadKey={loadKey}
        formVals={formVals}
        setVal={setVal}
        connection={{
          protocol,
          setProtocol,
          pop3Tls,
          setPop3Tls,
          pop3KeepCopy,
          setPop3KeepCopy,
          imapTls,
          setImapTls,
          imapMarkSeen,
          setImapMarkSeen,
          connTesting,
          setConnTesting,
          connTestResult,
          setConnTestResult,
        }}
        renewalKeywords={{
          mailTemplates,
          productKeywords,
          setProductKeywords,
          actionKeywords,
          setActionKeywords,
          excludeKeywords,
          setExcludeKeywords,
          keywordInputs,
          setKeywordInputs,
          missingInfoAutoReply,
          setMissingInfoAutoReply,
          invalidResponseAutoReply,
          setInvalidResponseAutoReply,
          requireSerial,
          setRequireSerial,
        }}
        renewalDryRun={{
          renewalDryRunning,
          setRenewalDryRunning,
          renewalDryRunResult,
          setRenewalDryRunResult,
        }}
        onManual={() => setManualOpen('mailRecv')}
      />

      <SmtpSection
        lang={lang}
        loadKey={loadKey}
        formVals={formVals}
        setVal={setVal}
        smtpTls={smtpTls}
        setSmtpTls={setSmtpTls}
        smtpTesting={smtpTesting}
        setSmtpTesting={setSmtpTesting}
        smtpTestResult={smtpTestResult}
        setSmtpTestResult={setSmtpTestResult}
        onManual={() => setManualOpen('smtp')}
      />

      <SlackSection
        lang={lang}
        loadKey={loadKey}
        formVals={formVals}
        setVal={setVal}
        slackEnabled={slackEnabled}
        setSlackEnabled={setSlackEnabled}
        slackLanguage={slackLanguage}
        setSlackLanguage={setSlackLanguage}
        onManual={() => setManualOpen('slack')}
      />

      <ExocadSection
        lang={lang}
        loadKey={loadKey}
        formVals={formVals}
        setVal={setVal}
        onManual={() => setManualOpen('exocad')}
      />

      {/* ─── 주문 연동 (URL 폴링) ──────────────────────────────────────────────── */}
      <PollSourcesSection
        initialSources={formVals.current.poll_sources || []}
        loadKey={loadKey}
        onSourcesChange={(sources: PollSource[]) => { pollSourcesRef.current = sources; }}
        onManual={() => setManualOpen('polling')}
        lang={lang}
      />

      {/* ─── Product Code 그룹 설정 ──────────────────────────────────────────── */}
      <ProductCodeRulesSection
        initialRules={formVals.current.custom_product_code_rules || []}
        loadKey={loadKey}
        onRulesChange={(rules: ProductCodeRule[]) => setVal('custom_product_code_rules', rules)}
        lang={lang}
      />

      <SchedulingSection
        lang={lang}
        loadKey={loadKey}
        setLoadKey={setLoadKey}
        formVals={formVals}
        setVal={setVal}
        mailTemplates={mailTemplates}
        expiryNotice={{
          expiryNoticeEnabled,
          setExpiryNoticeEnabled,
          expiryNoticeRules,
          setExpiryNoticeRules,
          expiryDryRunEmails,
          setExpiryDryRunEmails,
          expiryDryRunResults,
          setExpiryDryRunResults,
          expiryDryRunning,
          setExpiryDryRunning,
        }}
        stopDryRun={{
          stopDryRunDays,
          setStopDryRunDays,
          stopDryRunEmail,
          setStopDryRunEmail,
          stopDryRunResult,
          setStopDryRunResult,
          stopDryRunning,
          setStopDryRunning,
        }}
        lifecycleNotice={{
          stopRequestNoticeEnabled,
          setStopRequestNoticeEnabled,
          cancelCompleteNoticeEnabled,
          setCancelCompleteNoticeEnabled,
          lifecycleDryRunEmails,
          setLifecycleDryRunEmails,
          lifecycleDryRunResults,
          setLifecycleDryRunResults,
          lifecycleDryRunning,
          setLifecycleDryRunning,
        }}
        onManual={() => setManualOpen('other')}
      />
    </div>
  );
}
