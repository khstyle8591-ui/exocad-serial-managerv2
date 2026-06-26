import React, { useEffect, useState } from 'react';
import { useLang } from '../App';
import { t, actionLabel } from '../i18n';
import { api } from '../client';
import type { ActivityLog } from '../../shared/types';

export default function Logs() {
  const { lang } = useLang();
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadLogs(); }, []);

  const loadLogs = async () => {
    try {
      const data = await api.getLogs(200, 0) as ActivityLog[];

      setLogs(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div>{t(lang, 'loading')}</div>;

  return (
    <div className="page-wrapper">
      <div className="page-header">
        <h1 className="page-title">{t(lang, 'nav_logs')}</h1>
        <button className="btn btn-secondary" onClick={loadLogs}>{t(lang, 'logs_btn_refresh')}</button>
      </div>

      <div className="table-container">
        {logs.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)' }}>{t(lang, 'logs_empty')}</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t(lang, 'logs_col_time')}</th>
                <th>{t(lang, 'logs_col_action')}</th>
                <th>{t(lang, 'logs_col_detail')}</th>
              </tr>
            </thead>
            <tbody>
              {logs.map(log => (
                <tr key={log.id}>
                  <td style={{ whiteSpace: 'nowrap', color: 'var(--text3)', fontSize: 12, fontFamily: "'JetBrains Mono', monospace" }}>{log.created_at}</td>
                  <td>
                    <span className={`action-badge action-${log.action}`}>
                      {actionLabel(lang, log.action)}
                    </span>
                  </td>
                  <td>{log.details}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
