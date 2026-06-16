import React from 'react';
import { api } from '../../client';
import { t, type Language } from '../../i18n';
import type { CancelDryRunResult } from '../../../shared/types';
import { checkIcon, SectionHeader, tdStyle, thStyle } from './SettingsShared';
import { getErrorMessage, type SetSettingValue, type SettingsFormRef } from './settingsTypes';

type AutoCancelSectionProps = {
  lang: Language;
  loadKey: number;
  formVals: SettingsFormRef;
  setVal: SetSettingValue;
  autoCancelEnabled: boolean;
  setAutoCancelEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  autoCancelTime: string;
  setAutoCancelTime: React.Dispatch<React.SetStateAction<string>>;
  cancelDryRunning: boolean;
  setCancelDryRunning: React.Dispatch<React.SetStateAction<boolean>>;
  cancelDryResults: CancelDryRunResult[] | null;
  setCancelDryResults: React.Dispatch<React.SetStateAction<CancelDryRunResult[] | null>>;
  onManual: () => void;
};

export function AutoCancelSection({
  lang,
  loadKey,
  formVals,
  setVal,
  autoCancelEnabled,
  setAutoCancelEnabled,
  autoCancelTime,
  setAutoCancelTime,
  cancelDryRunning,
  setCancelDryRunning,
  cancelDryResults,
  setCancelDryResults,
  onManual,
}: AutoCancelSectionProps) {
  const runCancelDryRun = async () => {
    setCancelDryRunning(true);
    setCancelDryResults(null);
    try {
      const results = await api.cancelDryRun() as CancelDryRunResult[];
      setCancelDryResults(results);
    } catch (e: unknown) {
      setCancelDryResults([{ error: getErrorMessage(e) } as CancelDryRunResult]);
    } finally {
      setCancelDryRunning(false);
    }
  };

  return (
    <div className="settings-section">
      <SectionHeader title={t(lang, 'section_auto_cancel')} onManual={onManual} />
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

          <div style={{ marginTop: 8 }}>
            <button
              className="btn btn-secondary"
              style={{ background: 'var(--bg3)', color: 'var(--accent)', border: '1px solid #c4b5fd' }}
              onClick={runCancelDryRun}
              disabled={cancelDryRunning}
            >
              {cancelDryRunning ? t(lang, 'cancel_dryrun_running') : t(lang, 'btn_cancel_dryrun')}
            </button>
          </div>

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
                      {cancelDryResults.map((r, i: number) => {
                        const isSkipped = r.cancel_skipped ?? r.has_renewal;
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
  );
}
