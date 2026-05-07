import React, { useState, useRef, useEffect } from 'react';
import VariableChips from './VariableChips';
import { useLang } from '../App';
import { t } from '../i18n';

interface MailTemplate {
  id: number;
  code: string;
  name: string;
  subject: string;
  body: string;
  is_builtin: number;
  enabled: number;
  updated_at: string;
}

interface Props {
  template: MailTemplate | null;
  onSave: (input: {
    id?: number;
    code: string;
    name: string;
    subject: string;
    body: string;
    enabled: boolean;
  }) => Promise<void>;
  onClose: () => void;
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 10px',
  border: '1px solid var(--border2)',
  borderRadius: 6,
  fontSize: 13,
  boxSizing: 'border-box',
  fontFamily: 'inherit',
  background: 'var(--bg3)',
  color: 'var(--text)',
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--text2)',
  marginBottom: 4,
  display: 'block',
};

export default function TemplateEditor({ template, onSave, onClose }: Props) {
  const { lang } = useLang();
  const isBuiltin = template?.is_builtin === 1;

  const [code, setCode] = useState(template?.code ?? '');
  const [name, setName] = useState(template?.name ?? '');
  const [subject, setSubject] = useState(template?.subject ?? '');
  const [body, setBody] = useState(template?.body ?? '');
  const [enabled, setEnabled] = useState(template ? template.enabled === 1 : true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [tab, setTab] = useState<'edit' | 'preview'>('edit');
  const [previewSerialId, setPreviewSerialId] = useState<string>('');
  const [previewResult, setPreviewResult] = useState<{ subject: string; body: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [serials, setSerials] = useState<any[]>([]);
  const [serialsLoaded, setSerialsLoaded] = useState(false);

  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const lastFocused = useRef<'subject' | 'body'>('body');

  useEffect(() => {
    if (tab === 'preview' && !serialsLoaded) {
      window.electronAPI.getSerials().then(list => {
        setSerials(list);
        setSerialsLoaded(true);
      });
    }
  }, [tab, serialsLoaded]);

  const insertVar = (v: string) => {
    if (lastFocused.current === 'subject') {
      const el = subjectRef.current;
      if (!el) return;
      const start = el.selectionStart ?? subject.length;
      const end = el.selectionEnd ?? subject.length;
      const next = subject.slice(0, start) + v + subject.slice(end);
      setSubject(next);
      setTimeout(() => { el.focus(); el.setSelectionRange(start + v.length, start + v.length); }, 0);
    } else {
      const el = bodyRef.current;
      if (!el) return;
      const start = el.selectionStart ?? body.length;
      const end = el.selectionEnd ?? body.length;
      const next = body.slice(0, start) + v + body.slice(end);
      setBody(next);
      setTimeout(() => { el.focus(); el.setSelectionRange(start + v.length, start + v.length); }, 0);
    }
  };

  const handlePreview = async () => {
    if (!previewSerialId) return;
    setPreviewLoading(true);
    try {
      if (template) {
        const result = await window.electronAPI.previewMailTemplate(template.code, Number(previewSerialId));
        setPreviewResult(result);
      } else {
        const serial = serials.find(s => String(s.id) === previewSerialId);
        if (!serial) return;
        const modules: string[] = JSON.parse(serial.modules || '[]');
        const today = new Date().toLocaleDateString('ja-JP');
        const vars: Record<string, string> = {
          CUSTOMER_NAME: serial.customer?.name ?? '',
          CUSTOMER_EMAIL: serial.customer?.email ?? '',
          SERIAL_NUMBER: serial.serial_number,
          EXPIRY_DATE: serial.expiry_date ?? '',
          PURCHASE_DATE: serial.purchase_date ?? '',
          MAIN_PRODUCT: serial.main_product ?? '',
          MODULES: modules.join(', '),
          TODAY: today,
          DEALER: serial.customer?.dealer ?? '',
          SALES_MANAGER: serial.customer?.sales_manager ?? '',
        };
        const render = (tmpl: string) =>
          tmpl.replace(/\{\{([A-Z_]+)\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`);
        setPreviewResult({ subject: render(subject), body: render(body) });
      }
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleSave = async () => {
    if (!code.trim()) { setError(t(lang, 'tmpl_err_code_required')); return; }
    if (!name.trim()) { setError(t(lang, 'tmpl_err_name_required')); return; }
    if (!/^[a-z0-9_]+$/.test(code.trim())) { setError(t(lang, 'tmpl_err_code_format')); return; }
    setSaving(true);
    setError('');
    try {
      await onSave({ id: template?.id, code: code.trim(), name: name.trim(), subject, body, enabled });
    } catch (e: any) {
      setError(e.message ?? t(lang, 'tmpl_save_fail'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: 'var(--bg2)', borderRadius: 12, width: 760,
        maxHeight: '90vh', display: 'flex', flexDirection: 'column',
        boxShadow: '0 20px 60px rgba(0,0,0,0.5)', border: '1px solid var(--border2)',
      }}>
        {/* Header */}
        <div style={{
          padding: '18px 24px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>
              {template ? t(lang, 'tmpl_title_edit') : t(lang, 'tmpl_title_new')}
            </h3>
            {isBuiltin && (
              <span style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2, display: 'block' }}>
                {t(lang, 'tmpl_builtin_note')}
              </span>
            )}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text3)' }}>×</button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', padding: '0 24px' }}>
          {(['edit', 'preview'] as const).map(tabId => (
            <button
              key={tabId}
              onClick={() => setTab(tabId)}
              style={{
                padding: '10px 16px', fontSize: 13, fontWeight: 600,
                border: 'none', background: 'none', cursor: 'pointer',
                borderBottom: tab === tabId ? '2px solid var(--accent)' : '2px solid transparent',
                color: tab === tabId ? 'var(--accent)' : 'var(--text3)',
                marginBottom: -1,
              }}
            >
              {tabId === 'edit' ? t(lang, 'tab_edit') : t(lang, 'tab_preview')}
            </button>
          ))}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
          {tab === 'edit' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={labelStyle}>{t(lang, 'label_template_code')} *</label>
                  <input
                    value={code}
                    onChange={e => setCode(e.target.value)}
                    disabled={isBuiltin}
                    placeholder="renewal_reminder"
                    style={{ ...inputStyle, opacity: isBuiltin ? 0.6 : 1 }}
                  />
                </div>
                <div>
                  <label style={labelStyle}>{t(lang, 'label_template_name')} *</label>
                  <input value={name} onChange={e => setName(e.target.value)} placeholder="renewal_reminder" style={inputStyle} />
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  id="tmpl-enabled"
                  checked={enabled}
                  onChange={e => setEnabled(e.target.checked)}
                  style={{ width: 16, height: 16, cursor: 'pointer' }}
                />
                <label htmlFor="tmpl-enabled" style={{ fontSize: 13, cursor: 'pointer', color: 'var(--text)' }}>{t(lang, 'label_enabled')}</label>
              </div>

              <div>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>{t(lang, 'label_insert_var')}</div>
                <VariableChips onInsert={insertVar} />
              </div>

              <div>
                <label style={labelStyle}>{t(lang, 'label_subject')}</label>
                <input
                  ref={subjectRef}
                  value={subject}
                  onChange={e => setSubject(e.target.value)}
                  onFocus={() => { lastFocused.current = 'subject'; }}
                  placeholder="{{SERIAL_NUMBER}}"
                  style={inputStyle}
                />
              </div>

              <div>
                <label style={labelStyle}>{t(lang, 'label_body')}</label>
                <textarea
                  ref={bodyRef}
                  value={body}
                  onChange={e => setBody(e.target.value)}
                  onFocus={() => { lastFocused.current = 'body'; }}
                  rows={14}
                  placeholder="{{CUSTOMER_NAME}}"
                  style={{
                    ...inputStyle,
                    resize: 'vertical',
                    fontFamily: 'monospace',
                    fontSize: 12,
                    lineHeight: 1.6,
                  }}
                />
              </div>
            </div>
          )}

          {tab === 'preview' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>{t(lang, 'label_preview_serial')}</label>
                  <select
                    value={previewSerialId}
                    onChange={e => { setPreviewSerialId(e.target.value); setPreviewResult(null); }}
                    style={inputStyle}
                  >
                    <option value="">{t(lang, 'preview_select_placeholder')}</option>
                    {serials.map(s => (
                      <option key={s.id} value={String(s.id)}>
                        {s.serial_number} — {s.customer?.name ?? ''}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={handlePreview}
                  disabled={!previewSerialId || previewLoading}
                  style={{
                    padding: '6px 16px', fontSize: 13, borderRadius: 6,
                    border: 'none', background: 'var(--accent)', color: '#0d1117',
                    cursor: previewSerialId ? 'pointer' : 'not-allowed',
                    opacity: previewSerialId ? 1 : 0.5,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {previewLoading ? t(lang, 'preview_generating') : t(lang, 'btn_preview')}
                </button>
              </div>

              {previewResult && (
                <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                  <div style={{ background: 'var(--bg3)', padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
                    <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600 }}>{t(lang, 'preview_subject_label')}</span>
                    <span style={{ fontSize: 13, marginLeft: 8, color: 'var(--text)' }}>{previewResult.subject}</span>
                  </div>
                  <pre style={{
                    margin: 0, padding: '16px',
                    fontSize: 13, lineHeight: 1.7,
                    whiteSpace: 'pre-wrap', fontFamily: 'inherit',
                    background: 'var(--bg2)', color: 'var(--text)',
                  }}>
                    {previewResult.body}
                  </pre>
                </div>
              )}

              {!previewResult && (
                <div style={{
                  textAlign: 'center', padding: 40, color: 'var(--text3)',
                  border: '2px dashed var(--border)', borderRadius: 8, fontSize: 13,
                }}>
                  {t(lang, 'preview_empty')}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '14px 24px', borderTop: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ fontSize: 12, color: '#fc8181', minHeight: 18 }}>{error}</div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={onClose}
              style={{
                padding: '7px 18px', fontSize: 13, borderRadius: 6,
                border: '1px solid var(--border2)', background: 'var(--bg3)',
                cursor: 'pointer', color: 'var(--text)',
              }}
            >
              {t(lang, 'cancel')}
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                padding: '7px 18px', fontSize: 13, borderRadius: 6,
                border: 'none', background: 'var(--accent)', color: '#0d1117',
                cursor: saving ? 'not-allowed' : 'pointer',
                opacity: saving ? 0.7 : 1,
              }}
            >
              {saving ? t(lang, 'saving') : t(lang, 'save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
