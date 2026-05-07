/**
 * ModuleListEditor.tsx
 *
 * Manage a string[] list of module names (add / remove).
 */
import React, { useState } from 'react';

interface Props {
  modules: string[];
  onChange: (modules: string[]) => void;
  disabled?: boolean;
}

export default function ModuleListEditor({ modules, onChange, disabled = false }: Props) {
  const [input, setInput] = useState('');

  const add = () => {
    const v = input.trim();
    if (!v || modules.includes(v)) return;
    onChange([...modules, v]);
    setInput('');
  };

  const remove = (idx: number) => onChange(modules.filter((_, i) => i !== idx));

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
        {modules.map((m, i) => (
          <span key={i} style={{
            padding: '3px 10px', background: 'var(--accent-dim2)', color: 'var(--accent)',
            borderRadius: 12, fontSize: 12, display: 'flex', alignItems: 'center', gap: 5,
            border: '1px solid rgba(61,216,200,0.3)',
          }}>
            {m}
            {!disabled && (
              <button onClick={() => remove(i)} style={{
                border: 'none', background: 'none', cursor: 'pointer', color: 'var(--accent)',
                fontSize: 13, lineHeight: 1, padding: 0,
              }}>×</button>
            )}
          </span>
        ))}
        {modules.length === 0 && <span style={{ fontSize: 12, color: 'var(--text3)' }}>모듈 없음</span>}
      </div>
      {!disabled && (
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && add()}
            placeholder="모듈명 입력 후 Enter"
            style={{
              flex: 1, padding: '5px 8px', border: '1px solid var(--border2)',
              borderRadius: 4, fontSize: 12, background: 'var(--bg3)', color: 'var(--text)',
            }}
          />
          <button onClick={add} disabled={!input.trim()} className="btn btn-primary btn-sm"
            style={{ opacity: input.trim() ? 1 : 0.5 }}>
            추가
          </button>
        </div>
      )}
    </div>
  );
}
