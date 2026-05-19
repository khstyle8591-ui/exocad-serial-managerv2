import React, { useEffect, useState } from 'react';
import { useLang } from '../App';
import { t } from '../i18n';
import type { Customer, CustomerInput, SerialWithCustomer } from '../../shared/types';

const EMPTY_CUSTOMER: CustomerInput = {
  name: '',
  email: '',
  phone: '',
  address: '',
  dealer: '',
  sales_manager: '',
  notes: '',
};

export default function Customers() {
  const { lang } = useLang();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [serials, setSerials] = useState<SerialWithCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch]   = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<CustomerInput>(EMPTY_CUSTOMER);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      window.electronAPI.listCustomers(),
      window.electronAPI.getSerials(),
    ])
      .then(([customerData, serialData]) => {
        setCustomers(customerData);
        setSerials(serialData);
      })
      .catch(err => {
        console.error(err);
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoading(false));
  }, []);

  const serialsByCustomer = new Map<number, SerialWithCustomer[]>();
  serials.forEach(s => {
    const customerId = s.customer?.id ?? s.customer_id;
    if (!customerId) return;
    const list = serialsByCustomer.get(customerId) || [];
    list.push(s);
    serialsByCustomer.set(customerId, list);
  });

  const query = search.trim().toLowerCase();
  const filteredCustomers = customers
    .filter(customer => {
      if (!query) return true;
      return [
        customer.name,
        customer.email,
        customer.phone,
        customer.dealer,
        customer.sales_manager,
      ].some(value => (value || '').toLowerCase().includes(query));
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const setField = <K extends keyof CustomerInput>(key: K, value: CustomerInput[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  const openCreate = () => {
    setForm(EMPTY_CUSTOMER);
    setFormError('');
    setShowCreate(true);
  };

  const closeCreate = () => {
    if (saving) return;
    setShowCreate(false);
    setFormError('');
  };

  const handleCreate = async () => {
    if (!form.name.trim()) {
      setFormError(t(lang, 'customer_name_required'));
      return;
    }

    setSaving(true);
    setFormError('');
    try {
      const created = await window.electronAPI.createCustomer({
        name: form.name.trim(),
        email: form.email?.trim() ?? '',
        phone: form.phone?.trim() ?? '',
        address: form.address?.trim() ?? '',
        dealer: form.dealer?.trim() ?? '',
        sales_manager: form.sales_manager?.trim() ?? '',
        notes: form.notes?.trim() ?? '',
      });
      setCustomers(prev => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setShowCreate(false);
      setForm(EMPTY_CUSTOMER);
    } catch (err: any) {
      setFormError(err?.message ?? t(lang, 'save_fail'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>{t(lang, 'loading')}</div>;
  }

  return (
    <div className="page-wrapper">
      {/* Header */}
      <div className="page-header">
        <div>
          <div className="page-title">{t(lang, 'nav_customers')}</div>
          <div className="page-subtitle">{t(lang, 'page_subtitle_customers').replace('{n}', String(customers.length))}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
          <button onClick={openCreate} style={primaryBtn}>{t(lang, 'customer_add')}</button>
        </div>
      </div>

      {error && (
        <div style={{ marginBottom: 12, padding: 12, border: '1px solid var(--red)', borderRadius: 7, color: 'var(--red)', fontSize: 12 }}>
          {error}
        </div>
      )}

      {/* Customer grid */}
      <div className="card-grid">
        {filteredCustomers.map(customer => {
          const cSerials = serialsByCustomer.get(customer.id) || [];
          const active    = cSerials.filter(s => s.status === 'active').length;
          const cancelled = cSerials.filter(s => s.status === 'cancelled').length;
          const expired   = cSerials.filter(s => s.status === 'expired').length;
          const name      = customer.name || '(unknown)';
          const manager   = customer.sales_manager || '';
          const email     = customer.email || '';
          const phone     = customer.phone || '';

          return (
            <div key={customer.id} className="card">
              {/* Avatar + name */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <div style={{
                  width: 34, height: 34, borderRadius: 8, flexShrink: 0,
                  background: 'var(--bg4)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 14, fontWeight: 600, color: 'var(--accent)',
                }}>
                  {name.charAt(0)}
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

      {filteredCustomers.length === 0 && (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
          {t(lang, 'no_data')}
        </div>
      )}

      {showCreate && (
        <div style={overlay}>
          <div style={modal}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--text)' }}>
                {t(lang, 'customer_add_title')}
              </h2>
              <button onClick={closeCreate} disabled={saving} style={closeBtn}>✕</button>
            </div>

            {formError && <div style={errorBox}>{formError}</div>}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>{t(lang, 'label_customer_name')} <span style={{ color: '#fc8181' }}>*</span></label>
                <input value={form.name} onChange={e => setField('name', e.target.value)} style={inputStyle} autoFocus />
              </div>
              <div>
                <label style={labelStyle}>{t(lang, 'label_email')}</label>
                <input value={form.email ?? ''} onChange={e => setField('email', e.target.value)} style={inputStyle} placeholder="example@email.com" />
              </div>
              <div>
                <label style={labelStyle}>{t(lang, 'label_phone')}</label>
                <input value={form.phone ?? ''} onChange={e => setField('phone', e.target.value)} style={inputStyle} placeholder="010-0000-0000" />
              </div>
              <div>
                <label style={labelStyle}>{t(lang, 'label_dealer')}</label>
                <input value={form.dealer ?? ''} onChange={e => setField('dealer', e.target.value)} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>{t(lang, 'label_manager')}</label>
                <input value={form.sales_manager ?? ''} onChange={e => setField('sales_manager', e.target.value)} style={inputStyle} />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>{t(lang, 'label_address')}</label>
                <input value={form.address ?? ''} onChange={e => setField('address', e.target.value)} style={inputStyle} />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>{t(lang, 'label_notes')}</label>
                <textarea value={form.notes ?? ''} onChange={e => setField('notes', e.target.value)} style={{ ...inputStyle, height: 72, resize: 'vertical' }} />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
              <button onClick={closeCreate} disabled={saving} style={secondaryBtn}>{t(lang, 'cancel')}</button>
              <button onClick={handleCreate} disabled={saving} style={primaryBtn}>
                {saving ? t(lang, 'saving') : t(lang, 'save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const primaryBtn: React.CSSProperties = {
  padding: '7px 14px',
  borderRadius: 7,
  background: 'var(--accent)',
  color: '#0d1117',
  border: 'none',
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: 12.5,
};

const secondaryBtn: React.CSSProperties = {
  padding: '8px 18px',
  borderRadius: 6,
  background: 'var(--bg3)',
  border: '1px solid var(--border2)',
  cursor: 'pointer',
  fontSize: 13,
  color: 'var(--text)',
};

const overlay: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.65)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
};

const modal: React.CSSProperties = {
  background: 'var(--bg2)',
  borderRadius: 12,
  width: 560,
  padding: '22px 26px',
  boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
  border: '1px solid var(--border2)',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--text2)',
  marginBottom: 5,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '7px 10px',
  border: '1px solid var(--border2)',
  borderRadius: 6,
  fontSize: 13,
  boxSizing: 'border-box',
  background: 'var(--bg3)',
  color: 'var(--text)',
};

const errorBox: React.CSSProperties = {
  background: 'rgba(220,38,38,0.15)',
  border: '1px solid rgba(220,38,38,0.4)',
  borderRadius: 6,
  padding: '8px 12px',
  color: '#fc8181',
  fontSize: 13,
  marginBottom: 12,
};

const closeBtn: React.CSSProperties = {
  border: 'none',
  background: 'none',
  fontSize: 18,
  cursor: 'pointer',
  color: 'var(--text3)',
};
