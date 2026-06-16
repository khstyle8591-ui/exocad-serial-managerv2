import React from 'react';
import { useLang } from '../../App';
import { t } from '../../i18n';

export function genId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function emptySource() {
  return {
    id: genId(),
    name: '',
    url: '',
    login_url: '',
    login_id: '',
    login_pw: '',
    enabled: true,
    field_serial: '',
    field_customer: '',
    field_phone: '',
    field_purchase: '',
    field_expiry: '',
    field_product: '',
    product_filter: '',
    last_polled: '',
  };
}

// ── 섹션 헤더 (제목 + 매뉴얼 버튼) ───────────────────────────────────────────
export function SectionHeader({ title, onManual }: { title: string; onManual: () => void }) {
  const { lang } = useLang();
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
      <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{title}</h3>
      <button
        onClick={onManual}
        title={t(lang, 'manual_tooltip')}
        style={{
          background: 'var(--bg4)', border: '1px solid var(--border2)', color: 'var(--text2)',
          borderRadius: 6, padding: '3px 10px', fontSize: 11.5, cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'inherit',
        }}
      >
        📖 {t(lang, 'manual_title')}
      </button>
    </div>
  );
}

export const sectionLabel: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.07em',
  color: 'var(--accent)',
  borderBottom: '1px solid #e5e7eb',
  paddingBottom: 4,
  marginBottom: 10,
};

export const thStyle: React.CSSProperties = {
  padding: '6px 10px',
  textAlign: 'left',
  fontWeight: 600,
  fontSize: 11,
  color: 'var(--text)',
  whiteSpace: 'nowrap',
};

export const tdStyle: React.CSSProperties = {
  padding: '5px 10px',
  verticalAlign: 'middle',
};

export function checkIcon(val: boolean | undefined): React.ReactNode {
  if (val === undefined) return '—';
  return val
    ? <span style={{ color: 'var(--green)', fontWeight: 700 }}>✓</span>
    : <span style={{ color: 'var(--red)', fontWeight: 700 }}>✗</span>;
}
