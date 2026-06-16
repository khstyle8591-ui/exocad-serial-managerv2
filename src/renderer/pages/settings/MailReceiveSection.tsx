import React from 'react';
import { api } from '../../client';
import { t, type Language } from '../../i18n';
import type { MailConnectionResult, MailTemplate } from '../../../shared/types';
import { KeywordCardEditor } from './KeywordCardEditor';
import { SectionHeader, tdStyle, thStyle } from './SettingsShared';
import { getErrorMessage, type SetSettingValue, type SettingsFormRef, type SettingsRenewalDryRunEmail, type SettingsRenewalDryRunResult } from './settingsTypes';

type MailProtocol = 'pop3' | 'imap';

type MailConnectionState = {
  protocol: MailProtocol;
  setProtocol: React.Dispatch<React.SetStateAction<MailProtocol>>;
  pop3Tls: boolean;
  setPop3Tls: React.Dispatch<React.SetStateAction<boolean>>;
  pop3KeepCopy: boolean;
  setPop3KeepCopy: React.Dispatch<React.SetStateAction<boolean>>;
  imapTls: boolean;
  setImapTls: React.Dispatch<React.SetStateAction<boolean>>;
  imapMarkSeen: boolean;
  setImapMarkSeen: React.Dispatch<React.SetStateAction<boolean>>;
  connTesting: boolean;
  setConnTesting: React.Dispatch<React.SetStateAction<boolean>>;
  connTestResult: MailConnectionResult | null;
  setConnTestResult: React.Dispatch<React.SetStateAction<MailConnectionResult | null>>;
};

type RenewalKeywordState = {
  mailTemplates: MailTemplate[];
  productKeywords: string[];
  setProductKeywords: React.Dispatch<React.SetStateAction<string[]>>;
  actionKeywords: string[];
  setActionKeywords: React.Dispatch<React.SetStateAction<string[]>>;
  excludeKeywords: string[];
  setExcludeKeywords: React.Dispatch<React.SetStateAction<string[]>>;
  keywordInputs: Record<string, string>;
  setKeywordInputs: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  missingInfoAutoReply: boolean;
  setMissingInfoAutoReply: React.Dispatch<React.SetStateAction<boolean>>;
  invalidResponseAutoReply: boolean;
  setInvalidResponseAutoReply: React.Dispatch<React.SetStateAction<boolean>>;
  requireSerial: boolean;
  setRequireSerial: React.Dispatch<React.SetStateAction<boolean>>;
};

type RenewalDryRunState = {
  renewalDryRunning: boolean;
  setRenewalDryRunning: React.Dispatch<React.SetStateAction<boolean>>;
  renewalDryRunResult: SettingsRenewalDryRunResult | null;
  setRenewalDryRunResult: React.Dispatch<React.SetStateAction<SettingsRenewalDryRunResult | null>>;
};

type MailReceiveSectionProps = {
  lang: Language;
  loadKey: number;
  formVals: SettingsFormRef;
  setVal: SetSettingValue;
  connection: MailConnectionState;
  renewalKeywords: RenewalKeywordState;
  renewalDryRun: RenewalDryRunState;
  onManual: () => void;
};

