import React, { useEffect, useState } from 'react';
import { useLang } from '../App';
import { t } from '../i18n';
import type { Language } from '../i18n';
import { api } from '../client';

import type { PendingOrder, Serial, SerialWithCustomer } from '../../shared/types';

type FilterType = 'pending' | 'approved' | 'rejected' | 'all';
type PollNowResult = { found: number; errors: string[] };
type ApproveResult = { success: boolean; error?: string };
type UpdateDataResult = { success: boolean; data?: SerialWithCustomer; error?: string };

const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

export default function Orders() {
  const { lang } = useLang();
  const [orders, setOrders] = useState<PendingOrder[]>([]);
  const [filter, setFilter] = useState<FilterType>('pending');
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState(false);
  const [editOrder, setEditOrder] = useState<{ order: PendingOrder, mode: 'register' | 'update' } | null>(null);
  const [rawModal, setRawModal] = useState<PendingOrder | null>(null);
  const [pollMsg, setPollMsg] = useState('');

  useEffect(() => { loadOrders(); }, []);

  const loadOrders = async () => {
    try {
      const data = await api.getOrders() as PendingOrder[];
      setOrders(data || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const handlePollNow = async () => {
    setPolling(true);
    setPollMsg(t(lang, 'orders_polling'));
    try {
      const result = await api.pollNow() as PollNowResult;
      setPollMsg(`${t(lang, 'orders_poll_done')}${result.found}${t(lang, 'orders_poll_unit')}`);
      if (result.errors?.length > 0) alert(t(lang, 'orders_poll_errors') + result.errors.join('\n'));
      loadOrders();
    } catch (e: unknown) {
      setPollMsg(`${t(lang, 'orders_poll_error')}${getErrorMessage(e)}`);
    } finally {
      setPolling(false);
    }
  };

  // register 기능을 edit & register로 강제하여 기존 직접 승인 제거
  const handleReject = async (id: number) => {
    if (!confirm(t(lang, 'orders_confirm_reject'))) return;
    await api.rejectOrder(id);
    loadOrders();
  };

  const handleDelete = async (id: number) => {
    if (!confirm(t(lang, 'orders_confirm_delete'))) return;
    await api.deleteOrder(id);
    loadOrders();
  };

  const handleEditSave = async (updated: PendingOrder, mode: 'register' | 'update') => {
    try {
      if (mode === 'register') {
        await api.updateOrder(updated.id, updated);
        const res = await api.approveOrder(updated.id, { serial_status: updated.serial_status }) as ApproveResult;
        if (res.success) {
          alert(t(lang, 'orders_approve_success'));
        } else {
          alert(`${t(lang, 'orders_approve_fail')}${res.error}`);
        }
      } else if (mode === 'update') {
        const res = await api.updateDataOrder(updated.id, updated) as UpdateDataResult;
        if (res.success) {
          const d = res.data;
          if (!d) throw new Error(t(lang, 'orders_update_fail').replace('{error}', 'missing data'));
          alert(t(lang, 'orders_update_success')
            .replace('{serial}', d.serial_number)
            .replace('{customer}', d.customer.name)
            .replace('{version}', d.version)
            .replace('{expiry}', d.expiry_date ?? ''));
        } else {
          alert(t(lang, 'orders_update_fail').replace('{error}', res.error));
        }
      }
    } catch (e: unknown) {
      alert(getErrorMessage(e));
    }
    setEditOrder(null);
    loadOrders();
  };

  const filtered = orders.filter(o => filter === 'all' ? true : o.status === filter);
  const pendingCount = orders.filter(o => o.status === 'pending').length;

  const statusLabel = (s: string) =>
    s === 'pending' ? t(lang, 'orders_status_pending') :
      s === 'approved' ? t(lang, 'orders_status_approved') :
        t(lang, 'orders_status_rejected');

  const statusColor = (s: string) =>
    s === 'pending' ? 'var(--yellow)' : s === 'approved' ? 'var(--green)' : 'var(--red)';

  const typeLabel = (tp: string) =>
    tp === 'new' ? t(lang, 'orders_type_new') :
      tp === 'renewal' ? t(lang, 'orders_type_renewal') :
        t(lang, 'orders_type_addon');

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}>{t(lang, 'loading')}</div>;

  return (
    <div>
      {/* ── Header ── */}
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1 className="page-title">{t(lang, 'page_title_orders')}</h1>
          {pendingCount > 0 && (
            <span style={{ background: 'var(--red)', color: 'var(--bg)', borderRadius: 12, padding: '2px 10px', fontSize: 13, fontWeight: 700 }}>
              {pendingCount}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {pollMsg && <span style={{ fontSize: 12, color: 'var(--text3)' }}>{pollMsg}</span>}
          <button className="btn btn-primary" onClick={handlePollNow} disabled={polling}>
            {polling ? t(lang, 'orders_polling') : t(lang, 'orders_poll_btn')}
          </button>
        </div>
      </div>

      {/* ── Description ── */}
      <div style={{ background: 'var(--accent-dim)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 16px', marginBottom: 20, fontSize: 13, color: 'var(--accent)' }}>
        💡 {t(lang, 'orders_desc')}
      </div>

      {/* ── Filter Tabs ── */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
        {(['pending', 'all', 'approved', 'rejected'] as FilterType[]).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: '6px 16px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
              background: filter === f ? 'var(--accent)' : 'var(--bg3)',
              color: filter === f ? 'var(--bg)' : 'var(--text2)',
            }}
          >
            {f === 'pending'
              ? `${t(lang, 'orders_filter_pending')} (${pendingCount})`
              : f === 'all'
                ? `${t(lang, 'orders_filter_all')} (${orders.length})`
                : f === 'approved'
                  ? t(lang, 'orders_filter_approved')
                  : t(lang, 'orders_filter_rejected')}
          </button>
        ))}
      </div>

      {/* ── Order Cards ── */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text3)', background: 'var(--bg2)', borderRadius: 10 }}>
          {filter === 'pending' ? t(lang, 'orders_empty_pending') : t(lang, 'orders_empty')}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {filtered.map(order => (
            <div
              key={order.id}
              style={{
                border: `1px solid ${order.flag_duplicate ? 'rgba(240,82,82,0.4)'
                  : order.status === 'pending' ? 'rgba(245,194,107,0.4)'
                    : 'var(--border)'
                  }`,
                borderRadius: 10,
                padding: '16px 20px',
                background: order.flag_duplicate
                  ? 'var(--red-dim)'
                  : order.status === 'pending' ? 'var(--yellow-dim)' : 'var(--bg2)',
              }}
            >
              {/* Card Header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <span style={{
                  background: statusColor(order.status), color: 'var(--bg)',
                  borderRadius: 6, padding: '2px 10px', fontSize: 12, fontWeight: 700,
                }}>
                  {statusLabel(order.status)}
                </span>
                <span style={{ background: 'var(--purple-dim)', color: 'var(--purple)', borderRadius: 6, padding: '2px 8px', fontSize: 12 }}>
                  {typeLabel(order.order_type)}
                </span>
                {order.product_code && (
                  <span style={{ background: 'var(--bg4)', color: 'var(--text3)', borderRadius: 6, padding: '2px 8px', fontSize: 11, fontFamily: 'monospace' }}>
                    {order.product_code}
                  </span>
                )}
                {!!order.flag_duplicate && (
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', background: 'var(--red-dim)', border: '1px solid rgba(240,82,82,0.3)', padding: '4px 8px', borderRadius: 6 }}>
                    <span style={{
                      color: 'var(--red)', fontSize: 12, fontWeight: 700,
                      animation: 'pulse 1.5s infinite',
                    }}>
                      🔴 {t(lang, 'orders_duplicate_badge').replace('{status}', order.existing_status || t(lang, 'unknown'))}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--red)' }}>
                      {t(lang, 'orders_duplicate_details').replace('{expiry}', order.existing_expiry || t(lang, 'none')).replace('{customer}', order.existing_customer_name || t(lang, 'none'))}
                    </span>
                  </div>
                )}
                <span style={{ fontSize: 12, color: 'var(--text3)', marginLeft: 'auto' }}>
                  {t(lang, 'orders_collected_at')}{order.created_at?.slice(0, 16).replace('T', ' ')}
                </span>
                {order.source_url && (
                  <a href={order.source_url} target="_blank" rel="noopener noreferrer"
                    style={{ fontSize: 11, color: 'var(--accent)', textDecoration: 'none' }}>
                    {t(lang, 'orders_source_link')}
                  </a>
                )}
              </div>

              {/* Card Body */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '8px 20px', marginBottom: 14 }}>
                <Field label={t(lang, 'orders_field_serial')} value={order.serial_number} highlight />
                <Field label={t(lang, 'orders_field_customer')} value={order.customer_name} />
                <Field label={t(lang, 'orders_field_phone')} value={order.customer_phone} />
                <Field label={t(lang, 'orders_field_email')} value={order.customer_email} />
                <Field label={t(lang, 'orders_field_purchase')} value={order.purchase_date} />
                <Field label={t(lang, 'orders_field_expiry')} value={order.expiry_date} />
                <Field label={t(lang, 'label_main_product')} value={order.main_product} />
                <Field label={t(lang, 'orders_field_version')} value={order.version} />
                {order.notes && <Field label={t(lang, 'orders_field_notes')} value={order.notes} />}
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: 8, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                {order.status === 'pending' && (
                  <>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => setEditOrder({ order: { ...order }, mode: 'register' })}
                    >{t(lang, 'orders_btn_edit_register')}</button>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => setEditOrder({ order: { ...order }, mode: 'update' })}
                    >{t(lang, 'orders_btn_data_update')}</button>
                    <button
                      className="btn btn-sm"
                      style={{ background: 'var(--red-dim)', color: 'var(--red)' }}
                      onClick={() => handleReject(order.id)}
                    >{t(lang, 'orders_btn_reject')}</button>
                  </>
                )}
                {order.raw_data && (
                  <button
                    className="btn btn-sm btn-secondary"
                    onClick={() => setRawModal(order)}
                  >{t(lang, 'orders_btn_raw')}</button>
                )}
                <button
                  className="btn btn-sm"
                  style={{ marginLeft: 'auto', background: 'var(--bg4)', color: 'var(--text3)' }}
                  onClick={() => handleDelete(order.id)}
                >{t(lang, 'delete')}</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Edit Modal ── */}
      {editOrder && (
        <EditOrderModal
          order={editOrder.order}
          mode={editOrder.mode}
          lang={lang}
          onSave={(o) => handleEditSave(o, editOrder.mode)}
          onClose={() => setEditOrder(null)}
        />
      )}

      {/* ── Raw Data Modal ── */}
      {rawModal && (
        <div className="modal-overlay" onClick={() => setRawModal(null)}>
          <div className="modal" style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{t(lang, 'orders_raw_title')}</h3>
              <button className="btn btn-sm btn-secondary" onClick={() => setRawModal(null)}>✕</button>
            </div>
            <pre style={{ fontSize: 12, background: 'var(--bg3)', padding: 12, borderRadius: 6, overflowX: 'auto', maxHeight: 400, overflow: 'auto' }}>
              {JSON.stringify(JSON.parse(rawModal.raw_data || '{}'), null, 2)}
            </pre>
            <div className="modal-footer">
              <button className="btn btn-primary" onClick={() => setRawModal(null)}>{t(lang, 'close')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Field display ─────────────────────────────────────────────────────────────
function Field({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 2, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: 13, color: highlight ? 'var(--accent)' : 'var(--text)', fontWeight: highlight ? 700 : 400 }}>
        {value || <span style={{ color: 'var(--border2)' }}>—</span>}
      </div>
    </div>
  );
}

// ── Edit Modal ────────────────────────────────────────────────────────────────
function EditOrderModal({ order, mode, lang, onSave, onClose }: {
  order: PendingOrder;
  mode: 'register' | 'update';
  lang: Language;
  onSave: (o: PendingOrder) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState({ ...order });
  const set = <K extends keyof PendingOrder>(field: K, value: PendingOrder[K]) =>
    setForm(f => ({ ...f, [field]: value }));

  const handleApprove = () => {
    onSave(form);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 640 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{mode === 'update' ? t(lang, 'orders_modal_update_title') : t(lang, 'orders_modal_title')}</h3>
          <button className="btn btn-sm btn-secondary" onClick={onClose}>✕</button>
        </div>

        <div style={{ overflowY: 'auto', maxHeight: '65vh', padding: '0 4px' }}>
          <div style={sLabel}>{t(lang, 'section_serial_info')}</div>
          <div className="form-group">
            <label>{t(lang, 'label_serial_number')} <span style={{ color: 'var(--red)' }}>*</span></label>
            <input value={form.serial_number} onChange={e => set('serial_number', e.target.value)} />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>{t(lang, 'label_status')}</label>
              <select value={form.serial_status || order.existing_status || 'active'} onChange={e => set('serial_status', e.target.value as Serial['status'])}>
                <option value="active">{t(lang, 'status_active')}</option>
                <option value="expired">{t(lang, 'status_expired')}</option>
                <option value="cancelled">{t(lang, 'status_cancelled')}</option>
                <option value="not-activated">{t(lang, 'status_not_activated')}</option>
                <option value="broken">{t(lang, 'status_broken')}</option>
              </select>
            </div>
            <div className="form-group">
              <label>{t(lang, 'label_version')}</label>
              <input value={form.version} onChange={e => set('version', e.target.value)} />
            </div>
          </div>
          <div className="form-group">
            <label>{t(lang, 'label_main_product')}</label>
            <input value={form.main_product} onChange={e => set('main_product', e.target.value)} />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>{t(lang, 'label_purchase_date')}</label>
              <input type="date" value={form.purchase_date} onChange={e => set('purchase_date', e.target.value)} />
            </div>
            <div className="form-group">
              <label>{t(lang, 'label_expiry_date')} {mode === 'update' && <span style={{fontSize: 10, fontWeight: 'normal'}}>{t(lang, 'orders_no_expiry_change')}</span>}</label>
              <input type="date" value={form.expiry_date} onChange={e => set('expiry_date', e.target.value)} />
            </div>
          </div>

          <div style={{ ...sLabel, marginTop: 16 }}>{t(lang, 'section_customer_info')}</div>
          <div className="form-row">
            <div className="form-group">
              <label>{t(lang, 'label_customer_name')}</label>
              <input value={form.customer_name} onChange={e => set('customer_name', e.target.value)} />
            </div>
            <div className="form-group">
              <label>{t(lang, 'label_manager')}</label>
              <input value={form.sales_manager} onChange={e => set('sales_manager', e.target.value)} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>{t(lang, 'label_phone')}</label>
              <input value={form.customer_phone} onChange={e => set('customer_phone', e.target.value)} />
            </div>
            <div className="form-group">
              <label>{t(lang, 'label_email')}</label>
              <input type="email" value={form.customer_email} onChange={e => set('customer_email', e.target.value)} />
            </div>
          </div>
          <div className="form-group">
            <label>{t(lang, 'label_address')}</label>
            <input value={form.customer_address} onChange={e => set('customer_address', e.target.value)} />
          </div>
          <div className="form-group">
            <label>{t(lang, 'label_notes')}</label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} style={{ resize: 'vertical' }} />
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>{t(lang, 'cancel')}</button>
          <button className="btn btn-primary" onClick={handleApprove}>{mode === 'update' ? t(lang, 'orders_btn_update') : t(lang, 'orders_btn_edit_approve')}</button>
        </div>
      </div>
    </div>
  );
}

const sLabel: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
  letterSpacing: '0.07em', color: 'var(--accent)',
  borderBottom: '1px solid var(--border)', paddingBottom: 4, marginBottom: 10,
};
