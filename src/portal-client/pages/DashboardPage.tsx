import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../contexts/AuthContext';
import { t, type Lang } from '../i18n';

// Must match PORTAL_SERIAL_MEMO_MAX_LENGTH on the server (portal-memo.service.ts).
const MEMO_MAX_LENGTH = 24;

interface LinkedProduct {
  main_product: string;
  serial_number: string;
  status: string;
  expiry_date: string | null;
  renewal_stop_requested?: number;
  memo?: string;
}

interface ProfileData {
  name: string;
  linked_products: LinkedProduct[];
}

function statusBadge(p: LinkedProduct, lang: Lang) {
  if (p.renewal_stop_requested) return <span className="badge badge-yellow">{t(lang, 'status_stop_requested')}</span>;
  if (p.status === 'active')    return <span className="badge badge-green">{t(lang, 'status_active')}</span>;
  if (p.status === 'cancelled') return <span className="badge badge-red">{t(lang, 'status_cancelled')}</span>;
  if (p.status === 'expired')   return <span className="badge badge-red">{t(lang, 'status_expired')}</span>;
  return <span className="badge badge-gray">{p.status}</span>;
}

// Count by code point so the limit matches the server (an emoji is one character, not two).
const memoLength = (s: string) => [...s.trim()].length;

function MemoModal({ product, lang, onClose, onSaved }: {
  product: LinkedProduct;
  lang: Lang;
  onClose: () => void;
  onSaved: (memo: string) => void;
}) {
  const [value, setValue] = useState(product.memo ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const length = memoLength(value);
  const over = length > MEMO_MAX_LENGTH;

  // No hard truncation while typing: cutting the value mid-IME-composition breaks Japanese input.
  // Over-limit input is shown in red and cannot be saved.
  async function save(memo: string) {
    if (memoLength(memo) > MEMO_MAX_LENGTH) { setError(t(lang, 'memo_too_long')); return; }
    setSaving(true);
    setError('');
    try {
      const res = await api.patch<{ ok: boolean; memo: string }>('/profile/serial-memo', {
        serial_number: product.serial_number,
        memo,
      });
      onSaved(res.memo);
    } catch (err) {
      const code = err instanceof Error ? err.message : '';
      setError(code === 'memo_too_long' ? t(lang, 'memo_too_long') : t(lang, 'memo_save_failed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12,
          maxWidth: 420, width: '100%', padding: 24, boxShadow: '0 12px 40px rgba(0,0,0,0.4)',
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>{t(lang, 'memo_title')}</div>
        <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 14, overflowWrap: 'anywhere' }}>
          {product.main_product} · <span style={{ fontFamily: "'DM Mono', monospace" }}>{product.serial_number}</span>
        </div>
        <form
          onSubmit={e => { e.preventDefault(); if (!over && !saving) void save(value); }}
        >
          <div className="form-group" style={{ marginBottom: 0 }}>
            <input
              type="text"
              value={value}
              autoFocus
              onChange={e => setValue(e.target.value)}
              style={{ width: '100%' }}
            />
          </div>
          <div className={`memo-counter${over ? ' over' : ''}`}>{length} / {MEMO_MAX_LENGTH}</div>
          <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 8 }}>{t(lang, 'memo_hint')}</div>
          {error && <div className="alert alert-error" style={{ marginTop: 10 }}>{error}</div>}
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 20 }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              style={{ color: 'var(--red)', visibility: product.memo ? 'visible' : 'hidden' }}
              disabled={saving}
              onClick={() => void save('')}
            >
              {t(lang, 'memo_delete')}
            </button>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn-secondary btn-sm" onClick={onClose} disabled={saving}>
                {t(lang, 'memo_cancel')}
              </button>
              <button type="submit" className="btn btn-primary btn-sm" disabled={saving || over}>
                {t(lang, 'memo_save')}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { lang, account } = useAuth();
  const [products, setProducts] = useState<LinkedProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<LinkedProduct | null>(null);

  useEffect(() => {
    api.get<ProfileData>('/profile')
      .then(d => setProducts(d.linked_products))
      .catch(e => setError(e instanceof Error ? e.message : ''))
      .finally(() => setLoading(false));
  }, []);

  function handleSaved(serialNumber: string, memo: string) {
    setProducts(prev => prev.map(p => (p.serial_number === serialNumber ? { ...p, memo } : p)));
    setEditing(null);
  }

  return (
    <div className="portal-page">
      <h1 className="page-title">{t(lang, 'dashboard')}</h1>
      <p className="page-subtitle" style={{ marginBottom: 24 }}>
        {account?.name}
      </p>

      <div className="portal-card">
        <div className="portal-card-title">{t(lang, 'my_products')}</div>

        {loading && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '20px 0' }}>
            <div className="spinner" />
          </div>
        )}

        {error && <div className="alert alert-error">{error}</div>}

        {!loading && !error && products.length === 0 && (
          <div style={{ color: 'var(--text3)', fontSize: 13, marginBottom: 12 }}>
            {t(lang, 'no_products')}
          </div>
        )}

        {products.map((p, i) => (
          <div
            key={i}
            className="product-card has-memo-slot"
            role="button"
            tabIndex={0}
            onClick={() => setEditing(p)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setEditing(p); } }}
          >
            <div className="product-card-info">
              <div className="product-card-name">{p.main_product}</div>
              <div className="product-card-serial">{p.serial_number}</div>
              {p.expiry_date && (
                <div className="product-card-expiry" style={{ fontSize: 12, color: 'var(--text3)' }}>
                  {t(lang, 'expiry_date_label')}: {p.expiry_date}
                </div>
              )}
            </div>
            {p.memo
              ? <div className="product-card-memo" title={p.memo}>{p.memo}</div>
              : <div className="product-card-memo empty">{t(lang, 'memo_add')}</div>}
            {statusBadge(p, lang)}
          </div>
        ))}

        {!loading && products.length === 0 && (
          <Link to="/setup" className="btn btn-secondary btn-sm mt-8">
            {t(lang, 'link_serial_nav')}
          </Link>
        )}
      </div>

      {editing && (
        <MemoModal
          product={editing}
          lang={lang}
          onClose={() => setEditing(null)}
          onSaved={memo => handleSaved(editing.serial_number, memo)}
        />
      )}
    </div>
  );
}
