import React from 'react';
import { t, type Language } from '../../i18n';

type KeywordCardEditorProps = {
  inputKey: string;
  label: string;
  hint: string;
  placeholder: string;
  values: string[];
  onChange: React.Dispatch<React.SetStateAction<string[]>>;
  inputValue: string;
  onInputChange: (key: string, value: string) => void;
  onAdd: (key: string, list: string[], setter: React.Dispatch<React.SetStateAction<string[]>>) => void;
  onRemove: (value: string, setter: React.Dispatch<React.SetStateAction<string[]>>) => void;
  lang: Language;
  danger?: boolean;
};

export function KeywordCardEditor({
  inputKey,
  label,
  hint,
  placeholder,
  values,
  onChange,
  inputValue,
  onInputChange,
  onAdd,
  onRemove,
  lang,
  danger = false,
}: KeywordCardEditorProps) {
  return (
    <div className="form-group" style={{ marginBottom: 16 }}>
      <label style={{ fontWeight: 600, color: danger ? 'var(--red)' : undefined }}>{label}</label>
      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        <input
          value={inputValue}
          onChange={e => onInputChange(inputKey, e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onAdd(inputKey, values, onChange);
            }
          }}
          placeholder={placeholder}
        />
        <button
          type="button"
          onClick={() => onAdd(inputKey, values, onChange)}
          className="btn btn-secondary"
          style={{ whiteSpace: 'nowrap', padding: '7px 14px' }}
        >
          {t(lang, 'add')}
        </button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
        {values.length === 0 ? (
          <span style={{ color: 'var(--text3)', fontSize: 12 }}>—</span>
        ) : values.map(value => (
          <span
            key={value}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 9px',
              borderRadius: 6,
              border: `1px solid ${danger ? 'rgba(239,68,68,0.35)' : 'var(--border2)'}`,
              background: danger ? 'var(--red-dim)' : 'var(--bg3)',
              color: danger ? 'var(--red)' : 'var(--text)',
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            {value}
            <button
              type="button"
              onClick={() => onRemove(value, onChange)}
              title={t(lang, 'delete')}
              style={{ border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <small style={{ color: danger ? 'var(--red)' : 'var(--text)', fontSize: 12, display: 'block', marginTop: 6 }}>{hint}</small>
    </div>
  );
}