export function MailReceiveSection({
  lang,
  loadKey,
  formVals,
  setVal,
  connection,
  renewalKeywords,
  renewalDryRun,
  onManual,
}: MailReceiveSectionProps) {
  const {
    protocol,
    setProtocol,
    pop3Tls,
    setPop3Tls,
    pop3KeepCopy,
    setPop3KeepCopy,
    imapTls,
    setImapTls,
    imapMarkSeen,
    setImapMarkSeen,
    connTesting,
    setConnTesting,
    connTestResult,
    setConnTestResult,
  } = connection;
  const {
    mailTemplates,
    productKeywords,
    setProductKeywords,
    actionKeywords,
    setActionKeywords,
    excludeKeywords,
    setExcludeKeywords,
    keywordInputs,
    setKeywordInputs,
    missingInfoAutoReply,
    setMissingInfoAutoReply,
    invalidResponseAutoReply,
    setInvalidResponseAutoReply,
    requireSerial,
    setRequireSerial,
  } = renewalKeywords;
  const {
    renewalDryRunning,
    setRenewalDryRunning,
    renewalDryRunResult,
    setRenewalDryRunResult,
  } = renewalDryRun;
  const setKeywordInput = (key: string, value: string) => {
    setKeywordInputs(current => ({ ...current, [key]: value }));
  };

  const addKeyword = (key: string, list: string[], setter: React.Dispatch<React.SetStateAction<string[]>>) => {
    const value = (keywordInputs[key] || '').trim();
    if (!value) return;
    setter(current => current.some(item => item.toLowerCase() === value.toLowerCase()) ? current : [...current, value]);
    setKeywordInput(key, '');
  };

  const removeKeyword = (value: string, setter: React.Dispatch<React.SetStateAction<string[]>>) => {
    setter(current => current.filter(item => item !== value));
  };

  return (
    <>
      {/* ─── 메일 수신 설정 ─────────────────────────────────────────────────── */}
      <div className="settings-section">
        <SectionHeader title={t(lang, 'section_mail_recv')} onManual={onManual} />

        <div className="form-group">
          <label>{t(lang, 'label_mail_protocol')}</label>
          <div style={{ display: 'flex', gap: 24, marginTop: 6 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input type="radio" name="mail_protocol" value="pop3" checked={protocol === 'pop3'} onChange={() => setProtocol('pop3')} />
              POP3
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input type="radio" name="mail_protocol" value="imap" checked={protocol === 'imap'} onChange={() => setProtocol('imap')} />
              IMAP
            </label>
          </div>
          <div className="form-row" style={{ alignItems: 'flex-start', marginBottom: 16 }}>
            <div className="form-group" style={{ flex: 1 }}>
              <label style={{ fontWeight: 600 }}>{t(lang, 'invalid_response_template_label')}</label>
              <select
                key={`invalid-response-template-${loadKey}`}
                defaultValue={formVals.current.invalid_response_template || 'invalid_cancellation_response'}
                onChange={e => setVal('invalid_response_template', e.target.value)}
              >
                {mailTemplates.map(template => (
                  <option key={template.code} value={template.code}>{template.name} ({template.code})</option>
                ))}
              </select>
              <label className="checkbox-row" style={{ marginTop: 8 }}>
                <input type="checkbox" checked={invalidResponseAutoReply} onChange={e => setInvalidResponseAutoReply(e.target.checked)} />
                {t(lang, 'invalid_response_auto_reply_label')}
              </label>
              <small style={{ color: 'var(--text)', fontSize: 12 }}>{t(lang, 'invalid_response_auto_reply_hint')}</small>
            </div>
          </div>
        </div>

        {protocol === 'pop3' && (
          <>
            <div className="form-row">
              <div className="form-group">
                <label>{t(lang, 'label_host')} (POP3)</label>
                <input key={`pop3h-${loadKey}`} defaultValue={formVals.current.pop3_host || ''} onChange={e => setVal('pop3_host', e.target.value)} placeholder="mail.example.com" />
              </div>
              <div className="form-group">
                <label>{t(lang, 'label_port')}</label>
                <input key={`pop3p-${loadKey}`} type="number" defaultValue={formVals.current.pop3_port || 995} onChange={e => setVal('pop3_port', Number(e.target.value))} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>{t(lang, 'label_username')}</label>
                <input key={`pop3u-${loadKey}`} defaultValue={formVals.current.pop3_user || ''} onChange={e => setVal('pop3_user', e.target.value)} placeholder="user@example.com" />
              </div>
              <div className="form-group">
                <label>{t(lang, 'label_password')}</label>
                <input key={`pop3pw-${loadKey}`} type="password" defaultValue={formVals.current.pop3_password || ''} onChange={e => setVal('pop3_password', e.target.value)} />
              </div>
            </div>
            <div className="form-group" style={{ display: 'flex', gap: 24, marginBottom: 8 }}>
              <label className="checkbox-row">
                <input type="checkbox" checked={pop3Tls} onChange={e => setPop3Tls(e.target.checked)} />
                {t(lang, 'label_tls')}
              </label>
              <label className="checkbox-row">
                <input type="checkbox" checked={pop3KeepCopy} onChange={e => setPop3KeepCopy(e.target.checked)} />
                {t(lang, 'label_pop3_keep_copy')}
              </label>
            </div>
          </>
        )}

        {protocol === 'imap' && (
          <>
            <div className="form-row">
              <div className="form-group">
                <label>{t(lang, 'label_host')} (IMAP)</label>
                <input key={`imaph-${loadKey}`} defaultValue={formVals.current.imap_host || ''} onChange={e => setVal('imap_host', e.target.value)} placeholder="imap.example.com" />
              </div>
              <div className="form-group">
                <label>{t(lang, 'label_port')}</label>
                <input key={`imapp-${loadKey}`} type="number" defaultValue={formVals.current.imap_port || 993} onChange={e => setVal('imap_port', Number(e.target.value))} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>{t(lang, 'label_username')}</label>
                <input key={`imapu-${loadKey}`} defaultValue={formVals.current.imap_user || ''} onChange={e => setVal('imap_user', e.target.value)} placeholder="user@example.com" />
              </div>
              <div className="form-group">
                <label>{t(lang, 'label_password')}</label>
                <input key={`imappw-${loadKey}`} type="password" defaultValue={formVals.current.imap_password || ''} onChange={e => setVal('imap_password', e.target.value)} />
              </div>
            </div>
            <div className="form-group" style={{ display: 'flex', gap: 24, marginBottom: 8 }}>
              <label className="checkbox-row">
                <input type="checkbox" checked={imapTls} onChange={e => setImapTls(e.target.checked)} />
                {t(lang, 'label_tls')}
              </label>
              <label className="checkbox-row">
                <input type="checkbox" checked={imapMarkSeen} onChange={e => setImapMarkSeen(e.target.checked)} />
                {t(lang, 'label_imap_mark_seen')}
              </label>
            </div>
            <small style={{ color: 'var(--text3)', fontSize: 12 }}>{t(lang, 'imap_note')}</small>
          </>
        )}

        {/* ── 앱 전용 이메일 주소 (Forward 감지) ── */}
        <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px dashed #e5e7eb' }}>
          <div className="form-group">
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              📮 {t(lang, 'label_dedicated_email')}
            </label>
            <input
              key={`dmail-${loadKey}`}
              type="email"
              defaultValue={formVals.current.dedicated_email || ''}
              onChange={e => setVal('dedicated_email', e.target.value)}
              placeholder="renewal@yourcompany.com"
              style={{ fontFamily: 'monospace' }}
            />
            <div style={{ marginTop: 6, padding: '10px 12px', background: 'var(--bg3)', borderRadius: 8, border: '1px solid #bae6fd' }}>
              <small style={{ color: 'var(--text)', fontSize: 12, lineHeight: 1.6, display: 'block' }}>
                💡 {t(lang, 'dedicated_email_note')}
              </small>
              <small style={{ color: 'var(--text)', fontSize: 11.5, lineHeight: 1.6, display: 'block', marginTop: 4 }}>
                {t(lang, 'dedicated_email_how')}
              </small>
              <small style={{ color: 'var(--text)', fontSize: 11, display: 'block', marginTop: 6 }}>
                {t(lang, 'detect_headers')}{' '}
                <code style={{ background: 'var(--bg4)', padding: '1px 4px', borderRadius: 3 }}>Delivered-To</code>{' '}
                <code style={{ background: 'var(--bg4)', padding: '1px 4px', borderRadius: 3 }}>X-Forwarded-To</code>{' '}
                <code style={{ background: 'var(--bg4)', padding: '1px 4px', borderRadius: 3 }}>X-Original-To</code>{' '}
                <code style={{ background: 'var(--bg4)', padding: '1px 4px', borderRadius: 3 }}>To</code>{' '}
                <code style={{ background: 'var(--bg4)', padding: '1px 4px', borderRadius: 3 }}>Cc</code>{' '}
                <code style={{ background: 'var(--bg4)', padding: '1px 4px', borderRadius: 3 }}>Resent-To</code>
              </small>
            </div>
          </div>
        </div>

        {/* ── 갱신 & 제품 조건 설정 (다중 조건) ── */}
        <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px dashed #e5e7eb' }}>
          <KeywordCardEditor
            inputKey="product"
            label={t(lang, 'renewal_product_keywords_label')}
            hint={t(lang, 'renewal_product_keywords_hint')}
            placeholder="exocad"
            values={productKeywords}
            onChange={setProductKeywords}
            inputValue={keywordInputs.product || ''}
            onInputChange={setKeywordInput}
            onAdd={addKeyword}
            onRemove={removeKeyword}
            lang={lang}
          />
          <KeywordCardEditor
            inputKey="action"
            label={t(lang, 'renewal_action_keywords_label')}
            hint={t(lang, 'renewal_action_keywords_hint')}
            placeholder={t(lang, 'renewal_action_keywords_placeholder')}
            values={actionKeywords}
            onChange={setActionKeywords}
            inputValue={keywordInputs.action || ''}
            onInputChange={setKeywordInput}
            onAdd={addKeyword}
            onRemove={removeKeyword}
            lang={lang}
          />
          <div style={{ borderLeft: '3px solid #fca5a5', background: 'var(--red-dim)', borderRadius: 4, padding: '10px 12px', marginBottom: 16 }}>
            <KeywordCardEditor
              inputKey="exclude"
              label={t(lang, 'renewal_exclude_keywords_label')}
              hint={t(lang, 'renewal_exclude_keywords_hint')}
              placeholder={t(lang, 'renewal_exclude_keywords_placeholder')}
              values={excludeKeywords}
              onChange={setExcludeKeywords}
              inputValue={keywordInputs.exclude || ''}
              onInputChange={setKeywordInput}
              onAdd={addKeyword}
              onRemove={removeKeyword}
              lang={lang}
              danger
            />
          </div>
          <div className="form-row" style={{ alignItems: 'flex-start', marginBottom: 16 }}>
            <div className="form-group" style={{ flex: 1 }}>
              <label style={{ fontWeight: 600 }}>{t(lang, 'mail_serial_pattern_label')}</label>
              <input
                key={`serial-pattern-${loadKey}`}
                defaultValue={formVals.current.mail_serial_pattern || 'XXXXXXXX-XXXX-XXXXXXXX'}
                onChange={e => setVal('mail_serial_pattern', e.target.value)}
                placeholder="XXXXXXXX-XXXX-XXXXXXXX"
                style={{ fontFamily: 'monospace' }}
              />
              <small style={{ color: 'var(--text)', fontSize: 12 }}>{t(lang, 'mail_serial_pattern_hint')}</small>
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label style={{ fontWeight: 600 }}>{t(lang, 'missing_info_template_label')}</label>
              <select
                key={`missing-template-${loadKey}`}
                defaultValue={formVals.current.missing_info_template || 'missing_info_request'}
                onChange={e => setVal('missing_info_template', e.target.value)}
              >
                {mailTemplates.map(template => (
                  <option key={template.code} value={template.code}>{template.name} ({template.code})</option>
                ))}
              </select>
              <label className="checkbox-row" style={{ marginTop: 8 }}>
                <input
                  type="checkbox"
                  checked={missingInfoAutoReply}
                  onChange={e => setMissingInfoAutoReply(e.target.checked)}
                />
                {t(lang, 'missing_info_auto_reply_label')}
              </label>
              <small style={{ color: 'var(--text)', fontSize: 12 }}>{t(lang, 'missing_info_auto_reply_hint')}</small>
            </div>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="checkbox-row" style={{ fontWeight: 600 }}>
              <input
                type="checkbox"
                checked={requireSerial}
                onChange={e => setRequireSerial(e.target.checked)}
              />
              {t(lang, 'require_serial_label')}
            </label>
            <small style={{ color: 'var(--text)', fontSize: 12, marginLeft: 22, display: 'block', marginTop: 4 }}>{t(lang, 'require_serial_hint')}</small>
          </div>
        </div>

        {/* ── 연결 테스트 + Renewal Dry-Run ── */}
        <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px dashed #e5e7eb', display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {/* Connection Test */}
          <div>
            <button
              className="btn btn-secondary"
              style={{ background: 'var(--bg3)', color: 'var(--text)', border: '1px solid #bae6fd' }}
              disabled={connTesting}
              onClick={async () => {
                setConnTesting(true);
                setConnTestResult(null);
                try {
                  // 저장 전 form 값을 직접 전달 — formVals.current에서 현재 입력값 추출
                  const f = formVals.current;
                  const settingsOverride = {
                    mail_protocol: protocol,  // radio state
                    pop3_host: f.pop3_host, pop3_port: f.pop3_port,
                    pop3_user: f.pop3_user, pop3_password: f.pop3_password,
                    pop3_tls: pop3Tls,
                    pop3_keep_copy: pop3KeepCopy,
                    imap_host: f.imap_host, imap_port: f.imap_port,
                    imap_user: f.imap_user, imap_password: f.imap_password,
                    imap_tls: imapTls,
                    imap_mark_seen_after_check: imapMarkSeen,
                  };
                  const res = await api.testMailConnection(settingsOverride);
                  setConnTestResult(res);
                } catch (e: unknown) {
                  setConnTestResult({ success: false, message: getErrorMessage(e) });
                } finally {
                  setConnTesting(false);
                }
              }}
            >
              {connTesting ? t(lang, 'conn_testing') : t(lang, 'conn_test_btn')}
            </button>
            {connTestResult && (
              <div style={{
                marginTop: 8, padding: '8px 12px', borderRadius: 8, fontSize: 13,
                background: connTestResult.success ? '#f0fdf4' : '#fef2f2',
                border: `1px solid ${connTestResult.success ? '#86efac' : '#fca5a5'}`,
                color: connTestResult.success ? '#166534' : '#dc2626',
              }}>
                {connTestResult.success ? '✅' : '❌'} {connTestResult.message}
                {connTestResult.mail_count !== undefined && (
                  <span style={{ marginLeft: 8, color: 'var(--text)', fontSize: 12 }}>{t(lang, 'conn_mail_count').replace('{n}', String(connTestResult.mail_count))}</span>
                )}
              </div>
            )}
          </div>

          {/* Renewal Dry-Run */}
          <div style={{ flex: 1, minWidth: 200 }}>
            <button
              className="btn btn-secondary"
              style={{ background: 'var(--bg3)', color: 'var(--accent)', border: '1px solid #d8b4fe' }}
              disabled={renewalDryRunning}
              onClick={async () => {
                setRenewalDryRunning(true);
                setRenewalDryRunResult(null);
                try {
                  const res = await api.renewalDryRun();
                  setRenewalDryRunResult(res);
                } catch (e: unknown) {
                  setRenewalDryRunResult({ total_checked: 0, matched: 0, emails: [], error: getErrorMessage(e) });
                } finally {
                  setRenewalDryRunning(false);
                }
              }}
            >
              {renewalDryRunning ? t(lang, 'renewal_dryrun_running') : t(lang, 'renewal_dryrun_label')}
            </button>
            <small style={{ display: 'block', marginTop: 4, color: 'var(--text)', fontSize: 11.5 }}>
              {t(lang, 'renewal_dryrun_note')}
            </small>
          </div>
        </div>

        {/* Renewal Dry-Run 결과 */}
        {renewalDryRunResult !== null && (
          <div style={{ marginTop: 14, border: '1px solid #d8b4fe', borderRadius: 8, overflow: 'hidden' }}>
            {(() => {
              const dryEntries = renewalDryRunResult.emails || renewalDryRunResult.entries || [];
              const detected = renewalDryRunResult.matched ?? dryEntries.length;
              return (
                <>
            <div style={{ padding: '8px 14px', background: 'var(--bg3)', fontWeight: 700, fontSize: 13, color: 'var(--accent)', display: 'flex', gap: 12, alignItems: 'center' }}>
              <span>{t(lang, 'renewal_dryrun_result_title')}</span>
              <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--text)' }}>({t(lang, 'renewal_dryrun_checked').replace('{n}', String(renewalDryRunResult.total_checked))} / {t(lang, 'renewal_dryrun_detected').replace('{n}', String(detected))})</span>
              {renewalDryRunResult.error && <span style={{ color: 'var(--red)', fontSize: 12 }}>❌ {renewalDryRunResult.error}</span>}
            </div>
            {dryEntries.length === 0 ? (
              <div style={{ padding: '14px', color: 'var(--text)', fontSize: 13 }}>{t(lang, 'renewal_dryrun_empty')}</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: 'var(--bg3)', borderBottom: '1px solid #e5e7eb' }}>
                      <th style={thStyle}>From</th>
                      <th style={thStyle}>Subject</th>
                      <th style={thStyle}>Date</th>
                      <th style={thStyle}>{t(lang, 'renewal_dryrun_col_type')}</th>
                      <th style={thStyle}>{t(lang, 'renewal_dryrun_col_keyword')}</th>
                      <th style={thStyle}>Dedicated</th>
                      <th style={thStyle}>{t(lang, 'renewal_dryrun_col_serial')}</th>
                      <th style={thStyle}>{t(lang, 'renewal_dryrun_col_db')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dryEntries.map((em: SettingsRenewalDryRunEmail, i: number) => (
                      <tr key={i} style={{ borderBottom: '1px solid #f3f4f6', background: em.serial_exists ? 'var(--green-dim)' : 'var(--yellow-dim)' }}>
                        <td style={{ ...tdStyle, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{em.from}</td>
                        <td style={{ ...tdStyle, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{em.subject}</td>
                        <td style={{ ...tdStyle, whiteSpace: 'nowrap', fontSize: 11 }}>{em.date ? new Date(em.date).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'}</td>
                        <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 600, fontSize: 11 }}>
                          {em.classification === 'stop_request_candidate' ? <span style={{ color: 'var(--red)' }}>{t(lang, 'mail_classif_stop_candidate')}</span> :
                            em.is_renewal || em.classification === 'renewal_request' ? <span style={{ color: 'var(--green)' }}>{t(lang, 'renewal_type_request')}</span> :
                            em.is_related ? <span style={{ color: 'var(--yellow)' }}>{t(lang, 'renewal_type_related')}</span> : '—'}
                        </td>
                        <td style={tdStyle}>
                          {(em.matched_keywords || []).map((kw: string, ki: number) => (
                            <span key={ki} style={{ display: 'inline-block', background: 'var(--bg3)', color: 'var(--accent)', borderRadius: 4, padding: '1px 6px', fontSize: 11, marginRight: 3 }}>{kw}</span>
                          ))}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'center' }}>{em.is_dedicated ? '✅' : '—'}</td>
                        <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 11 }}>{em.serial_number || em.extracted_serial || '—'}</td>
                        <td style={{ ...tdStyle, textAlign: 'center' }}>{(em.serial_number || em.extracted_serial) ? (em.serial_exists ? '✅' : <span style={{ color: 'var(--yellow)' }}>?</span>) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
                </>
              );
            })()}
          </div>
        )}
      </div>
    </>
  );
}
