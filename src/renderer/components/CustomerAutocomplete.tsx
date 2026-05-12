/**
 * CustomerAutocomplete.tsx
 *
 * Debounced search input that queries electronAPI.searchCustomers.
 * Emits either { kind: 'existing', id } or { kind: 'new', name } decisions.
 */
import React, { useState, useEffect, useRef } from 'react';
import type { Customer } from '../../shared/types';
import { useLang } from '../App';
import { t } from '../i18n';

export type CustomerChoice =
  | { kind: 'existing'; customer: Customer }
  | { kind: 'new'; name: string };

interface Props {
  value: CustomerChoice | null;
  onChange: (choice: CustomerChoice | null) => void;
  placeholder?: string;
  disabled?: boolean;
}

export default function CustomerAutocomplete({ value, onChange, placeholder, disabled = false }: Props) {
  const { lang } = useLang();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Customer[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const wrapRef = useRef<HTMLDivElement>(null);

  const displayLabel = value
    ? value.kind === 'existing'
      ? `${value.customer.name}${value.customer.email ? ` <${value.customer.email}>` : ''}`
      : `✦ ${t(lang, 'customer_new_prefix')}: ${value.name}`
    : '';

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (query.length < 1) { setResults([]); return; }
    clearTimeout(timer.current);
    setLoading(true);
    timer.current = setTimeout(async () => {
      try {
        const res = await window.electronAPI.searchCustomers(query);
        setResults(res);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer.current);
  }, [query]);

  const pickExisting = (c: Customer) => {
    onChange({ kind: 'existing', customer: c });
    setQuery('');
    setOpen(false);
  };

  const pickNew = () => {
    onChange({ kind: 'new', name: query.trim() });
    setQuery('');
    setOpen(false);
  };

  const clear = () => { onChange(null); setQuery(''); };

  if (disabled) {
    return (
      <div style={inputBox}>{displayLabel || <span style={{ color: 'var(--text3)' }}>{t(lang, 'customer_unselected')}</span>}</div>
    );
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      {value && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <span style={{ padding: '4px 10px', background: 'var(--accent-dim2)', border: '1px solid rgba(61,216,200,0.3)', borderRadius: 6, fontSize: 12, color: 'var(--accent)' }}>
            {value.kind === 'existing' ? value.customer.name : `${t(lang, 'customer_new_prefix')}: ${value.name}`}
          </span>
          <button onClick={clear} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text3)', fontSize: 14 }}>✕</button>
        </div>
      )}

      <input
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={value ? t(lang, 'customer_search_other') : (placeholder ?? t(lang, 'customer_search_placeholder_short'))}
        style={inputBox}
      />

      {open && query.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 500,
          background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 6,
          boxShadow: '0 4px 16px rgba(0,0,0,0.4)', marginTop: 2, maxHeight: 220, overflow: 'auto',
        }}>
          {loading && (
            <div style={{ padding: '8px 12px', color: 'var(--text3)', fontSize: 13 }}>{t(lang, 'customer_searching')}</div>
          )}
          {!loading && results.map(c => (
            <div key={c.id} onMouseDown={() => pickExisting(c)} style={dropItem}>
              <strong style={{ fontSize: 13, color: 'var(--text)' }}>{c.name}</strong>
              <span style={{ color: 'var(--text3)', fontSize: 11, marginLeft: 6 }}>
                {[c.email, c.phone, c.dealer].filter(Boolean).join(' · ')}
              </span>
            </div>
          ))}
          {!loading && query.trim() && (
            <div onMouseDown={pickNew} style={{ ...dropItem, borderTop: '1px solid var(--border)', color: 'var(--accent)' }}>
              ✦ {t(lang, 'customer_create_new').replace('{name}', query.trim())}
            </div>
          )}
          {!loading && results.length === 0 && !query.trim() && (
            <div style={{ padding: '8px 12px', color: 'var(--text3)', fontSize: 13 }}>{t(lang, 'no_results')}</div>
          )}
        </div>
      )}
    </div>
  );
}

const inputBox: React.CSSProperties = {
  width: '100%', padding: '7px 10px', border: '1px solid var(--border2)',
  borderRadius: 6, fontSize: 13, boxSizing: 'border-box', outline: 'none',
  background: 'var(--bg3)', color: 'var(--text)',
};
const dropItem: React.CSSProperties = {
  padding: '9px 12px', cursor: 'pointer', fontSize: 13,
  borderBottom: '1px solid var(--border)',
};
