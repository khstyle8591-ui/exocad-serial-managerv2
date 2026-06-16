import React, { useEffect, useState } from 'react';
import { t, type Language } from '../../i18n';
import type { ProductCodeGroup, ProductCodeRule } from '../../../shared/types';

// ── Product Code 그룹 설정 섹션 ─────────────────────────────────────────────
type ProductCodeDescKey =
  | 'group_desc_renewal'
  | 'group_desc_addon'
  | 'group_desc_main'
  | 'group_desc_memo'
  | 'group_desc_version_update'
  | 'group_desc_ignore';

const GROUP_META: Record<ProductCodeGroup, { label: string; color: string; bg: string; descKey: ProductCodeDescKey }> = {
  renewal: { label: 'A · Renewal', color: 'var(--blue)', bg: 'var(--blue-dim)', descKey: 'group_desc_renewal' },
  addon: { label: 'B · Add-On', color: 'var(--green)', bg: 'var(--green-dim)', descKey: 'group_desc_addon' },
  main: { label: 'C · Main Product', color: 'var(--accent)', bg: 'var(--accent-dim)', descKey: 'group_desc_main' },
  memo: { label: 'D · Memo', color: 'var(--yellow)', bg: 'var(--yellow-dim)', descKey: 'group_desc_memo' },
  version_update: { label: 'E · Version Update', color: 'var(--red)', bg: 'var(--red-dim)', descKey: 'group_desc_version_update' },
  ignore: { label: 'F · Ignore', color: 'var(--text)', bg: 'var(--bg4)', descKey: 'group_desc_ignore' },
};

const BUILT_IN_DISPLAY: Record<ProductCodeGroup, string[]> = {
  renewal: ['006-001017', '006-001035', '006-005200', '006-005201', '006-005212', '006-005213', '006-005214', '006-005215'],
  addon: ['006-001002', '006-001003', '006-001004', '006-001005', '006-001006', '006-001007', '006-001008', '006-001009',
    '006-001010', '006-001011', '006-001012', '006-001013', '006-001014', '006-001015', '006-001016', '006-001037',
    '006-001039', '006-005100', '006-005101', '006-005102', '006-005103', '006-005104', '006-005105', '006-005106',
    '006-005107', '006-005108', '006-005109', '006-005110'],
  main: ['006-001001', '006-001034', '006-001020', '006-005082', '006-005083', '006-005098', '006-005099'],
  memo: ['006-001031', '006-001033', '006-001036', '006-001040', '006-001041', '006-005080', '006-005081', '006-006100', '006-006104'],
  version_update: ['006-001032'],
  ignore: ['006-001018', '006-001019', '006-001021', '006-001022', '006-001023', '006-001024', '006-001025', '006-001026',
    '006-001027', '006-001028', '006-001029', '006-001030', '006-001038', '006-005198', '006-005199', '006-005202',
    '006-005203', '006-005204', '006-005205', '006-005206', '006-005207', '006-005208', '006-005209', '006-005210', '006-005211'],
};

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
    renewal: true, addon: true, main: true, memo: true, version_update: true, ignore: true,
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
        {(Object.keys(GROUP_META) as ProductCodeGroup[]).map(g => {
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
              {(Object.keys(GROUP_META) as ProductCodeGroup[]).map(g => (
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
