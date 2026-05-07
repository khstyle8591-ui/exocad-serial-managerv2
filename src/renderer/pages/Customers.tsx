import React, { useEffect, useState } from 'react';
import { useLang } from '../App';
import { t } from '../i18n';
import { api } from '../api';

interface Serial {
  id: number;
  serial_number: string;
  customer_name: string;
  customer_manager: string;
  customer_email: string;
  customer_phone: string;
  status: string;
}

export default function Customers() {
  const { lang } = useLang();
  const [serials, setSerials] = useState<Serial[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState('');

  useEffect(() => {
    api.getSerials()
      .then(data => setSerials(data as Serial[]))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // Group by customer
  const customerMap = new Map<string, Serial[]>();
  serials.forEach(s => {
    const list = customerMap.get(s.customer_name) || [];
    list.push(s);
    customerMap.set(s.customer_name, list);
  });

  const customers = [...customerMap.entries()]
    .filter(([name]) => !search || name.toLowerCase().includes(search.toLowerCase()))
    .sort(([a], [b]) => a.localeCompare(b));

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>{t(lang, 'loading')}</div>;
  }

  return (
    <div className="page-wrapper">
      {/* Header */}
      <div className="page-header">
        <div>
          <div className="page-title">{t(lang, 'nav_customers')}</div>
          <div className="page-subtitle">{t(lang, 'page_subtitle_customers').replace('{n}', String(customerMap.size))}</div>
        </div>
        <div style={{ position: 'relative' }}>
          <span style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--text3)' }}>
            <svg width={13} height={13} viewBox="0 0 16 16" fill="none">
              <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M10 10L14 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
          </span>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t(lang, 'customers_search_placeholder')}
            style={{
              background: 'var(--bg3)', border: '1px solid var(--border2)',
              borderRadius: 7, padding: '7px 10px 7px 30px',
              color: 'var(--text)', fontSize: 12.5, outline: 'none',
              width: 200,
            }}
            onFocus={e => (e.target as HTMLElement).style.borderColor = 'var(--accent)'}
            onBlur={e  => (e.target as HTMLElement).style.borderColor = 'var(--border2)'}
          />
        </div>
      </div>

      {/* Customer grid */}
      <div className="card-grid">
        {customers.map(([name, cSerials]) => {
          const active    = cSerials.filter(s => s.status === 'active').length;
          const cancelled = cSerials.filter(s => s.status === 'cancelled').length;
          const expired   = cSerials.filter(s => s.status === 'expired').length;
          const manager   = cSerials[0]?.customer_manager || '';
          const email     = cSerials[0]?.customer_email   || '';
          const phone     = cSerials[0]?.customer_phone   || '';

          return (
            <div key={name} className="card">
              {/* Avatar + name */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <div style={{
                  width: 34, height: 34, borderRadius: 8, flexShrink: 0,
                  background: 'var(--bg4)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 14, fontWeight: 600, color: 'var(--accent)',
                }}>
                  {name[0]}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {name}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>{t(lang, 'label_license_count').replace('{n}', String(cSerials.length))}</div>
                </div>
              </div>

              {/* Contact info */}
              {(manager || phone) && (
                <div style={{ marginBottom: 10, fontSize: 11.5, color: 'var(--text2)' }}>
                  {manager && <div>{manager}</div>}
                  {phone   && <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: 'var(--text3)' }}>{phone}</div>}
                  {email   && <div style={{ fontSize: 11, color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{email}</div>}
                </div>
              )}

              {/* Status pills */}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {active > 0 && (
                  <span style={{
                    fontSize: 11, color: 'var(--green)', background: 'var(--green-dim)',
                    padding: '2px 8px', borderRadius: 4, border: '1px solid rgba(74,222,128,0.3)',
                  }}>
                    {t(lang, 'status_active')} {active}
                  </span>
                )}
                {cancelled > 0 && (
                  <span style={{
                    fontSize: 11, color: 'var(--red)', background: 'var(--red-dim)',
                    padding: '2px 8px', borderRadius: 4, border: '1px solid rgba(240,82,82,0.3)',
                  }}>
                    {t(lang, 'status_cancelled')} {cancelled}
                  </span>
                )}
                {expired > 0 && (
                  <span style={{
                    fontSize: 11, color: 'var(--text2)', background: 'var(--bg4)',
                    padding: '2px 8px', borderRadius: 4, border: '1px solid var(--border2)',
                  }}>
                    {t(lang, 'status_expired')} {expired}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {customers.length === 0 && (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
          {t(lang, 'no_data')}
        </div>
      )}
    </div>
  );
}
