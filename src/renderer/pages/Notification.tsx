import React, { useEffect, useState } from 'react';
import { useLang } from '../App';
import { t } from '../i18n';

type TestResult = { success: boolean; message: string } | null;

export default function Notification() {
  const { lang } = useLang();
  const [settings, setSettings] = useState<any>(null);
  const [reportTimes, setReportTimes] = useState<string[]>(['10:00']);
  const [slackResult, setSlackResult] = useState<TestResult>(null);
  const [smtpResult, setSmtpResult] = useState<TestResult>(null);
  const [automationResult, setAutomationResult] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => { void load(); }, []);

  const load = async () => {
    const [nextSettings, nextTimes] = await Promise.all([
      window.electronAPI.getSettings(),
      window.electronAPI.listReportTimes(),
    ]);
    setSettings(nextSettings);
    setReportTimes(nextTimes?.length ? nextTimes : ['10:00']);
  };

  const updateTime = (index: number, value: string) => {
    setReportTimes(current => current.map((time, idx) => idx === index ? value : time));
  };

  const addTime = () => setReportTimes(current => [...current, '10:00']);

  const removeTime = (index: number) => {
    setReportTimes(current => current.filter((_, idx) => idx !== index));
  };

  const saveTimes = async () => {
    const cleaned = Array.from(new Set(reportTimes.map(time => time.trim()).filter(Boolean))).sort();
    setBusy('times');
    try {
      await window.electronAPI.setReportTimes(cleaned.length ? cleaned : ['10:00']);
      await load();
      alert(t(lang, 'notification_times_saved'));
    } finally { setBusy(null); }
  };

  const runSlackTest = async () => {
    setBusy('slack'); setSlackResult(null);
    try { setSlackResult(await window.electronAPI.testSlackWebhook()); }
    finally { setBusy(null); }
  };

  const runSmtpTest = async () => {
    setBusy('smtp'); setSmtpResult(null);
    try { setSmtpResult(await window.electronAPI.testSmtp()); }
    finally { setBusy(null); }
  };

  const sendDailyNow = async () => {
    setBusy('daily');
    try {
      await window.electronAPI.sendDailyReportNow();
      alert(t(lang, 'notification_daily_sent'));
    } finally { setBusy(null); }
  };

  const runAutomation = async (mode: 'renew' | 'cancel' | 'limbo') => {
    setBusy(mode); setAutomationResult(null);
    try {
      const result = mode === 'renew'
        ? await window.electronAPI.runAutoRenewNow()
        : mode === 'cancel'
          ? await window.electronAPI.runAutoCancelNow()
          : await window.electronAPI.runLimboFallbackNow();

      if (mode === 'renew') {
        setAutomationResult(
          t(lang, 'notification_renew_result')
            .replace('{renewed}', String(result.renewed))
            .replace('{processed}', String(result.processed))
        );
      } else {
        setAutomationResult(
          t(lang, 'notification_auto_result')
            .replace('{success}', String(result.success))
            .replace('{processed}', String(result.processed))
            .replace('{failed}', String(result.failed))
        );
      }
    } finally { setBusy(null); }
  };

  const exportSettings = async () => {
    setBusy('export');
    try {
      const result = await window.electronAPI.exportSettings();
      if (result.success) alert(`${t(lang, 'notification_exported')}\n${result.filePath || ''}`);
    } finally { setBusy(null); }
  };

  const importSettings = async () => {
    setBusy('import');
    try {
      const result = await window.electronAPI.importSettings();
      if (result.success) { await load(); alert(t(lang, 'notification_imported')); }
    } finally { setBusy(null); }
  };

  return (
    <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 18, minHeight: '100%' }}>
      <div>
        <h2 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>{t(lang, 'notification_title')}</h2>
        <p style={{ margin: 0, color: 'var(--text3)', fontSize: 13 }}>
          {t(lang, 'notification_desc')}
        </p>
      </div>

      <section style={panelStyle}>
        <div style={sectionHeaderStyle}>
          <div>
            <h3 style={sectionTitleStyle}>{t(lang, 'notification_schedule_title')}</h3>
            <p style={sectionDescStyle}>{t(lang, 'notification_schedule_desc')}</p>
          </div>
          <button onClick={saveTimes} disabled={busy === 'times'} style={primaryButtonStyle}>
            {busy === 'times' ? t(lang, 'notification_saving_times') : t(lang, 'notification_save_times')}
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {reportTimes.map((time, index) => (
            <div key={`${time}-${index}`} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="time"
                value={time}
                onChange={event => updateTime(index, event.target.value)}
                style={timeInputStyle}
              />
              <button
                onClick={() => removeTime(index)}
                disabled={reportTimes.length === 1}
                style={ghostButtonStyle}
              >
                {t(lang, 'notification_remove_time')}
              </button>
            </div>
          ))}
        </div>

        <button onClick={addTime} style={{ ...ghostButtonStyle, width: 'fit-content' }}>
          {t(lang, 'notification_add_time')}
        </button>
      </section>

      <section style={panelStyle}>
        <div style={sectionHeaderStyle}>
          <div>
            <h3 style={sectionTitleStyle}>{t(lang, 'notification_channel_title')}</h3>
            <p style={sectionDescStyle}>{t(lang, 'notification_channel_desc')}</p>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(260px, 1fr))', gap: 14 }}>
          <div style={cardStyle}>
            <div style={cardLabelStyle}>{t(lang, 'notification_slack_channel')}</div>
            <div style={monoValueStyle}>{settings?.slack_webhook_url || t(lang, 'notification_not_set')}</div>
            <button onClick={runSlackTest} disabled={busy === 'slack'} style={primaryButtonStyle}>
              {busy === 'slack' ? t(lang, 'notification_testing') : t(lang, 'notification_slack_test')}
            </button>
            {slackResult && <ResultBox result={slackResult} />}
          </div>

          <div style={cardStyle}>
            <div style={cardLabelStyle}>{t(lang, 'notification_smtp_channel')}</div>
            <div style={monoValueStyle}>
              {settings?.smtp_host ? `${settings.smtp_host}:${settings.smtp_port}` : t(lang, 'notification_not_set')}
            </div>
            <button onClick={runSmtpTest} disabled={busy === 'smtp'} style={primaryButtonStyle}>
              {busy === 'smtp' ? t(lang, 'notification_testing') : t(lang, 'notification_smtp_test')}
            </button>
            {smtpResult && <ResultBox result={smtpResult} />}
          </div>
        </div>
      </section>

      <section style={panelStyle}>
        <div style={sectionHeaderStyle}>
          <div>
            <h3 style={sectionTitleStyle}>{t(lang, 'notification_manual_title')}</h3>
            <p style={sectionDescStyle}>{t(lang, 'notification_manual_desc')}</p>
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          <button onClick={sendDailyNow} disabled={busy === 'daily'} style={primaryButtonStyle}>
            {busy === 'daily' ? t(lang, 'notification_sending_daily') : t(lang, 'notification_send_daily')}
          </button>
          <button onClick={exportSettings} disabled={busy === 'export'} style={ghostButtonStyle}>
            {busy === 'export' ? t(lang, 'notification_exporting') : t(lang, 'notification_export')}
          </button>
          <button onClick={importSettings} disabled={busy === 'import'} style={ghostButtonStyle}>
            {busy === 'import' ? t(lang, 'notification_importing') : t(lang, 'notification_import')}
          </button>
        </div>
      </section>

      <section style={panelStyle}>
        <div style={sectionHeaderStyle}>
          <div>
            <h3 style={sectionTitleStyle}>{t(lang, 'notification_automation_title')}</h3>
            <p style={sectionDescStyle}>{t(lang, 'notification_automation_desc')}</p>
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          <button onClick={() => runAutomation('renew')} disabled={busy === 'renew'} style={primaryButtonStyle}>
            {busy === 'renew' ? t(lang, 'notification_running') : t(lang, 'notification_run_renew')}
          </button>
          <button onClick={() => runAutomation('cancel')} disabled={busy === 'cancel'} style={ghostButtonStyle}>
            {busy === 'cancel' ? t(lang, 'notification_running') : t(lang, 'notification_run_cancel')}
          </button>
          <button onClick={() => runAutomation('limbo')} disabled={busy === 'limbo'} style={ghostButtonStyle}>
            {busy === 'limbo' ? t(lang, 'notification_running') : t(lang, 'notification_run_limbo')}
          </button>
        </div>

        {automationResult && (
          <div style={{
            padding: '10px 12px', borderRadius: 8,
            background: 'var(--bg3)', border: '1px solid var(--border)',
            fontSize: 12, color: 'var(--text)',
          }}>
            {automationResult}
          </div>
        )}
      </section>
    </div>
  );
}

