import React, { useEffect, useState } from 'react';
import { useLang } from '../App';
import { t } from '../i18n';
import { api } from '../api';

export default function Logs() {
  const { lang } = useLang();
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadLogs(); }, []);

  const loadLogs = async () => {
    try {
      const data = await api.getLogs(200, 0) as any[];

      setLogs(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // 액션 라벨을 i18n으로 반환
  const actionLabel = (action: string): string => {
    const keyMap: Record<string, string> = {
      registered: 'log_action_registered',
      renewed: 'log_action_renewed',
      cancelled: 'log_action_cancelled',
      addon_added: 'log_action_addon_added',
      bulk_imported: 'log_action_bulk_imported',
    };
    const key = keyMap[action];
    return key ? t(lang, key as any) : action;
  };

  if (loading) return <div>{t(lang, 'loading')}</div>;

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">{t(lang, 'nav_logs')}</h1>
        <button className="btn btn-secondary" onClick={loadLogs}>{t(lang, 'logs_btn_refresh')}</button>
      </div>

      <div className="table-container">
        {logs.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>{t(lang, 'logs_empty')}</div>
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
                  <td style={{ whiteSpace: 'nowrap', color: '#888', fontSize: 13 }}>{log.created_at}</td>
                  <td>
                    <span className={`action-badge action-${log.action}`}>
                      {actionLabel(log.action)}
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
