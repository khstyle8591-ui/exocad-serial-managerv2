import React, { useState } from 'react';
import { api } from '../../client';
import { t, type Language } from '../../i18n';
import { SectionHeader } from './SettingsShared';
import type { SetSettingValue, SettingsFormRef } from './settingsTypes';

type SlackLanguage = 'ko' | 'en' | 'ja';
type SlackTestResult = {
  success: boolean;
  message: string;
};

type SlackSectionProps = {
  lang: Language;
  loadKey: number;
  formVals: SettingsFormRef;
  setVal: SetSettingValue;
  slackEnabled: boolean;
  setSlackEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  slackLanguage: SlackLanguage;
  setSlackLanguage: React.Dispatch<React.SetStateAction<SlackLanguage>>;
  onManual: () => void;
};

export function SlackSection({
  lang,
  loadKey,
  formVals,
  setVal,
  slackEnabled,
  setSlackEnabled,
  slackLanguage,
  setSlackLanguage,
  onManual,
}: SlackSectionProps) {
  const [testingDefault, setTestingDefault] = useState(false);
  const [testingRelated, setTestingRelated] = useState(false);
  const [defaultResult, setDefaultResult] = useState<SlackTestResult | null>(null);
  const [relatedResult, setRelatedResult] = useState<SlackTestResult | null>(null);

  const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

  const testDefaultWebhook = async () => {
    setTestingDefault(true);
    setDefaultResult(null);
    try {
      const res = await api.testSlack({
        slack_webhook_url: formVals.current.slack_webhook_url,
        slack_language: slackLanguage,
      }) as SlackTestResult;
      setDefaultResult(res);
    } catch (err: unknown) {
      setDefaultResult({ success: false, message: getErrorMessage(err) });
    } finally {
      setTestingDefault(false);
    }
  };

  const testRelatedWebhook = async () => {
    setTestingRelated(true);
    setRelatedResult(null);
    try {
      const res = await api.testSlackRelated({
        slack_webhook_url_related: formVals.current.slack_webhook_url_related,
        slack_language: slackLanguage,
      }) as SlackTestResult;
      setRelatedResult(res);
    } catch (err: unknown) {
      setRelatedResult({ success: false, message: getErrorMessage(err) });
    } finally {
      setTestingRelated(false);
    }
  };

  const resultStyle = (result: SlackTestResult): React.CSSProperties => ({
    marginTop: 8,
    padding: '8px 12px',
    borderRadius: 8,
    fontSize: 13,
    border: `1px solid ${result.success ? '#86efac' : '#fca5a5'}`,
    background: result.success ? '#f0fdf4' : '#fef2f2',
    color: result.success ? '#166534' : '#dc2626',
  });

  return (
    <div className="settings-section">
      <SectionHeader title={t(lang, 'section_slack')} onManual={onManual} />

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
          ] as { value: SlackLanguage; label: string }[]).map(opt => (
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

      <div style={{ marginTop: 12, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <button
            className="btn btn-secondary"
            style={{ background: 'var(--yellow-dim)', color: 'var(--yellow)', border: '1px solid #fde68a' }}
            disabled={testingDefault}
            onClick={testDefaultWebhook}
          >
            {testingDefault ? t(lang, 'slack_test_sending') : t(lang, 'slack_default_test')}
          </button>
          {defaultResult && (
            <div style={resultStyle(defaultResult)}>
              {defaultResult.success ? '✅' : '❌'} {defaultResult.message}
            </div>
          )}
        </div>

        <div>
          <button
            className="btn btn-secondary"
            style={{ background: 'var(--green-dim)', color: 'var(--green)', border: '1px solid #a7f3d0' }}
            disabled={testingRelated}
            onClick={testRelatedWebhook}
          >
            {testingRelated ? t(lang, 'testing') : t(lang, 'slack_related_test')}
          </button>
          {relatedResult && (
            <div style={resultStyle(relatedResult)}>
              {relatedResult.success ? '✅' : '❌'} {relatedResult.message}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
