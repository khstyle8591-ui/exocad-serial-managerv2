import React, { useState, useEffect } from 'react';
import type { AppSettings, CustomerInput, Serial, SerialInput, SerialWithCustomer } from '../../shared/types';
import CustomerAutocomplete, { type CustomerChoice } from './CustomerAutocomplete';
import ModuleListEditor from './ModuleListEditor';
import { useLang } from '../App';
import { t } from '../i18n';
import { api } from '../client';

interface Props {
  mode: 'create' | 'edit';
  initial?: SerialWithCustomer;
  onSaved: (serial: SerialWithCustomer) => void;
  onClose: () => void;
}

interface FormState {
  serial_number: string;
  purchase_date: string;
  expiry_date: string;
  status: Serial['status'];
  engine_build: string;
  version: string;
  main_product: string;
  modules: string[];
  notes: string;
  renewal_stop_requested: boolean;
}

interface CustomerFields {
  email: string;
  phone: string;
  address: string;
  dealer: string;
  sales_manager: string;
}

interface CustomerConflict {
  existing: {
    id: number;
    name: string;
    email?: string;
    phone?: string;
    dealer?: string;
    sales_manager?: string;
    address?: string;
  };
  incoming: {
    name: string;
    email?: string;
    phone?: string;
    dealer?: string;
    sales_manager?: string;
    address?: string;
  };
}

type CustomerResolution = 'merge' | 'separate';

const EMPTY_CUST: CustomerFields = { email: '', phone: '', address: '', dealer: '', sales_manager: '' };
const STATUSES = ['active', 'not-activated', 'expired', 'cancelled', 'broken'] as const;
const STATUS_LABEL_KEYS: Record<Serial['status'], Parameters<typeof t>[1]> = {
  active: 'status_active',
  'not-activated': 'status_not_activated',
  expired: 'status_expired',
  cancelled: 'status_cancelled',
  broken: 'status_broken',
};

const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);
const norm = (value: unknown) => String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();

