import React, { useEffect, useState } from 'react';
import { useLang, useNav } from '../App';
import { t } from '../i18n';
import { api } from '../client';
import type { ActivityLog, CancelResult, SerialWithCustomer } from '../../shared/types';

interface Stats {
  total: number;
  active: number;
  cancelled: number;
  expired: number;
  notActivated: number;
  expiringThisMonth: number;
}

interface WebhookStatus {
  running: boolean;
  port: number;
}

interface MailCheckResult {
  processed: number;
  saved: number;
  errors: string[];
}

interface SchedulerSummary {
  summary: string;
  updated_at: string;
}

const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

// ── Inline SVG icons ────────────────────────────────────────────────────────────
const AlertIcon = () => (
  <svg width={13} height={13} viewBox="0 0 16 16" fill="none">
    <path d="M8 2L14 13H2L8 2Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
    <path d="M8 7v3M8 11.5v.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
  </svg>
);

const RefreshIcon = () => (
  <svg width={13} height={13} viewBox="0 0 16 16" fill="none">
    <path d="M13.5 8A5.5 5.5 0 118 2.5a5.5 5.5 0 013.89 1.61L13.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    <path d="M10 2.5h3.5V6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

export default function Dashboard() {
  const { lang } = useLang();
  const { setPage } = useNav();

  const [stats, setStats] = useState<Stats>({
    total: 0, active: 0, cancelled: 0, expired: 0, notActivated: 0, expiringThisMonth: 0,
  });
  const [todayLogs, setTodayLogs]       = useState<ActivityLog[]>([]);
  const [webhookStatus, setWebhookStatus] = useState<WebhookStatus>({ running: false, port: 3000 });
  const [expiringSerials, setExpiringSerials] = useState<SerialWithCustomer[]>([]);
  const [schedulerSummary, setSchedulerSummary] = useState<SchedulerSummary>({ summary: '', updated_at: '' });
  const [loading, setLoading]           = useState(true);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const [statsData, logs, whStatus, soon, schedule] = await Promise.all([
        api.getStats(),
        api.getTodayLogs(),
        api.getWebhookStatus(),
        api.getExpiringSoonSerials(60, 50),
        api.getSchedulerSummary(),
      ]);
      setStats(statsData as Stats);
      setTodayLogs(logs as ActivityLog[]);
      setWebhookStatus(whStatus as WebhookStatus);
      setExpiringSerials(soon as SerialWithCustomer[]);
      setSchedulerSummary(schedule as SchedulerSummary);
    } catch (err) {
      console.error('Dashboard load error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCheckEmails = async () => {
    try {
      const result = await api.checkRenewalEmails() as MailCheckResult;
      alert(t(lang, 'dash_renewal_result').replace('{processed}', String(result.processed)).replace('{errors}', String(result.errors.length)));
      loadData();
    } catch (err: unknown) {
      alert(t(lang, 'dash_error').replace('{error}', getErrorMessage(err)));
    }
  };

  const handleProcessExpiring = async () => {
    if (!confirm(t(lang, 'dash_confirm_expiry_cancel'))) return;
    try {
      const results = await api.checkExpiring() as CancelResult[];
      const success = results.filter(r => r.success).length;
      const failed  = results.filter(r => !r.success).length;
      alert(t(lang, 'dash_cancel_result').replace('{success}', String(success)).replace('{failed}', String(failed)));
      loadData();
    } catch (err: unknown) {
      alert(t(lang, 'dash_error').replace('{error}', getErrorMessage(err)));
    }
  };

  const handleSendDailyReport = async () => {
    try {
      await api.sendReport('daily');
      alert(t(lang, 'dash_report_sent'));
    } catch (err: unknown) {
      alert(t(lang, 'dash_error').replace('{error}', getErrorMessage(err)));
    }
  };

  const handleToggleWebhook = async () => {
    try {
      if (webhookStatus.running) await api.stopWebhook();
      else await api.startWebhook();
      const whStatus = await api.getWebhookStatus() as WebhookStatus;
      setWebhookStatus(whStatus);
    } catch (err: unknown) {
      alert(t(lang, 'dash_webhook_error').replace('{error}', getErrorMessage(err)));
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)' }}>
        {t(lang, 'loading')}
      </div>
    );
  }

  const total = stats.total || 1; // avoid division by zero for bar widths

  const statusBreakdown = [
    { key: 'active',        label: t(lang, 'dash_stat_active'),    count: stats.active,          color: 'var(--green)' },
    { key: 'cancelled',     label: t(lang, 'dash_stat_cancelled'),  count: stats.cancelled,       color: 'var(--red)' },
    { key: 'expired',       label: t(lang, 'dash_stat_expired'),    count: stats.expired,         color: 'var(--text3)' },
    { key: 'not-activated', label: t(lang, 'status_not_activated'), count: stats.notActivated,    color: 'var(--yellow)' },
  ];

  return (
    <div className="page-wrapper">
      {/* ── Header ── */}
      <div className="page-header">
        <div>
          <div className="page-title">{t(lang, 'nav_dashboard')}</div>
          <div className="page-subtitle">{t(lang, 'dash_subtitle')}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-secondary btn-sm" onClick={loadData}>
            <RefreshIcon /> {t(lang, 'refresh')}
          </button>
          <button className="btn btn-secondary btn-sm" onClick={handleCheckEmails}>{t(lang, 'dash_btn_mail_check')}</button>
          <button className="btn btn-danger btn-sm"    onClick={handleProcessExpiring}>{t(lang, 'dash_btn_expiry_cancel')}</button>
          <button className="btn btn-ghost btn-sm"     onClick={handleSendDailyReport}>{t(lang, 'dash_btn_send_report')}</button>
        </div>
      </div>

      {schedulerSummary.summary && (
        <div style={{
          background: 'var(--bg2)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: '11px 14px',
          marginBottom: 14,
          color: 'var(--text2)',
          fontSize: 12,
          lineHeight: 1.5,
        }}>
          <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 3 }}>
            {t(lang, 'dash_scheduler_status')}
          </div>
          <div>{schedulerSummary.summary}</div>
          {schedulerSummary.updated_at && (
            <div style={{ color: 'var(--text3)', fontSize: 11, marginTop: 4 }}>
              {t(lang, 'dash_scheduler_updated').replace('{time}', schedulerSummary.updated_at)}
            </div>
          )}
        </div>
      )}

      {/* ── Webhook badge ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '5px 12px', borderRadius: 20, fontSize: 12,
          background: webhookStatus.running ? 'var(--green-dim)' : 'var(--bg4)',
          color: webhookStatus.running ? 'var(--green)' : 'var(--text3)',
          border: `1px solid ${webhookStatus.running ? 'rgba(74,222,128,0.3)' : 'var(--border2)'}`,
        }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%', display: 'inline-block',
            background: webhookStatus.running ? 'var(--green)' : 'var(--text3)',
          }} />
          {t(lang, 'dash_webhook_label')}: {webhookStatus.running
            ? t(lang, 'dash_webhook_running').replace('{port}', String(webhookStatus.port))
            : t(lang, 'dash_webhook_stopped')}
        </div>
        <button
          className={webhookStatus.running ? 'btn btn-secondary btn-sm' : 'btn btn-primary btn-sm'}
          onClick={handleToggleWebhook}
        >
          {webhookStatus.running ? t(lang, 'dash_btn_stop_server') : t(lang, 'dash_btn_start_server')}
        </button>
      </div>

      {/* ── Stat cards ── */}
      <div className="stats-grid">
        <div className="stat-card total" onClick={() => setPage('serial-data', { filter: 'all' })}>
          <div className="label">{t(lang, 'dash_stat_total')}</div>
          <div className="value">{stats.total}</div>
          <div className="sub">{t(lang, 'dash_active_expired_summary').replace('{active}', String(stats.active)).replace('{expired}', String(stats.expired))}</div>
        </div>
        <div className="stat-card green" onClick={() => setPage('serial-data', { filter: 'active' })}>
          <div className="label">{t(lang, 'dash_stat_active')}</div>
          <div className="value">{stats.active}</div>
          <div className="sub">{t(lang, 'dash_sub_active')}</div>
        </div>
        <div className="stat-card red" onClick={() => setPage('serial-data', { filter: 'cancelled' })}>
          <div className="label">{t(lang, 'dash_stat_cancelled')}</div>
          <div className="value">{stats.cancelled}</div>
          <div className="sub">{t(lang, 'dash_sub_cancelled')}</div>
        </div>
        <div className="stat-card gray" onClick={() => setPage('serial-data', { filter: 'expired' })}>
          <div className="label">{t(lang, 'dash_stat_expired')}</div>
          <div className="value">{stats.expired}</div>
          <div className="sub">{t(lang, 'dash_sub_expired')}</div>
        </div>
        <div className="stat-card purple" onClick={() => setPage('serial-data', { filter: 'not-activated' })}>
          <div className="label">{t(lang, 'status_not_activated')}</div>
          <div className="value">{stats.notActivated}</div>
          <div className="sub">{t(lang, 'dash_sub_not_activated')}</div>
        </div>
        <div className="stat-card orange" onClick={() => setPage('serial-data', { filter: 'expiring' })}>
          <div className="label">{t(lang, 'dash_stat_expiring')}</div>
          <div className="value">{stats.expiringThisMonth}</div>
          <div className="sub">{t(lang, 'dash_sub_expiring')}</div>
        </div>
      </div>

      {/* ── Bottom panels ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {/* Status breakdown */}
        <div style={{
          background: 'var(--bg2)', border: '1px solid var(--border)',
          borderRadius: 10, padding: '16px 18px',
        }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text2)', marginBottom: 14 }}>
            {t(lang, 'dash_status_breakdown')}
          </div>
          {statusBreakdown.map(item => {
            const pct = stats.total ? Math.round((item.count / stats.total) * 100) : 0;
            return (
              <div key={item.key} style={{ marginBottom: 11 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                  <span style={{ fontSize: 12, color: 'var(--text)' }}>{item.label}</span>
                  <span style={{ fontSize: 11, color: 'var(--text3)', fontFamily: "'JetBrains Mono', monospace" }}>
                    {item.count}
                  </span>
                </div>
                <div style={{ height: 3, background: 'var(--bg4)', borderRadius: 2 }}>
                  <div style={{
                    width: `${pct}%`, height: '100%',
                    background: item.color, borderRadius: 2,
                    transition: 'width 0.5s ease',
                    minWidth: item.count > 0 ? 4 : 0,
                  }} />
                </div>
              </div>
            );
          })}
        </div>

        {/* Expiring soon */}
        <div style={{
          background: 'var(--bg2)', border: '1px solid var(--border)',
          borderRadius: 10, padding: '16px 18px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14 }}>
            <span style={{ color: 'var(--yellow)' }}><AlertIcon /></span>
            <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text2)' }}>{t(lang, 'dash_expiring_soon')}</span>
            <span style={{
              marginLeft: 'auto', fontSize: 11,
              fontFamily: "'JetBrains Mono', monospace",
              color: 'var(--yellow)',
            }}>{expiringSerials.length}</span>
          </div>
          {expiringSerials.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text3)', padding: '12px 0' }}>{t(lang, 'dash_no_expiring_soon')}</div>
          ) : (
            <div style={{ overflow: 'auto', maxHeight: 200 }}>
              {expiringSerials.map(s => {
                const days = Math.ceil(
                  (new Date(s.expiry_date ?? '').getTime() - Date.now()) / (1000 * 60 * 60 * 24),
                );
                return (
                  <div key={s.id} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '7px 0', borderBottom: '1px solid var(--border)', gap: 8,
                  }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{
                        fontSize: 11.5,
                        fontFamily: "'JetBrains Mono', monospace",
                        color: 'var(--text)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {s.serial_number}
                      </div>
                      <div style={{ fontSize: 10.5, color: 'var(--text3)', marginTop: 2 }}>
                        {s.customer?.name ?? '-'}
                      </div>
                    </div>
                    <div style={{
                      fontSize: 11, flexShrink: 0,
                      fontFamily: "'JetBrains Mono', monospace",
                      color: days <= 30 ? 'var(--red)' : 'var(--yellow)',
                    }}>
                      D-{days}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Today's activity ── */}
      <div style={{
        background: 'var(--bg2)', border: '1px solid var(--border)',
        borderRadius: 10, overflow: 'hidden', marginTop: 12,
      }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text2)' }}>
            {t(lang, 'dash_today_activity')}
          </span>
        </div>
        {todayLogs.length === 0 ? (
          <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text3)', fontSize: 12 }}>
            {t(lang, 'dash_no_activity')}
          </div>
        ) : (
          todayLogs.map(log => (
            <div key={log.id} className="log-entry">
              <span className="time">{log.created_at}</span>
              <span className={`action-badge action-${log.action}`}>{log.action}</span>
              <span style={{ fontSize: 12, color: 'var(--text2)' }}>{log.details}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
