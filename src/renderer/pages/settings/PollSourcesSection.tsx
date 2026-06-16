import React, { useEffect, useState } from 'react';
import { api } from '../../client';
import { t, type Language } from '../../i18n';
import type { PollDryRunResult, PollDryRunSourceResult, PollSource, PreviewRow } from '../../../shared/types';
import { emptySource, SectionHeader, sectionLabel, tdStyle, thStyle } from './SettingsShared';
import { getErrorMessage, type PollNowResult } from './settingsTypes';

type DryRunState = Record<string, { running: boolean; result: PollDryRunSourceResult | null }>;

// ── 주문 URL 폴링 섹션 ─────────────────────────────────────────────────────
export function PollSourcesSection({ initialSources, loadKey, onSourcesChange, onManual, lang }: {
  initialSources: PollSource[];
  loadKey: number;
  onSourcesChange: (sources: PollSource[]) => void;
  onManual: () => void;
  lang: Language;
}) {
  const [sources, setSources] = useState<PollSource[]>(initialSources);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const [pollMsg, setPollMsg] = useState('');
  const [dryRunState, setDryRunState] = useState<DryRunState>({});
  const [targetDates, setTargetDates] = useState<Record<string, string>>({});

  // Reset when parent reloads settings
  useEffect(() => {
    setSources(initialSources);
  }, [loadKey]);

  const save = (newSources: PollSource[]) => {
    setSources(newSources);
    onSourcesChange(newSources);
  };

  const addSource = () => {
    const s = emptySource() as PollSource;
    save([...sources, s]);
    setExpanded(s.id);
  };

  const removeSource = (id: string) => save(sources.filter(s => s.id !== id));

  const updateSource = <K extends keyof PollSource>(id: string, field: K, value: PollSource[K]) =>
    save(sources.map(s => s.id === id ? { ...s, [field]: value } : s));

  const handlePollNow = async (sourceId?: string, targetDate?: string) => {
    setPolling(true);
    setPollMsg(t(lang, 'polling_now'));
    try {
      const result = await api.pollNow(sourceId, targetDate) as PollNowResult;
      setPollMsg(`${t(lang, 'poll_complete')}${result.found}${t(lang, 'poll_collected')}${result.errors.length > 0 ? `${t(lang, 'poll_error_count')}${result.errors.length}${t(lang, 'poll_error_suffix')}` : ''}`);
      if (result.errors.length > 0) alert(t(lang, 'orders_poll_errors') + result.errors.join('\n'));
    } catch (e: unknown) {
      setPollMsg(`${t(lang, 'orders_poll_error')}${getErrorMessage(e)}`);
    } finally {
      setPolling(false);
    }
  };

  const handlePollDryRun = async (sourceId: string, targetDate?: string) => {
    setDryRunState(prev => ({ ...prev, [sourceId]: { running: true, result: null } }));
    try {
      // \ud604\uc7ac form\uc5d0 \uc785\ub825\ub41c \uac12\uc744 \uc800\uc7a5 \uc804\uc5d0\ub3c4 \ubc18\uc601\ud558\uae30 \uc704\ud574 source \uac1d\uccb4 \uc790\uccb4\ub97c overrides\ub85c \uc804\ub2ec
      const currentSrc = sources.find(s => s.id === sourceId);
      const dryResult = await api.pollDryRun(sourceId, currentSrc || {}, targetDate) as PollDryRunResult;
      // dryResult.sources[0] is the result for this source
      const sourceResult = dryResult.sources && dryResult.sources[0] ? dryResult.sources[0] : null;
      setDryRunState(prev => ({ ...prev, [sourceId]: { running: false, result: sourceResult } }));
    } catch (e: unknown) {
      setDryRunState(prev => ({ ...prev, [sourceId]: { running: false, result: { source_id: sourceId, source_name: '', error: getErrorMessage(e), rows: [], would_insert: 0, already_fetched: 0 } } }));
    }
  };

  return (
    <div className="settings-section">
      <SectionHeader title={t(lang, 'section_polling')} onManual={onManual} />
      <p style={{ color: 'var(--text)', fontSize: 13, marginBottom: 16 }}>
        {t(lang, 'polling_desc')}<strong>{t(lang, 'polling_desc2')}</strong>{t(lang, 'polling_desc3')}
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button
          className="btn btn-primary"
          onClick={() => handlePollNow()}
          disabled={polling || sources.filter(s => s.enabled).length === 0}
        >
          {polling ? t(lang, 'polling_now') : t(lang, 'btn_poll_all')}
        </button>
        {pollMsg && <span style={{ fontSize: 13, color: 'var(--text)' }}>{pollMsg}</span>}
      </div>

      {sources.length === 0 && (
        <div style={{ padding: '20px', textAlign: 'center', background: 'var(--bg3)', borderRadius: 8, color: 'var(--text)', marginBottom: 12 }}>
          {t(lang, 'no_poll_sources')}
        </div>
      )}

      {sources.map(src => (
        <div key={src.id} style={{ border: '1px solid #e5e7eb', borderRadius: 8, marginBottom: 12, overflow: 'hidden' }}>
          <div
            style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', background: 'var(--bg3)', cursor: 'pointer', gap: 10 }}
            onClick={() => setExpanded(expanded === src.id ? null : src.id)}
          >
            <input
              type="checkbox"
              checked={src.enabled}
              onClick={e => e.stopPropagation()}
              onChange={e => updateSource(src.id, 'enabled', e.target.checked)}
            />
            <span style={{ flex: 1, fontWeight: 600, fontSize: 14 }}>{src.name || t(lang, 'polling_default_name')}</span>
            {src.last_polled && (
              <span style={{ fontSize: 11, color: 'var(--text)' }}>{t(lang, 'last_polled')}{src.last_polled.slice(0, 16).replace('T', ' ')}</span>
            )}
            <button
              className="btn btn-sm btn-primary"
              style={{ fontSize: 11, padding: '2px 8px' }}
              onClick={e => { e.stopPropagation(); handlePollNow(src.id); }}
              disabled={polling}
            >{t(lang, 'btn_poll_now')}</button>
            <button
              className="btn btn-sm"
              style={{ fontSize: 11, padding: '2px 8px', background: 'var(--bg3)', color: 'var(--accent)', border: '1px solid #c4b5fd' }}
              onClick={e => { e.stopPropagation(); handlePollDryRun(src.id); }}
              disabled={dryRunState[src.id]?.running}
            >{dryRunState[src.id]?.running ? t(lang, 'poll_dryrun_running') : t(lang, 'btn_poll_dryrun')}</button>
            <button
              className="btn btn-sm"
              style={{ fontSize: 11, padding: '2px 8px', background: 'var(--red-dim)', color: 'var(--red)' }}
              onClick={e => { e.stopPropagation(); if (confirm(t(lang, 'confirm_delete_source'))) removeSource(src.id); }}
            >{t(lang, 'delete')}</button>
            <span>{expanded === src.id ? '▲' : '▼'}</span>
          </div>

          {/* Poll Dry-Run Result Panel */}
          {dryRunState[src.id]?.result !== null && dryRunState[src.id]?.result !== undefined && (() => {
            const dr = dryRunState[src.id].result;
            return (
              <div style={{ borderTop: '1px solid #e5e7eb', background: 'var(--bg3)' }}>
                <div style={{ padding: '8px 14px', background: 'var(--bg3)', fontWeight: 700, fontSize: 12, color: 'var(--accent)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>{t(lang, 'poll_dryrun_result')}</span>
                  {!dr.error && (
                    <span style={{ fontWeight: 400, color: 'var(--accent)', fontSize: 11 }}>
                      {dr.rows.length}{t(lang, 'poll_dryrun_summary')}{dr.would_insert}{t(lang, 'poll_dryrun_summary2')}{dr.already_fetched}{t(lang, 'poll_dryrun_summary3')}{dr.rows.filter((r: PreviewRow) => r.filtered_out).length}{t(lang, 'poll_dryrun_summary4')}
                    </span>
                  )}
                </div>
                {dr.error ? (
                  <div style={{ padding: '10px 14px', color: 'var(--red)', fontSize: 12 }}>⚠ {dr.error}</div>
                ) : dr.rows.length === 0 ? (
                  <div style={{ padding: '10px 14px', color: 'var(--text)', fontSize: 12 }}>{t(lang, 'poll_dryrun_no_rows')}</div>
                ) : (
                  <div style={{ overflowX: 'auto', maxHeight: 260 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                      <thead>
                        <tr style={{ background: 'var(--bg3)', position: 'sticky', top: 0 }}>
                          <th style={thStyle}>Status</th>
                          <th style={thStyle}>{t(lang, 'cancel_dryrun_col_serial')}</th>
                          <th style={thStyle}>{t(lang, 'cancel_dryrun_col_customer')}</th>
                          <th style={thStyle}>{t(lang, 'col_phone')}</th>
                          <th style={thStyle}>{t(lang, 'label_product_col')}</th>
                          <th style={thStyle}>{t(lang, 'label_purchase_col')}</th>
                          <th style={thStyle}>{t(lang, 'label_expiry_col')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dr.rows.map((row: PreviewRow, ri: number) => {
                          const status = row.filtered_out ? 'filtered' : row.already_exists ? 'dup' : 'new';
                          const bg = status === 'new' ? '#f0fdf4' : status === 'dup' ? '#fefce8' : '#f3f4f6';
                          const badge = status === 'new'
                            ? <span style={{ background: 'var(--green-dim)', color: 'var(--green)', borderRadius: 4, padding: '1px 6px', fontWeight: 700 }}>{t(lang, 'poll_dryrun_new')}</span>
                            : status === 'dup'
                              ? <span style={{ background: 'var(--yellow-dim)', color: 'var(--yellow)', borderRadius: 4, padding: '1px 6px', fontWeight: 700 }}>{t(lang, 'poll_dryrun_already')}</span>
                              : <span style={{ background: 'var(--bg4)', color: 'var(--text)', borderRadius: 4, padding: '1px 6px', fontWeight: 700 }}>{t(lang, 'poll_dryrun_filtered')}</span>;
                          return (
                            <tr key={ri} style={{ background: bg, borderBottom: '1px solid #f3f4f6' }}>
                              <td style={tdStyle}>{badge}</td>
                              <td style={tdStyle}><code style={{ fontSize: 10 }}>{row.serial_number}</code></td>
                              <td style={tdStyle}>{row.customer_name}</td>
                              <td style={tdStyle}>{row.phone}</td>
                              <td style={tdStyle}>{row.product}</td>
                              <td style={tdStyle}>{row.purchase_date}</td>
                              <td style={tdStyle}>{row.expiry_date}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })()}

          {expanded === src.id && (
            <div style={{ padding: '14px 16px' }}>
              <div style={sectionLabel}>{t(lang, 'section_basic_info')}</div>
              <div className="form-row">
                <div className="form-group">
                  <label>{t(lang, 'label_source_name')}</label>
                  <input value={src.name} onChange={e => updateSource(src.id, 'name', e.target.value)} placeholder={t(lang, 'poll_source_name_placeholder')} />
                </div>
                <div className="form-group">
                  <label>{t(lang, 'poll_schedule_label')}</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {(src.schedule_times || []).map((time: string, idx: number) => (
                      <div key={idx} style={{ display: 'flex', gap: 6 }}>
                        <input
                          type="time"
                          value={time}
                          onChange={e => {
                            const newTimes = [...(src.schedule_times || [])];
                            newTimes[idx] = e.target.value;
                            updateSource(src.id, 'schedule_times', newTimes);
                          }}
                        />
                        <button
                          className="btn btn-sm"
                          style={{ padding: '0 8px', background: 'var(--red-dim)', color: 'var(--red)' }}
                          onClick={() => {
                            const newTimes = (src.schedule_times || []).filter((_: string, i: number) => i !== idx);
                            updateSource(src.id, 'schedule_times', newTimes);
                          }}
                        >{t(lang, 'delete')}</button>
                      </div>
                    ))}
                    <button
                      className="btn btn-sm btn-secondary"
                      style={{ alignSelf: 'flex-start', fontSize: 11 }}
                      onClick={() => {
                        const newTimes = [...(src.schedule_times || []), '09:00'];
                        updateSource(src.id, 'schedule_times', newTimes);
                      }}
                    >{t(lang, 'btn_add_time')}</button>
                  </div>
                </div>
              </div>
              <div className="form-group">
                <label>{t(lang, 'label_order_url')} <span style={{ color: 'var(--red)' }}>*</span></label>
                <input value={src.url} onChange={e => updateSource(src.id, 'url', e.target.value)} placeholder="https://admin.myshop.com/orders" />
                <small style={{ color: 'var(--text3)', fontSize: 12 }}>{t(lang, 'poll_url_hint')}</small>
              </div>

              <div style={{ ...sectionLabel, marginTop: 14 }}>{t(lang, 'poll_target_date_title')}</div>
              <div className="form-row" style={{ alignItems: 'flex-end' }}>
                <div className="form-group">
                  <label>{t(lang, 'poll_target_date_label')}</label>
                  <input
                    type="date"
                    value={targetDates[src.id] || ''}
                    onChange={e => setTargetDates(prev => ({ ...prev, [src.id]: e.target.value }))}
                  />
                  <small style={{ color: 'var(--text3)', fontSize: 12 }}>{t(lang, 'poll_target_date_hint')}</small>
                </div>
                <div className="form-group">
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button
                      className="btn btn-sm btn-primary"
                      disabled={polling || !targetDates[src.id]}
                      onClick={() => handlePollNow(src.id, targetDates[src.id])}
                    >{t(lang, 'btn_poll_target_date')}</button>
                    <button
                      className="btn btn-sm btn-secondary"
                      disabled={dryRunState[src.id]?.running || !targetDates[src.id]}
                      onClick={() => handlePollDryRun(src.id, targetDates[src.id])}
                    >{dryRunState[src.id]?.running ? t(lang, 'poll_dryrun_running') : t(lang, 'btn_poll_target_date_dryrun')}</button>
                  </div>
                </div>
              </div>

              <div style={{ ...sectionLabel, marginTop: 14 }}>{t(lang, 'section_login_info')}</div>
              <div className="form-group">
                <label>{t(lang, 'label_login_page')}</label>
                <input value={src.login_url} onChange={e => updateSource(src.id, 'login_url', e.target.value)} placeholder={t(lang, 'poll_login_url_placeholder')} />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>{t(lang, 'label_login_id')}</label>
                  <input value={src.login_id} onChange={e => updateSource(src.id, 'login_id', e.target.value)} placeholder="admin@example.com" />
                </div>
                <div className="form-group">
                  <label>{t(lang, 'label_password')}</label>
                  <input type="password" value={src.login_pw} onChange={e => updateSource(src.id, 'login_pw', e.target.value)} />
                </div>
              </div>

              <div style={{ ...sectionLabel, marginTop: 14 }}>{t(lang, 'section_field_mapping')}</div>
              <small style={{ color: 'var(--text3)', fontSize: 12, display: 'block', marginBottom: 10 }}>
                {t(lang, 'field_mapping_note')}
              </small>
              <div className="form-row">
                <div className="form-group">
                  <label>{t(lang, 'label_serial_col')}</label>
                  <input value={src.field_serial} onChange={e => updateSource(src.id, 'field_serial', e.target.value)} placeholder={t(lang, 'poll_serial_placeholder')} />
                </div>
                <div className="form-group">
                  <label>{t(lang, 'label_customer_col')}</label>
                  <input value={src.field_customer} onChange={e => updateSource(src.id, 'field_customer', e.target.value)} placeholder={t(lang, 'poll_customer_placeholder')} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>{t(lang, 'label_phone_col')}</label>
                  <input value={src.field_phone} onChange={e => updateSource(src.id, 'field_phone', e.target.value)} placeholder={t(lang, 'poll_phone_placeholder')} />
                </div>
                <div className="form-group">
                  <label>{t(lang, 'label_product_col')}</label>
                  <input value={src.field_product} onChange={e => updateSource(src.id, 'field_product', e.target.value)} placeholder={t(lang, 'poll_product_placeholder')} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>{t(lang, 'label_purchase_col')}</label>
                  <input value={src.field_purchase} onChange={e => updateSource(src.id, 'field_purchase', e.target.value)} placeholder={t(lang, 'poll_purchase_placeholder')} />
                </div>
                <div className="form-group">
                  <label>{t(lang, 'label_expiry_col')}</label>
                  <input value={src.field_expiry} onChange={e => updateSource(src.id, 'field_expiry', e.target.value)} placeholder={t(lang, 'poll_expiry_placeholder')} />
                </div>
              </div>
              <div className="form-group" style={{ marginTop: 10 }}>
                <label>{t(lang, 'label_product_filter')}</label>
                <input value={src.product_filter || ''} onChange={e => updateSource(src.id, 'product_filter', e.target.value)} placeholder="exocad, DentalCAD, ..." />
                <small style={{ color: 'var(--text3)', fontSize: 12 }}>{t(lang, 'poll_filter_hint')}</small>
              </div>
            </div>
          )}
        </div>
      ))}

      <button className="btn btn-secondary" onClick={addSource}>{t(lang, 'btn_add_source')}</button>
    </div>
  );
}
