import React from 'react';
import { api } from '../../client';
import { t, type Language } from '../../i18n';
import type { MailConnectionResult } from '../../../shared/types';
import { SectionHeader } from './SettingsShared';
import { getErrorMessage, type SetSettingValue, type SettingsFormRef } from './settingsTypes';

type SmtpSectionProps = {
  lang: Language;
  loadKey: number;
  formVals: SettingsFormRef;
  setVal: SetSettingValue;
  smtpTls: boolean;
  setSmtpTls: React.Dispatch<React.SetStateAction<boolean>>;
  smtpTesting: boolean;
  setSmtpTesting: React.Dispatch<React.SetStateAction<boolean>>;
  smtpTestResult: MailConnectionResult | null;
  setSmtpTestResult: React.Dispatch<React.SetStateAction<MailConnectionResult | null>>;
  onManual: () => void;
};

export function SmtpSection({
  lang,
  loadKey,
  formVals,
  setVal,
  smtpTls,
  setSmtpTls,
  smtpTesting,
  setSmtpTesting,
  smtpTestResult,
  setSmtpTestResult,
  onManual,
}: SmtpSectionProps) {
  const testSmtp = async () => {
    setSmtpTesting(true);
    setSmtpTestResult(null);
    try {
      const f = formVals.current;
      const settingsOverride = {
        smtp_host: f.smtp_host,
        smtp_port: f.smtp_port,
        smtp_user: f.smtp_user,
        smtp_password: f.smtp_password,
        smtp_from_name: f.smtp_from_name,
        smtp_tls: smtpTls,
        report_email_to: f.report_email_to,
      };
      const res = await api.testSmtp(settingsOverride);
      setSmtpTestResult(res);
    } catch (e: unknown) {
      setSmtpTestResult({ success: false, message: getErrorMessage(e) });
    } finally {
      setSmtpTesting(false);
    }
  };

  return (
    <div className="settings-section">
      <SectionHeader title={t(lang, 'section_smtp')} onManual={onManual} />
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
      <div className="form-group">
        <label>{t(lang, 'label_smtp_from_name')}</label>
        <input
          key={`smtpfrom-${loadKey}`}
          defaultValue={formVals.current.smtp_from_name || 'Exocad Manager'}
          onChange={e => setVal('smtp_from_name', e.target.value)}
          placeholder="Exocad Manager"
        />
        <small style={{ color: 'var(--text)', fontSize: 12 }}>{t(lang, 'smtp_from_name_hint')}</small>
      </div>

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

      <div style={{ marginTop: 12 }}>
        <button
          className="btn btn-secondary"
          style={{ background: 'var(--green-dim)', color: 'var(--green)', border: '1px solid #bbf7d0' }}
          disabled={smtpTesting}
          onClick={testSmtp}
        >
          {smtpTesting ? t(lang, 'smtp_test_sending') : t(lang, 'smtp_test_btn')}
        </button>
        {smtpTestResult && (
          <div style={{
            marginTop: 8, padding: '10px 14px', borderRadius: 8, fontSize: 13,
            background: smtpTestResult.success ? '#f0fdf4' : '#fef2f2',
            border: `1px solid ${smtpTestResult.success ? '#86efac' : '#fca5a5'}`,
            color: smtpTestResult.success ? '#166534' : '#dc2626',
            whiteSpace: 'pre-wrap',
            lineHeight: 1.8,
          }}>
            {smtpTestResult.message}
          </div>
        )}
      </div>
    </div>
  );
}
