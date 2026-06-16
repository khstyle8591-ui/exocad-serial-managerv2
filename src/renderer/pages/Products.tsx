import React, { useEffect, useState } from 'react';
import { useLang } from '../App';
import { t } from '../i18n';
import { api } from '../client';
import type { SerialVersionSummary } from '../../shared/types';

const ProductIcon = () => (
  <svg width={16} height={16} viewBox="0 0 16 16" fill="none">
    <path d="M8 1L14 4.5V11.5L8 15L2 11.5V4.5L8 1Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
    <path d="M8 1V15M2 4.5L14 4.5" stroke="currentColor" strokeWidth="1.2" opacity=".5"/>
  </svg>
);

export default function Products() {
  const { lang } = useLang();
  const [versions, setVersions] = useState<SerialVersionSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getSerialVersionSummary()
      .then(data => setVersions(data as SerialVersionSummary[]))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>{t(lang, 'loading')}</div>;
  }

  return (
    <div className="page-wrapper">
      <div className="page-header">
        <div>
          <div className="page-title">{t(lang, 'page_title_products_version')}</div>
          <div className="page-subtitle">{t(lang, 'page_subtitle_products_version')}</div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {versions.map(summary => {
          const ver = summary.version || t(lang, 'label_empty_version');

          const stats = [
            { label: t(lang, 'status_active'),        value: summary.active,        color: 'var(--green)',  dim: 'var(--green-dim)' },
            { label: t(lang, 'status_cancelled'),     value: summary.cancelled,     color: 'var(--red)',    dim: 'var(--red-dim)' },
            { label: t(lang, 'status_expired'),       value: summary.expired,       color: 'var(--text2)',  dim: 'var(--bg4)' },
            { label: t(lang, 'status_not_activated'), value: summary.not_activated, color: 'var(--yellow)', dim: 'var(--yellow-dim)' },
          ];

          return (
            <div key={summary.version || '__empty__'} style={{
              background: 'var(--bg2)', border: '1px solid var(--border)',
              borderRadius: 10, padding: '16px 18px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 9, flexShrink: 0,
                  background: 'var(--accent-dim2)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'var(--accent)',
                }}>
                  <ProductIcon />
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', fontFamily: "'JetBrains Mono', monospace" }}>
                    {ver}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
                    {t(lang, 'label_version_license_count').replace('{n}', String(summary.total))}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                {stats.map(({ label, value, color, dim }) => (
                  <div key={label} style={{
                    flex: 1, background: dim, borderRadius: 7,
                    padding: '8px 12px', textAlign: 'center',
                  }}>
                    <div style={{ fontSize: 18, fontWeight: 600, color, lineHeight: 1 }}>{value}</div>
                    <div style={{ fontSize: 10.5, color: 'var(--text3)', marginTop: 3 }}>{label}</div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {versions.length === 0 && (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
          {t(lang, 'no_serials')}
        </div>
      )}
    </div>
  );
}