function ResultBox({ result }: { result: { success: boolean; message: string } }) {
  return (
    <div style={{
      marginTop: 10, padding: '10px 12px', borderRadius: 8,
      fontSize: 12, whiteSpace: 'pre-wrap',
      background: result.success ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
      border: `1px solid ${result.success ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
      color: result.success ? '#22c55e' : '#fc8181',
    }}>
      {result.message}
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  background: 'var(--bg2)',
  borderRadius: 10,
  border: '1px solid var(--border)',
  padding: 18,
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
};

const sectionHeaderStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 12,
  alignItems: 'center',
};

const sectionTitleStyle: React.CSSProperties = {
  margin: '0 0 4px',
  fontSize: 15,
  fontWeight: 700,
  color: 'var(--text)',
};

const sectionDescStyle: React.CSSProperties = {
  margin: 0,
  color: 'var(--text3)',
  fontSize: 12,
};

const cardStyle: React.CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: 14,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

const cardLabelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: 'var(--text)',
};

const monoValueStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--text3)',
  background: 'var(--bg3)',
  borderRadius: 6,
  padding: '8px 10px',
  fontFamily: 'Consolas, monospace',
};

const primaryButtonStyle: React.CSSProperties = {
  border: 'none',
  borderRadius: 6,
  background: 'var(--accent)',
  color: '#0d1117',
  padding: '8px 14px',
  fontSize: 13,
  cursor: 'pointer',
};

const ghostButtonStyle: React.CSSProperties = {
  border: '1px solid var(--border2)',
  borderRadius: 6,
  background: 'var(--bg3)',
  color: 'var(--text)',
  padding: '8px 14px',
  fontSize: 13,
  cursor: 'pointer',
};

const timeInputStyle: React.CSSProperties = {
  width: 120,
  padding: '8px 10px',
  border: '1px solid var(--border2)',
  borderRadius: 6,
  fontSize: 13,
  background: 'var(--bg3)',
  color: 'var(--text)',
};