export default function SerialForm({ mode, initial, onSaved, onClose }: Props) {
  const { lang } = useLang();

  const [customer, setCustomer] = useState<CustomerChoice | null>(
    initial?.customer ? { kind: 'existing', customer: initial.customer } : null
  );
  const [custFields, setCustFields] = useState<CustomerFields>(
    initial?.customer
      ? {
          email:         initial.customer.email ?? '',
          phone:         initial.customer.phone ?? '',
          address:       initial.customer.address ?? '',
          dealer:        initial.customer.dealer ?? '',
          sales_manager: initial.customer.sales_manager ?? '',
        }
      : EMPTY_CUST
  );

  const [form, setForm] = useState<FormState>({
    serial_number:          initial?.serial_number ?? '',
    purchase_date:          initial?.purchase_date?.slice(0, 10) ?? '',
    expiry_date:            initial?.expiry_date?.slice(0, 10) ?? '',
    status:                 initial?.status ?? 'not-activated',
    engine_build:           initial?.engine_build ?? '',
    version:                initial?.version ?? '',
    main_product:           initial?.main_product ?? '',
    modules:                (() => { try { return JSON.parse(initial?.modules ?? '[]'); } catch { return []; } })(),
    notes:                  initial?.notes ?? '',
    renewal_stop_requested: (initial?.renewal_stop_requested ?? 0) === 1,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState<CustomerConflict | null>(null);
  const [productList, setProductList] = useState<string[]>([]);

  useEffect(() => {
    api.getSettings().then(raw => {
      const s = raw as AppSettings;
      if (Array.isArray(s.product_list) && s.product_list.length > 0) {
        setProductList(s.product_list as string[]);
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (customer?.kind === 'existing') {
      const c = customer.customer;
      setCustFields({
        email:         c.email ?? '',
        phone:         c.phone ?? '',
        address:       c.address ?? '',
        dealer:        c.dealer ?? '',
        sales_manager: c.sales_manager ?? '',
      });
    } else if (customer?.kind === 'new') {
      setCustFields(EMPTY_CUST);
    }
  }, [customer?.kind === 'existing' ? customer.customer.id : customer?.kind]);

  const setF = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm(prev => ({ ...prev, [k]: v }));

  const setCF = (k: keyof CustomerFields, v: string) =>
    setCustFields(prev => ({ ...prev, [k]: v }));

  const hasCustomerChanges = () => {
    if (customer?.kind !== 'existing') return false;
    const c = customer.customer;
    return custFields.email !== (c.email ?? '')
      || custFields.phone !== (c.phone ?? '')
      || custFields.address !== (c.address ?? '')
      || custFields.dealer !== (c.dealer ?? '')
      || custFields.sales_manager !== (c.sales_manager ?? '');
  };

  const incomingCustomer = () => ({
    name: customer?.kind === 'existing' ? customer.customer.name : customer?.name ?? '',
    email: custFields.email,
    phone: custFields.phone,
    address: custFields.address,
    dealer: custFields.dealer,
    sales_manager: custFields.sales_manager,
  });

  const fieldsDiffer = (a: CustomerConflict['incoming'], b: CustomerConflict['existing']) =>
    norm(a.name) !== norm(b.name)
    || norm(a.email) !== norm(b.email)
    || norm(a.phone) !== norm(b.phone)
    || norm(a.address) !== norm(b.address)
    || norm(a.dealer) !== norm(b.dealer)
    || norm(a.sales_manager) !== norm(b.sales_manager);

  const findCustomerConflict = async (): Promise<CustomerConflict | null> => {
    if (!customer) return null;
    const incoming = incomingCustomer();
    if (customer.kind === 'existing') {
      if (!hasCustomerChanges()) return null;
      return { existing: customer.customer, incoming };
    }

    const candidates = await api.getCustomerMergeCandidates({
      name: incoming.name,
      email: incoming.email,
      phone: incoming.phone,
      dealer: incoming.dealer,
    }) as { customer: CustomerConflict['existing'] }[];
    const candidate = candidates.find(c => fieldsDiffer(incoming, c.customer));
    return candidate ? { existing: candidate.customer, incoming } : null;
  };

  const submit = async (resolution?: CustomerResolution, mergeTargetId?: number) => {
    if (!customer) { setError(t(lang, 'err_select_customer')); return; }
    if (!form.serial_number.trim()) { setError(t(lang, 'err_serial_required')); return; }

    setSaving(true);
    setError('');
    try {
      if (!resolution) {
        const nextConflict = await findCustomerConflict();
        if (nextConflict) {
          setConflict(nextConflict);
          setSaving(false);
          return;
        }
      }

      if (customer.kind === 'existing' && resolution !== 'separate') {
        const c = customer.customer;
        const changed: Partial<CustomerInput> = {};
        if (custFields.email         !== (c.email ?? ''))         changed.email         = custFields.email;
        if (custFields.phone         !== (c.phone ?? ''))         changed.phone         = custFields.phone;
        if (custFields.address       !== (c.address ?? ''))       changed.address       = custFields.address;
        if (custFields.dealer        !== (c.dealer ?? ''))        changed.dealer        = custFields.dealer;
        if (custFields.sales_manager !== (c.sales_manager ?? '')) changed.sales_manager = custFields.sales_manager;
        if (Object.keys(changed).length > 0) {
          await api.updateCustomer(c.id, changed);
        }
      }

      const forceSeparate = resolution === 'separate';
      const forceMerge = resolution === 'merge' && mergeTargetId != null;
      if (customer.kind === 'new' && forceMerge) {
        const incoming = incomingCustomer();
        await api.updateCustomer(mergeTargetId, incoming);
      }
      const customerPart = customer.kind === 'existing' && !forceSeparate
        ? { customer_id: customer.customer.id }
        : forceMerge
          ? {
              customer_id: mergeTargetId,
              customer_name: incomingCustomer().name,
              customer_email: custFields.email,
              customer_phone: custFields.phone,
              customer_address: custFields.address,
              dealer: custFields.dealer,
              customer_manager: custFields.sales_manager,
              customer_resolution: 'merge' as const,
              customer_merge_target_id: mergeTargetId,
            }
        : {
            customer_name:    customer.kind === 'existing' ? customer.customer.name : customer.name,
            customer_email:   custFields.email,
            customer_phone:   custFields.phone,
            customer_address: custFields.address,
            dealer:           custFields.dealer,
            customer_manager: custFields.sales_manager,
            ...(forceSeparate ? { customer_resolution: 'separate' as const } : {}),
          };

      const input: SerialInput = {
        ...customerPart,
        serial_number: form.serial_number.trim(),
        purchase_date: form.purchase_date || undefined,
        expiry_date:   form.expiry_date   || null,
        status:        form.status,
        engine_build:  form.engine_build,
        version:       form.version,
        main_product:  form.main_product,
        modules:       form.modules,
        notes:         form.notes,
      };

      let result: SerialWithCustomer;
      if (mode === 'create') {
        result = await api.createSerial(input);
      } else {
        result = (await api.updateSerial(initial!.id, input))!;
      }

      if (mode === 'edit' && initial) {
        const wasStop = (initial.renewal_stop_requested ?? 0) === 1;
        if (wasStop !== form.renewal_stop_requested) {
          await api.setStopRequested(initial.id, form.renewal_stop_requested);
        }
      }

      onSaved(result);
      setConflict(null);
    } catch (e: unknown) {
      setError(getErrorMessage(e) || t(lang, 'save_fail'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={overlay}>
      <div style={modal}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--text)' }}>
            {mode === 'create' ? t(lang, 'form_title_new') : t(lang, 'form_title_edit')}
          </h2>
          <button onClick={onClose} style={closeBtn}>✕</button>
        </div>

        {error && <div style={errorBox}>{error}</div>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto', maxHeight: 560 }}>

          <div>
            <label style={labelStyle}>{t(lang, 'label_customer')} <span style={{ color: '#fc8181' }}>*</span></label>
            <CustomerAutocomplete value={customer} onChange={setCustomer} />
          </div>

          {customer && (
            <div style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 8, padding: '12px 14px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {t(lang, 'section_customer_info')}
                {customer.kind === 'existing' && (
                  <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--text3)', fontWeight: 400, textTransform: 'none' }}>
                    {t(lang, 'customer_edit_immediate_note')}
                  </span>
                )}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={labelStyle}>{t(lang, 'label_email')}</label>
                  <input value={custFields.email} onChange={e => setCF('email', e.target.value)} style={inputStyle} placeholder="example@email.com" />
                </div>
                <div>
                  <label style={labelStyle}>{t(lang, 'label_phone')}</label>
                  <input value={custFields.phone} onChange={e => setCF('phone', e.target.value)} style={inputStyle} placeholder="010-0000-0000" />
                </div>
                <div>
                  <label style={labelStyle}>{t(lang, 'label_dealer')}</label>
                  <input value={custFields.dealer} onChange={e => setCF('dealer', e.target.value)} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>{t(lang, 'label_manager')}</label>
                  <input value={custFields.sales_manager} onChange={e => setCF('sales_manager', e.target.value)} style={inputStyle} />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={labelStyle}>{t(lang, 'label_address')}</label>
                  <input value={custFields.address} onChange={e => setCF('address', e.target.value)} style={inputStyle} />
                </div>
              </div>
            </div>
          )}

          <div>
            <label style={labelStyle}>{t(lang, 'label_serial_number')} <span style={{ color: '#fc8181' }}>*</span></label>
            <input
              value={form.serial_number}
              onChange={e => setF('serial_number', e.target.value)}
              disabled={mode === 'edit'}
              style={{ ...inputStyle, background: mode === 'edit' ? 'var(--bg4)' : 'var(--bg3)', opacity: mode === 'edit' ? 0.7 : 1 }}
              placeholder="XXXXXXXXXX"
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>{t(lang, 'label_purchase_date')}</label>
              <input type="date" value={form.purchase_date} onChange={e => setF('purchase_date', e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>{t(lang, 'label_expiry_date')}</label>
              <input type="date" value={form.expiry_date} onChange={e => setF('expiry_date', e.target.value)} style={inputStyle} />
            </div>
          </div>

          <div>
            <label style={labelStyle}>{t(lang, 'label_status')}</label>
            <select value={form.status} onChange={e => setF('status', e.target.value as Serial['status'])} style={inputStyle}>
              {STATUSES.map(s => <option key={s} value={s}>{t(lang, STATUS_LABEL_KEYS[s])}</option>)}
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>{t(lang, 'label_engine_build')}</label>
              <input value={form.engine_build} onChange={e => setF('engine_build', e.target.value)} style={inputStyle} placeholder="3.1.0.1754" />
            </div>
            <div>
              <label style={labelStyle}>{t(lang, 'label_version')}</label>
              <input value={form.version} onChange={e => setF('version', e.target.value)} style={inputStyle} placeholder="3.1 ChairsideCAD" />
            </div>
            <div>
              <label style={labelStyle}>{t(lang, 'label_main_product')}</label>
              <input
                value={form.main_product}
                onChange={e => setF('main_product', e.target.value)}
                style={inputStyle}
                list={productList.length > 0 ? 'product-list-options' : undefined}
              />
              {productList.length > 0 && (
                <datalist id="product-list-options">
                  {productList.map(p => <option key={p} value={p} />)}
                </datalist>
              )}
            </div>
          </div>

          <div>
            <label style={labelStyle}>{t(lang, 'label_modules')}</label>
            <ModuleListEditor modules={form.modules} onChange={v => setF('modules', v)} />
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', color: 'var(--text)' }}>
            <input
              type="checkbox"
              checked={form.renewal_stop_requested}
              onChange={e => setF('renewal_stop_requested', e.target.checked)}
            />
            <span>{t(lang, 'label_renewal_stop')}</span>
            {form.renewal_stop_requested && (
              <span style={{ fontSize: 11, color: '#fc8181', fontWeight: 600 }}>{t(lang, 'label_renewal_stop_warn')}</span>
            )}
          </label>

          <div>
            <label style={labelStyle}>{t(lang, 'label_notes')}</label>
            <textarea value={form.notes} onChange={e => setF('notes', e.target.value)} style={{ ...inputStyle, height: 60, resize: 'vertical' }} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
          <button onClick={onClose} disabled={saving} style={cancelBtn}>{t(lang, 'cancel')}</button>
          <button onClick={() => submit()} disabled={saving} style={saveBtn}>
            {saving ? t(lang, 'saving') : mode === 'create' ? t(lang, 'btn_register') : t(lang, 'save')}
          </button>
        </div>
      </div>

      {conflict && (
        <div style={overlay}>
          <div style={{ ...modal, width: 520 }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 16, color: 'var(--text)' }}>{t(lang, 'customer_conflict_title')}</h3>
            <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--text2)', lineHeight: 1.5 }}>
              {t(lang, 'customer_conflict_message')}
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <CustomerCompareBox title={t(lang, 'customer_conflict_existing')} data={conflict.existing} />
              <CustomerCompareBox title={t(lang, 'customer_conflict_incoming')} data={conflict.incoming} />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
              <button onClick={() => setConflict(null)} disabled={saving} style={cancelBtn}>{t(lang, 'cancel')}</button>
              <button onClick={() => submit('separate')} disabled={saving} style={cancelBtn}>{t(lang, 'customer_conflict_create_separate')}</button>
              <button onClick={() => submit('merge', conflict.existing.id)} disabled={saving} style={saveBtn}>{t(lang, 'customer_conflict_overwrite')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CustomerCompareBox({ title, data }: { title: string; data: CustomerConflict['incoming'] }) {
  const rows = [
    ['Name', data.name],
    ['Email', data.email],
    ['Phone', data.phone],
    ['Dealer', data.dealer],
    ['Manager', data.sales_manager],
  ];
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12, background: 'var(--bg3)' }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>{title}</div>
      {rows.map(([label, value]) => (
        <div key={label} style={{ display: 'grid', gridTemplateColumns: '64px 1fr', gap: 6, fontSize: 11.5, marginBottom: 5 }}>
          <span style={{ color: 'var(--text3)' }}>{label}</span>
          <span style={{ color: 'var(--text2)', overflowWrap: 'anywhere' }}>{value || '-'}</span>
        </div>
      ))}
    </div>
  );
}

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
};
const modal: React.CSSProperties = {
  background: 'var(--bg2)', borderRadius: 12, width: 640, padding: '24px 28px',
  boxShadow: '0 20px 60px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column',
  maxHeight: '92vh', border: '1px solid var(--border2)',
};
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text2)', marginBottom: 5,
};
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '7px 10px', border: '1px solid var(--border2)', borderRadius: 6,
  fontSize: 13, boxSizing: 'border-box', background: 'var(--bg3)', color: 'var(--text)',
};
const errorBox: React.CSSProperties = {
  background: 'rgba(220,38,38,0.15)', border: '1px solid rgba(220,38,38,0.4)', borderRadius: 6,
  padding: '8px 12px', color: '#fc8181', fontSize: 13, marginBottom: 12,
};
const saveBtn: React.CSSProperties = {
  padding: '8px 22px', borderRadius: 6, background: 'var(--accent)', color: '#0d1117',
  border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 13,
};
const cancelBtn: React.CSSProperties = {
  padding: '8px 18px', borderRadius: 6, background: 'var(--bg3)',
  border: '1px solid var(--border2)', cursor: 'pointer', fontSize: 13, color: 'var(--text)',
};
const closeBtn: React.CSSProperties = {
  border: 'none', background: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--text3)',
};
