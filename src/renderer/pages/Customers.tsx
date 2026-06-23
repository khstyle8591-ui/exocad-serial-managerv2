import React, { useEffect, useState } from 'react';
import { useLang } from '../App';
import { t } from '../i18n';
import type { Customer, CustomerInput, CustomerPortalInfo, CustomerSerialSummary, SerialWithCustomer } from '../../shared/types';
import { api } from '../client';

const EMPTY_CUSTOMER: CustomerInput = {
  name: '',
  email: '',
  phone: '',
  address: '',
  dealer: '',
  sales_manager: '',
  notes: '',
};

const normalizeCustomerText = (value: string) =>
  value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();

export default function Customers() {
  const { lang } = useLang();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [serialSummaries, setSerialSummaries] = useState<CustomerSerialSummary[]>([]);
  const [portalInfos, setPortalInfos] = useState<CustomerPortalInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch]   = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [serialPopupCustomer, setSerialPopupCustomer] = useState<Customer | null>(null);
  const [serialPopupList, setSerialPopupList] = useState<SerialWithCustomer[]>([]);
  const [form, setForm] = useState<CustomerInput>(EMPTY_CUSTOMER);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      api.listCustomers(),
      api.listCustomerSerialSummaries(),
      api.listCustomerPortalInfo(),
    ])
      .then(([customerData, summaryData, portalInfoData]) => {
        setCustomers(customerData);
        setSerialSummaries(summaryData);
        setPortalInfos(portalInfoData);
      })
      .catch(err => {
        console.error(err);
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoading(false));
  }, []);

  const summariesByCustomer = new Map(serialSummaries.map(summary => [summary.customer_id, summary]));
  const portalInfoByCustomer = new Map(portalInfos.map(info => [info.customer_id, info]));

  const query = normalizeCustomerText(search);
  const filteredCustomers = customers
    .filter(customer => {
      if (!query) return true;
      return [
        customer.name,
        customer.email,
        customer.phone,
        customer.dealer,
        customer.sales_manager,
      ].some(value => normalizeCustomerText(value || '').includes(query));
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const setField = <K extends keyof CustomerInput>(key: K, value: CustomerInput[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  const openCreate = () => {
    setForm(EMPTY_CUSTOMER);
    setFormError('');
    setEditingCustomer(null);
    setShowCreate(true);
  };

  const openEdit = (customer: Customer) => {
    setForm({
      name: customer.name ?? '',
      email: customer.email ?? '',
      phone: customer.phone ?? '',
      address: customer.address ?? '',
      dealer: customer.dealer ?? '',
      sales_manager: customer.sales_manager ?? '',
      notes: customer.notes ?? '',
    });
    setFormError('');
    setShowCreate(false);
    setEditingCustomer(customer);
  };

  const openSerialPopup = async (customer: Customer) => {
    setSerialPopupCustomer(customer);
    const all = await api.getSerials() as SerialWithCustomer[];
    setSerialPopupList(all.filter(s => s.customer_id === customer.id));
  };

  const closeSerialPopup = () => {
    setSerialPopupCustomer(null);
    setSerialPopupList([]);
  };

  const closeForm = () => {
    if (saving) return;
    setShowCreate(false);
    setEditingCustomer(null);
    setFormError('');
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      setFormError(t(lang, 'customer_name_required'));
      return;
    }

    setSaving(true);
    setFormError('');
    try {
      const input = {
        name: form.name.trim(),
        email: form.email?.trim() ?? '',
        phone: form.phone?.trim() ?? '',
        address: form.address?.trim() ?? '',
        dealer: form.dealer?.trim() ?? '',
        sales_manager: form.sales_manager?.trim() ?? '',
        notes: form.notes?.trim() ?? '',
      };

      if (editingCustomer) {
        const updated = await api.updateCustomer(editingCustomer.id, input);
        if (!updated) throw new Error(t(lang, 'save_fail'));
        setCustomers(prev => prev.map(c => c.id === updated.id ? updated : c).sort((a, b) => a.name.localeCompare(b.name)));
      } else {
        const created = await api.createCustomer(input);
        setCustomers(prev => {
          const withoutDuplicate = prev.filter(c => c.id !== created.id);
          return [...withoutDuplicate, created].sort((a, b) => a.name.localeCompare(b.name));
        });
      }
      setShowCreate(false);
      setEditingCustomer(null);
      setForm(EMPTY_CUSTOMER);
    } catch (err: any) {
      setFormError(err?.message ?? t(lang, 'save_fail'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (customer: Customer, linkedCount: number) => {
    if (linkedCount > 0) {
      setError(t(lang, 'customer_delete_blocked').replace('{n}', String(linkedCount)));
      return;
    }
    if (!confirm(t(lang, 'customer_delete_confirm').replace('{name}', customer.name))) return;

    setError('');
    try {
      const result = await api.deleteCustomer(customer.id);
      if (!result.success) throw new Error(result.error ?? t(lang, 'delete_failed'));
      setCustomers(prev => prev.filter(c => c.id !== customer.id));
    } catch (err: any) {
      setError(err?.message ?? t(lang, 'delete_failed'));
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
          const summary = summariesByCustomer.get(customer.id);
          const total     = summary?.total ?? 0;
          const active    = summary?.active ?? 0;
          const cancelled = summary?.cancelled ?? 0;
          const expired   = summary?.expired ?? 0;
          const notActivated = summary?.not_activated ?? 0;
          const broken = summary?.broken ?? 0;
          const name      = customer.name || '(unknown)';
          const manager   = customer.sales_manager || '';
          const email     = customer.email || '';
          const phone     = customer.phone || '';
          const address   = customer.address || '';
          const portalLoginId = portalInfoByCustomer.get(customer.id)?.login_id || '';

          return (
            <div key={customer.id} className="card">
              {/* Clickable info area */}
              <div onClick={() => openSerialPopup(customer)} style={{ cursor: 'pointer' }}>
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
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>{t(lang, 'label_license_count').replace('{n}', String(total))}</div>
                </div>
              </div>

              {/* Contact info */}
              {(manager || phone || address || portalLoginId) && (
                <div style={{ marginBottom: 10, fontSize: 11.5, color: 'var(--text2)' }}>
                  {manager && <div>{manager}</div>}
                  {phone   && <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: 'var(--text3)' }}>{phone}</div>}
                  {email   && <div style={{ fontSize: 11, color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{email}</div>}
                  {address && <div style={{ fontSize: 11, color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{address}</div>}
                  {portalLoginId && (
                    <div style={{ fontSize: 11, color: 'var(--accent)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t(lang, 'label_portal_login_id')}: {portalLoginId}
                    </div>
                  )}
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
                {notActivated > 0 && (
                  <span style={{
                    fontSize: 11, color: 'var(--yellow)', background: 'var(--yellow-dim)',
                    padding: '2px 8px', borderRadius: 4, border: '1px solid rgba(245,194,107,0.3)',
                  }}>
                    {t(lang, 'status_not_activated')} {notActivated}
                  </span>
                )}
                {broken > 0 && (
                  <span style={{
                    fontSize: 11, color: 'var(--purple)', background: 'var(--purple-dim)',
                    padding: '2px 8px', borderRadius: 4, border: '1px solid rgba(167,139,250,0.3)',
                  }}>
                    {t(lang, 'status_broken')} {broken}
                  </span>
                )}
              </div>
              </div>{/* end clickable area */}

              <div style={{ display: 'flex', gap: 6, marginTop: 14, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                <button onClick={() => openEdit(customer)} style={smallActionBtn}>{t(lang, 'edit')}</button>
                <button
                  onClick={() => handleDelete(customer, total)}
                  disabled={total > 0}
                  title={total > 0 ? t(lang, 'customer_delete_blocked').replace('{n}', String(total)) : t(lang, 'delete')}
                  style={{
                    ...smallActionBtn,
                    color: total > 0 ? 'var(--text3)' : 'var(--red)',
                    cursor: total > 0 ? 'not-allowed' : 'pointer',
                    opacity: total > 0 ? 0.55 : 1,
                  }}
                >
                  {t(lang, 'delete')}
                </button>
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

      {(showCreate || editingCustomer) && (
        <div style={overlay}>
          <div style={modal}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--text)' }}>
                {editingCustomer ? t(lang, 'customer_edit_title') : t(lang, 'customer_add_title')}
              </h2>
              <button onClick={closeForm} disabled={saving} style={closeBtn}>✕</button>
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
              {editingCustomer && (() => {
                const portalInfo = portalInfoByCustomer.get(editingCustomer.id);
                return (
                  <>
                    <div>
                      <label style={labelStyle}>{t(lang, 'label_portal_login_id')}</label>
                      <input value={portalInfo?.login_id || t(lang, 'label_portal_not_linked')} disabled style={{ ...inputStyle, color: 'var(--text3)' }} />
                    </div>
                    <div>
                      <label style={labelStyle}>{t(lang, 'label_portal_exocad_id')}</label>
                      <input value={portalInfo?.exocad_id || t(lang, 'label_portal_not_linked')} disabled style={{ ...inputStyle, color: 'var(--text3)' }} />
                    </div>
                  </>
                );
              })()}
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>{t(lang, 'label_notes')}</label>
                <textarea value={form.notes ?? ''} onChange={e => setField('notes', e.target.value)} style={{ ...inputStyle, height: 72, resize: 'vertical' }} />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
              <button onClick={closeForm} disabled={saving} style={secondaryBtn}>{t(lang, 'cancel')}</button>
              <button onClick={handleSave} disabled={saving} style={primaryBtn}>
                {saving ? t(lang, 'saving') : t(lang, 'save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {serialPopupCustomer && (
        <div style={overlay}>
          <div style={{
            ...modal,
            maxWidth: 660,
            width: '90vw',
            maxHeight: '80vh',
            display: 'flex',
            flexDirection: 'column',
            padding: 0,
          }}>
            {/* 헤더 — 고정 */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 22px 14px', flexShrink: 0, borderBottom: '1px solid var(--border)' }}>
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
                {serialPopupCustomer.name} — {t(lang, 'customer_serials_title')}
              </h2>
              <button onClick={closeSerialPopup} style={closeBtn}>✕</button>
            </div>

            {/* 본문 — 스크롤 */}
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {serialPopupList.length === 0 ? (
                <p style={{ color: 'var(--text3)', fontSize: 13, padding: '16px 22px' }}>{t(lang, 'customer_no_serials')}</p>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: 'var(--bg3)', textAlign: 'left', position: 'sticky', top: 0 }}>
                      <th style={{ padding: '8px 12px', fontWeight: 600 }}>{t(lang, 'label_serial_number')}</th>
                      <th style={{ padding: '8px 12px', fontWeight: 600 }}>{t(lang, 'label_main_product')}</th>
                      <th style={{ padding: '8px 12px', fontWeight: 600 }}>{t(lang, 'col_status')}</th>
                      <th style={{ padding: '8px 12px', fontWeight: 600 }}>{t(lang, 'col_expiry_date')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {serialPopupList.map(s => (
                      <tr key={s.id} style={{ borderTop: '1px solid var(--border)' }}>
                        <td style={{ padding: '8px 12px', fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>{s.serial_number}</td>
                        <td style={{ padding: '8px 12px' }}>{s.main_product || '—'}</td>
                        <td style={{ padding: '8px 12px' }}>{s.status}</td>
                        <td style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text2)' }}>{s.expiry_date?.slice(0, 10) ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* 푸터 — 고정 */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '12px 22px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
              <button onClick={closeSerialPopup} style={secondaryBtn}>{t(lang, 'close')}</button>
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

const smallActionBtn: React.CSSProperties = {
  padding: '5px 9px',
  borderRadius: 6,
  background: 'var(--bg3)',
  border: '1px solid var(--border2)',
  cursor: 'pointer',
  fontSize: 11.5,
  color: 'var(--text2)',
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
