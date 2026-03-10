import React, { useEffect, useState } from 'react';
import { useLang } from '../App';
import { t } from '../i18n';

declare global {
  interface Window {
    electronAPI: any;
  }
}

interface Stats {
  total: number;
  active: number;
  cancelled: number;
  expired: number;
  expiringThisMonth: number;
}

interface WebhookStatus {
  running: boolean;
  port: number;
}

export default function Dashboard() {
  const { lang } = useLang();
  const [stats, setStats] = useState<Stats>({ total: 0, active: 0, cancelled: 0, expired: 0, expiringThisMonth: 0 });
  const [todayLogs, setTodayLogs] = useState<any[]>([]);
  const [webhookStatus, setWebhookStatus] = useState<WebhookStatus>({ running: false, port: 3000 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [statsData, logs, whStatus] = await Promise.all([
        window.electronAPI.getStats(),
        window.electronAPI.getTodayLogs(),
        window.electronAPI.getWebhookStatus(),
      ]);
      setStats(statsData);
      setTodayLogs(logs);
      setWebhookStatus(whStatus);
    } catch (err) {
      console.error('Dashboard load error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCheckEmails = async () => {
    try {
      const result = await window.electronAPI.checkRenewalEmails();
      alert(t(lang, 'dash_renewal_result').replace('{processed}', result.processed).replace('{errors}', result.errors.length));
      loadData();
    } catch (err: any) {
      alert(t(lang, 'dash_error').replace('{error}', err.message));
    }
  };

  const handleProcessExpiring = async () => {
    if (!confirm(t(lang, 'dash_confirm_expiry_cancel'))) return;
    try {
      const results = await window.electronAPI.checkExpiring();
      const success = results.filter((r: any) => r.success).length;
      const failed = results.filter((r: any) => !r.success).length;
      alert(t(lang, 'dash_cancel_result').replace('{success}', success).replace('{failed}', failed));
      loadData();
    } catch (err: any) {
      alert(t(lang, 'dash_error').replace('{error}', err.message));
    }
  };

  const handleSendDailyReport = async () => {
    try {
      await window.electronAPI.sendReport('daily');
      alert(t(lang, 'dash_report_sent'));
    } catch (err: any) {
      alert(t(lang, 'dash_error').replace('{error}', err.message));
    }
  };

  const handleToggleWebhook = async () => {
    try {
      if (webhookStatus.running) {
        await window.electronAPI.stopWebhookServer();
      } else {
        await window.electronAPI.startWebhookServer();
      }
      const whStatus = await window.electronAPI.getWebhookStatus();
      setWebhookStatus(whStatus);
    } catch (err: any) {
      alert(t(lang, 'dash_webhook_error').replace('{error}', err.message));
    }
  };

  if (loading) return <div>{t(lang, 'loading')}</div>;

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" onClick={handleCheckEmails}>{t(lang, 'dash_btn_mail_check')}</button>
          <button className="btn btn-danger" onClick={handleProcessExpiring}>{t(lang, 'dash_btn_expiry_cancel')}</button>
          <button className="btn btn-secondary" onClick={handleSendDailyReport}>{t(lang, 'dash_btn_send_report')}</button>
        </div>
      </div>

      {/* Webhook 서버 상태 배지 */}
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 14px',
          borderRadius: 20,
          fontSize: 13,
          fontWeight: 500,
          background: webhookStatus.running ? '#e6f4ea' : '#f5f5f5',
          color: webhookStatus.running ? '#1e7e34' : '#888',
          border: `1px solid ${webhookStatus.running ? '#a8d5b5' : '#ddd'}`,
        }}>
          <span style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: webhookStatus.running ? '#28a745' : '#ccc',
            display: 'inline-block',
          }} />
          {t(lang, 'dash_webhook_label')}: {webhookStatus.running
            ? t(lang, 'dash_webhook_running').replace('{port}', String(webhookStatus.port))
            : t(lang, 'dash_webhook_stopped')}
        </div>
        <button
          className={webhookStatus.running ? 'btn btn-secondary' : 'btn btn-primary'}
          style={{ fontSize: 12, padding: '4px 12px' }}
          onClick={handleToggleWebhook}
        >
          {webhookStatus.running ? t(lang, 'dash_btn_stop_server') : t(lang, 'dash_btn_start_server')}
        </button>
      </div>

      <div className="stats-grid">
        <div className="stat-card blue">
          <div className="label">{t(lang, 'dash_stat_total')}</div>
          <div className="value">{stats.total}</div>
        </div>
        <div className="stat-card green">
          <div className="label">{t(lang, 'dash_stat_active')}</div>
          <div className="value">{stats.active}</div>
        </div>
        <div className="stat-card red">
          <div className="label">{t(lang, 'dash_stat_cancelled')}</div>
          <div className="value">{stats.cancelled}</div>
        </div>
        <div className="stat-card gray">
          <div className="label">{t(lang, 'dash_stat_expired')}</div>
          <div className="value">{stats.expired}</div>
        </div>
        <div className="stat-card orange">
          <div className="label">{t(lang, 'dash_stat_expiring')}</div>
          <div className="value">{stats.expiringThisMonth}</div>
        </div>
      </div>

      <div className="table-container">
        <div style={{ padding: '16px', borderBottom: '1px solid #eee' }}>
          <h3 style={{ fontSize: 16 }}>{t(lang, 'dash_today_activity')}</h3>
        </div>
        {todayLogs.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>{t(lang, 'dash_no_activity')}</div>
        ) : (
          todayLogs.map((log: any) => (
            <div key={log.id} className="log-entry">
              <span className="time">{log.created_at}</span>
              <span className={`action-badge action-${log.action}`}>{log.action}</span>
              <span>{log.details}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
