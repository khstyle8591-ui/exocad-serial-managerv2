import React, { useEffect, useState } from 'react';
import { t, type Language } from '../../i18n';
import type { ProductCodeGroup, ProductCodeRule } from '../../../shared/types';
import { BUILT_IN_CODES, PRODUCT_CODE_GROUP_ORDER } from '../../../shared/constants';

// ── Product Code 그룹 설정 섹션 ─────────────────────────────────────────────
type ProductCodeDescKey =
  | 'group_desc_main'
  | 'group_desc_addon'
  | 'group_desc_renewal'
  | 'group_desc_renewal_addon'
  | 'group_desc_memo'
  | 'group_desc_upgrade'
  | 'group_desc_credits'
  | 'group_desc_ignore';

const GROUP_META: Record<ProductCodeGroup, { label: string; color: string; bg: string; descKey: ProductCodeDescKey }> = {
  main: { label: 'A · Main Product', color: 'var(--accent)', bg: 'var(--accent-dim)', descKey: 'group_desc_main' },
  addon: { label: 'B · Add-On', color: 'var(--green)', bg: 'var(--green-dim)', descKey: 'group_desc_addon' },
  renewal: { label: 'C · Renewal', color: 'var(--blue)', bg: 'var(--blue-dim)', descKey: 'group_desc_renewal' },
  renewal_addon: { label: 'D · Renewal Add-On', color: 'var(--purple)', bg: 'var(--purple-dim)', descKey: 'group_desc_renewal_addon' },
  memo: { label: 'E · Memo', color: 'var(--yellow)', bg: 'var(--yellow-dim)', descKey: 'group_desc_memo' },
  upgrade: { label: 'F · Upgrade', color: 'var(--red)', bg: 'var(--red-dim)', descKey: 'group_desc_upgrade' },
  credits: { label: 'G · AI Credits', color: 'var(--blue)', bg: 'var(--blue-dim)', descKey: 'group_desc_credits' },
  ignore: { label: 'H · Ignore', color: 'var(--text)', bg: 'var(--bg4)', descKey: 'group_desc_ignore' },
};

// 표시용 내장 코드 목록 — 단일 소스(shared/constants)에서 파생
const BUILT_IN_DISPLAY: Record<ProductCodeGroup, string[]> = BUILT_IN_CODES;

