import React from 'react';
import { api } from '../../client';
import { t, type Language } from '../../i18n';
import type { ExpiryNoticeRule, MailTemplate } from '../../../shared/types';
import { genId, SectionHeader } from './SettingsShared';
import { getErrorMessage, type DryRunActionResult, type SetSettingValue, type SettingsFormRef } from './settingsTypes';

type LifecycleKey = 'stop_request' | 'cancel_complete';

type ExpiryNoticeState = {
  expiryNoticeEnabled: boolean;
  setExpiryNoticeEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  expiryNoticeRules: ExpiryNoticeRule[];
  setExpiryNoticeRules: React.Dispatch<React.SetStateAction<ExpiryNoticeRule[]>>;
  expiryDryRunEmails: Record<string, string>;
  setExpiryDryRunEmails: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  expiryDryRunResults: Record<string, string>;
  setExpiryDryRunResults: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  expiryDryRunning: Record<string, boolean>;
  setExpiryDryRunning: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
};

type StopDryRunState = {
  stopDryRunDays: number;
  setStopDryRunDays: React.Dispatch<React.SetStateAction<number>>;
  stopDryRunEmail: string;
  setStopDryRunEmail: React.Dispatch<React.SetStateAction<string>>;
  stopDryRunResult: string | null;
  setStopDryRunResult: React.Dispatch<React.SetStateAction<string | null>>;
  stopDryRunning: boolean;
  setStopDryRunning: React.Dispatch<React.SetStateAction<boolean>>;
};

type LifecycleNoticeState = {
  stopRequestNoticeEnabled: boolean;
  setStopRequestNoticeEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  cancelCompleteNoticeEnabled: boolean;
  setCancelCompleteNoticeEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  lifecycleDryRunEmails: Record<string, string>;
  setLifecycleDryRunEmails: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  lifecycleDryRunResults: Record<string, string>;
  setLifecycleDryRunResults: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  lifecycleDryRunning: Record<string, boolean>;
  setLifecycleDryRunning: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
};

type SchedulingSectionProps = {
  lang: Language;
  loadKey: number;
  setLoadKey: React.Dispatch<React.SetStateAction<number>>;
  formVals: SettingsFormRef;
  setVal: SetSettingValue;
  mailTemplates: MailTemplate[];
  expiryNotice: ExpiryNoticeState;
  stopDryRun: StopDryRunState;
  lifecycleNotice: LifecycleNoticeState;
  onManual: () => void;
};

export function SchedulingSection({
  lang,
  loadKey,
  setLoadKey,
  formVals,
  setVal,
  mailTemplates,
  expiryNotice,
  stopDryRun,
  lifecycleNotice,
  onManual,
}: SchedulingSectionProps) {
  const {
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
  } = expiryNotice;
  const {
  stopDryRunDays,
  setStopDryRunDays,
  stopDryRunEmail,
  setStopDryRunEmail,
  stopDryRunResult,
  setStopDryRunResult,
  stopDryRunning,
  setStopDryRunning,
  } = stopDryRun;
  const {
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
  } = lifecycleNotice;
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
      }) as DryRunActionResult;
      setExpiryDryRunResults(current => ({
        ...current,
        [rule.id]: `${result.success ? 'OK' : 'FAIL'} - ${result.message}${result.sample_serial ? ` (${result.sample_serial})` : ''}`,
      }));
    } catch (err: unknown) {
      setExpiryDryRunResults(current => ({ ...current, [rule.id]: `FAIL - ${getErrorMessage(err)}` }));
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
      }) as DryRunActionResult;
      setStopDryRunResult(`${result.success ? 'OK' : 'FAIL'} - ${result.message}${result.sample_serial ? ` (${result.sample_serial})` : ''}`);
    } catch (err: unknown) {
      setStopDryRunResult(`FAIL - ${getErrorMessage(err)}`);
    } finally {
      setStopDryRunning(false);
    }
  };

  const runLifecycleDryRun = async (key: LifecycleKey, templateCode: string) => {
    const testEmail = (lifecycleDryRunEmails[key] || '').trim();
    setLifecycleDryRunning(current => ({ ...current, [key]: true }));
    setLifecycleDryRunResults(current => ({ ...current, [key]: '' }));
    try {
      const result = await api.runStopLifecycleNoticeDryRun({
        kind: key,
        template_code: templateCode,
        test_email: testEmail,
      }) as DryRunActionResult;
      setLifecycleDryRunResults(current => ({
        ...current,
        [key]: `${result.success ? 'OK' : 'FAIL'} - ${result.message}${result.sample_serial ? ` (${result.sample_serial})` : ''}`,
      }));
    } catch (err: unknown) {
      setLifecycleDryRunResults(current => ({ ...current, [key]: `FAIL - ${getErrorMessage(err)}` }));
    } finally {
      setLifecycleDryRunning(current => ({ ...current, [key]: false }));
    }
  };

  return (
    <div className="settings-section">
      <SectionHeader title={t(lang, 'section_scheduling')} onManual={onManual} />
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
                  const newTimes = (formVals.current.mail_check_times || []).filter((_: string, i: number) => i !== idx);
                  setVal('mail_check_times', newTimes);
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
  );
}