export function ProductCodeRulesSection({ initialRules, loadKey, onRulesChange, lang }: {
  initialRules: ProductCodeRule[];
  loadKey: number;
  onRulesChange: (rules: ProductCodeRule[]) => void;
  lang: Language;
}) {
  const [rules, setRules] = useState<ProductCodeRule[]>(initialRules);
  const [newCode, setNewCode] = useState('');
  const [newGroup, setNewGroup] = useState<ProductCodeGroup>('addon');
  const [newNote, setNewNote] = useState('');
  const [collapsed, setCollapsed] = useState<Record<ProductCodeGroup, boolean>>({
    main: true, addon: true, renewal: true, renewal_addon: true,
    memo: true, upgrade: true, credits: true, ignore: true,
  });

  useEffect(() => { setRules(initialRules); }, [loadKey]);

  const save = (next: ProductCodeRule[]) => { setRules(next); onRulesChange(next); };

  const addRule = () => {
    const code = newCode.trim();
    if (!code) return;
    if (rules.some(r => r.code === code)) {
      alert(t(lang, 'product_code_duplicate').replace('{code}', code));
      return;
    }
    save([...rules, { code, group: newGroup, note: newNote.trim() || undefined }]);
    setNewCode(''); setNewNote('');
  };

  const removeRule = (code: string) => save(rules.filter(r => r.code !== code));

  const toggleCollapse = (g: ProductCodeGroup) =>
    setCollapsed(prev => ({ ...prev, [g]: !prev[g] }));

  return (
    <div className="settings-section">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h3 style={{ margin: 0 }}>{t(lang, 'product_code_title')}</h3>
        <span style={{ fontSize: 12, color: 'var(--text)' }}>{t(lang, 'product_code_sub')}</span>
      </div>

      {/* 그룹별 내장 코드 목록 */}
      <div style={{ marginBottom: 20 }}>
        <p style={{ fontSize: 12, color: 'var(--text)', margin: '0 0 10px' }}>
          {t(lang, 'product_code_note')}
        </p>
        {PRODUCT_CODE_GROUP_ORDER.map(g => {
          const meta = GROUP_META[g];
          const builtIn = BUILT_IN_DISPLAY[g];
          const custom = rules.filter(r => r.group === g);
          const isOpen = !collapsed[g];
          return (
            <div key={g} style={{ marginBottom: 8, border: `1px solid ${meta.color}33`, borderRadius: 8, overflow: 'hidden' }}>
              <button
                onClick={() => toggleCollapse(g)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '8px 12px', background: meta.bg, border: 'none', cursor: 'pointer',
                  fontWeight: 600, fontSize: 13, color: meta.color,
                }}
              >
                <span>{meta.label}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text)' }}>{t(lang, meta.descKey)}</span>
                  <span style={{ fontSize: 11, background: meta.color, color: '#fff', borderRadius: 10, padding: '1px 7px' }}>
                    {t(lang, 'product_code_count').replace('{n}', String(builtIn.length + custom.length))}
                  </span>
                  <span style={{ fontSize: 12 }}>{isOpen ? '▲' : '▼'}</span>
                </span>
              </button>
              {isOpen && (
                <div style={{ padding: '10px 12px', background: 'var(--bg2)' }}>
                  {/* 내장 코드 (read-only) */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: custom.length > 0 ? 8 : 0 }}>
                    {builtIn.map(code => (
                      <span key={code} style={{
                        fontSize: 11, fontFamily: 'monospace', background: meta.bg,
                        border: `1px solid ${meta.color}44`, borderRadius: 4, padding: '2px 6px', color: meta.color,
                      }}>{code}</span>
                    ))}
                  </div>
                  {/* 커스텀 코드 목록 */}
                  {custom.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, paddingTop: 6, borderTop: `1px dashed ${meta.color}33` }}>
                      {custom.map(r => (
                        <span key={r.code} style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          fontSize: 11, fontFamily: 'monospace',
                          background: 'var(--yellow-dim)', border: '1px solid #fbbf24', borderRadius: 4, padding: '2px 6px', color: 'var(--yellow)',
                        }}>
                          ★ {r.code}{r.note ? ` (${r.note})` : ''}
                          <button
                            onClick={() => removeRule(r.code)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--red)', fontSize: 12, lineHeight: 1, padding: 0 }}
                          >✕</button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 커스텀 코드 추가 */}
      <div style={{ background: 'var(--bg3)', border: '1px solid #e2e8f0', borderRadius: 8, padding: '14px 16px' }}>
        <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)', marginBottom: 10 }}>{t(lang, 'product_code_add_title')}</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 140px' }}>
            <label style={{ fontSize: 11, color: 'var(--text)', display: 'block', marginBottom: 3 }}>{t(lang, 'product_code_label')}</label>
            <input
              value={newCode}
              onChange={e => setNewCode(e.target.value)}
              placeholder="006-001099"
              style={{ fontFamily: 'monospace', fontSize: 13, width: '100%' }}
              onKeyDown={e => { if (e.key === 'Enter') addRule(); }}
            />
          </div>
          <div style={{ flex: '1 1 160px' }}>
            <label style={{ fontSize: 11, color: 'var(--text)', display: 'block', marginBottom: 3 }}>{t(lang, 'product_code_group_label')}</label>
            <select
              value={newGroup}
              onChange={e => setNewGroup(e.target.value as ProductCodeGroup)}
              style={{ width: '100%', fontSize: 13, padding: '6px 8px', borderRadius: 6, border: '1px solid #d1d5db' }}
            >
              {PRODUCT_CODE_GROUP_ORDER.map(g => (
                <option key={g} value={g}>{GROUP_META[g].label}</option>
              ))}
            </select>
          </div>
          <div style={{ flex: '2 1 160px' }}>
            <label style={{ fontSize: 11, color: 'var(--text)', display: 'block', marginBottom: 3 }}>{t(lang, 'product_code_memo_label')}</label>
            <input
              value={newNote}
              onChange={e => setNewNote(e.target.value)}
              placeholder={t(lang, 'product_code_memo_placeholder')}
              style={{ fontSize: 13, width: '100%' }}
            />
          </div>
          <button
            onClick={addRule}
            className="btn btn-primary"
            style={{ flexShrink: 0, height: 36, alignSelf: 'flex-end' }}
          >{t(lang, 'product_code_add_btn')}</button>
        </div>
        {rules.length > 0 && (
          <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text)' }}>
            {t(lang, 'product_code_registered').replace('{n}', String(rules.length))}
          </div>
        )}
      </div>
    </div>
  );
}
