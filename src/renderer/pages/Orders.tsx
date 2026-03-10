import React, { useEffect, useState } from 'react';
import { useLang } from '../App';
import { t } from '../i18n';
import type { Language } from '../i18n';

interface PendingOrder {
  id: number;
  source_id: string;
  source_url: string;
  serial_number: string;
  customer_name: string;
  customer_email: string;
  customer_address: string;
  customer_phone: string;
  customer_manager: string;
  purchase_date: string;
  expiry_date: string;
  engine_build: string;
  version: string;
  notes: string;
  order_type: 'new' | 'renewal' | 'addon';
  raw_data: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  product_code: string;
  flag_duplicate: number; // 1 = DB에 동일 serial 이미 존재
}

type FilterType = 'pending' | 'approved' | 'rejected' | 'all';

export default function Orders() {
  const { lang } = useLang();
  const [orders, setOrders] = useState<PendingOrder[]>([]);
  const [filter, setFilter] = useState<FilterType>('pending');
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState(false);
  const [editOrder, setEditOrder] = useState<PendingOrder | null>(null);
  const [rawModal, setRawModal] = useState<PendingOrder | null>(null);
  const [pollMsg, setPollMsg] = useState('');

  useEffect(() => { loadOrders(); }, []);

  const loadOrders = async () => {
    try {
      const data = await window.electronAPI.getOrders();
      setOrders(data || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const handlePollNow = async () => {
    setPolling(true);
    setPollMsg(t(lang, 'orders_polling'));
    try {
      const result = await window.electronAPI.pollNow();
      setPollMsg(`${t(lang, 'orders_poll_done')}${result.found}${t(lang, 'orders_poll_unit')}`);
      if (result.errors?.length > 0) alert(t(lang, 'orders_poll_errors') + result.errors.join('\n'));
      loadOrders();
    } catch (e: any) {
      setPollMsg(`${t(lang, 'orders_poll_error')}${e.message}`);
    } finally {
      setPolling(false);
    }
  };

  const handleApprove = async (id: number) => {
    const result = await window.electronAPI.approveOrder(id);
    if (result.success) {
      alert(t(lang, 'orders_approve_success'));
    } else {
      alert(`${t(lang, 'orders_approve_fail')}${result.error}`);
    }
    loadOrders();
  };

  const handleReject = async (id: number) => {
    if (!confirm(t(lang, 'orders_confirm_reject'))) return;
    await window.electronAPI.rejectOrder(id);
    loadOrders();
  };

  const handleDelete = async (id: number) => {
    if (!confirm(t(lang, 'orders_confirm_delete'))) return;
    await window.electronAPI.deleteOrder(id);
    loadOrders();
  };

  const handleEditSave = async (updated: PendingOrder) => {
    await window.electronAPI.updateOrder(updated.id, updated);
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
    s === 'pending' ? '#f59e0b' : s === 'approved' ? '#10b981' : '#ef4444';

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
            <span style={{ background: '#ef4444', color: '#fff', borderRadius: 12, padding: '2px 10px', fontSize: 13, fontWeight: 700 }}>
              {pendingCount}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {pollMsg && <span style={{ fontSize: 12, color: '#6b7280' }}>{pollMsg}</span>}
          <button className="btn btn-primary" onClick={handlePollNow} disabled={polling}>
            {polling ? t(lang, 'orders_polling') : t(lang, 'orders_poll_btn')}
          </button>
        </div>
      </div>

      {/* ── Description ── */}
      <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '12px 16px', marginBottom: 20, fontSize: 13, color: '#1e40af' }}>
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
              background: filter === f ? '#6366f1' : '#f3f4f6',
              color: filter === f ? '#fff' : '#374151',
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
        <div style={{ textAlign: 'center', padding: 60, color: '#9ca3af', background: '#f9fafb', borderRadius: 10 }}>
          {filter === 'pending' ? t(lang, 'orders_empty_pending') : t(lang, 'orders_empty')}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {filtered.map(order => (
            <div
              key={order.id}
              style={{
                border: `1px solid ${order.flag_duplicate ? '#fca5a5'
                    : order.status === 'pending' ? '#fbbf24'
                      : '#e5e7eb'
                  }`,
                borderRadius: 10,
                padding: '16px 20px',
                background: order.flag_duplicate
                  ? '#fff1f2'
                  : order.status === 'pending' ? '#fffbeb' : '#fff',
              }}
            >
              {/* Card Header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <span style={{
                  background: statusColor(order.status), color: '#fff',
                  borderRadius: 6, padding: '2px 10px', fontSize: 12, fontWeight: 700,
                }}>
                  {statusLabel(order.status)}
                </span>
                <span style={{ background: '#e0e7ff', color: '#4338ca', borderRadius: 6, padding: '2px 8px', fontSize: 12 }}>
                  {typeLabel(order.order_type)}
                </span>
                {order.product_code && (
                  <span style={{ background: '#f3f4f6', color: '#6b7280', borderRadius: 6, padding: '2px 8px', fontSize: 11, fontFamily: 'monospace' }}>
                    {order.product_code}
                  </span>
                )}
                {!!order.flag_duplicate && (
                  <span style={{
                    background: '#dc2626', color: '#fff', borderRadius: 6,
                    padding: '2px 10px', fontSize: 12, fontWeight: 700,
                    animation: 'pulse 1.5s infinite',
                  }}>
                    🔴 중복 Serial 경고
                  </span>
                )}
                <span style={{ fontSize: 12, color: '#9ca3af', marginLeft: 'auto' }}>
                  {t(lang, 'orders_collected_at')}{order.created_at?.slice(0, 16).replace('T', ' ')}
                </span>
                {order.source_url && (
                  <a href={order.source_url} target="_blank" rel="noopener noreferrer"
                    style={{ fontSize: 11, color: '#6366f1', textDecoration: 'none' }}>
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
                <Field label={t(lang, 'orders_field_version')} value={order.version} />
                {order.notes && <Field label={t(lang, 'orders_field_notes')} value={order.notes} />}
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: 8, borderTop: '1px solid #e5e7eb', paddingTop: 12 }}>
                {order.status === 'pending' && (
                  <>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => handleApprove(order.id)}
                    >{t(lang, 'orders_btn_approve')}</button>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => setEditOrder({ ...order })}
                    >{t(lang, 'orders_btn_edit_approve')}</button>
                    <button
                      className="btn btn-sm"
                      style={{ background: '#fee2e2', color: '#dc2626' }}
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
                  style={{ marginLeft: 'auto', background: '#f3f4f6', color: '#6b7280' }}
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
          order={editOrder}
          lang={lang}
          onSave={handleEditSave}
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
            <pre style={{ fontSize: 12, background: '#f9fafb', padding: 12, borderRadius: 6, overflowX: 'auto', maxHeight: 400, overflow: 'auto' }}>
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
      <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 2, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: 13, color: highlight ? '#6366f1' : '#111827', fontWeight: highlight ? 700 : 400 }}>
        {value || <span style={{ color: '#d1d5db' }}>—</span>}
      </div>
    </div>
  );
}

// ── Edit Modal ────────────────────────────────────────────────────────────────
function EditOrderModal({ order, lang, onSave, onClose }: {
  order: PendingOrder;
  lang: Language;
  onSave: (o: PendingOrder) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState({ ...order });
  const set = (field: string, value: string) => setForm(f => ({ ...f, [field]: value }));

  const handleApprove = () => {
    if (!form.expiry_date) { alert(t(lang, 'orders_required_expiry')); return; }
    onSave(form);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 640 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{t(lang, 'orders_modal_title')}</h3>
          <button className="btn btn-sm btn-secondary" onClick={onClose}>✕</button>
        </div>

        <div style={{ overflowY: 'auto', maxHeight: '65vh', padding: '0 4px' }}>
          <div style={sLabel}>{t(lang, 'section_serial_info')}</div>
          <div className="form-group">
            <label>{t(lang, 'label_serial_number')} <span style={{ color: '#ef4444' }}>*</span></label>
            <input value={form.serial_number} onChange={e => set('serial_number', e.target.value)} />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>{t(lang, 'orders_label_order_type')}</label>
              <select value={form.order_type} onChange={e => set('order_type', e.target.value)}>
                <option value="new">{t(lang, 'orders_type_new_opt')}</option>
                <option value="renewal">{t(lang, 'orders_type_renewal_opt')}</option>
                <option value="addon">{t(lang, 'orders_type_addon')}</option>
              </select>
            </div>
            <div className="form-group">
              <label>{t(lang, 'label_version')}</label>
              <input value={form.version} onChange={e => set('version', e.target.value)} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>{t(lang, 'label_purchase_date')}</label>
              <input type="date" value={form.purchase_date} onChange={e => set('purchase_date', e.target.value)} />
            </div>
            <div className="form-group">
              <label>{t(lang, 'label_expiry_date')} <span style={{ color: '#ef4444' }}>*</span></label>
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
              <input value={form.customer_manager} onChange={e => set('customer_manager', e.target.value)} />
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
          <button className="btn btn-primary" onClick={handleApprove}>{t(lang, 'orders_btn_edit_approve')}</button>
        </div>
      </div>
    </div>
  );
}

const sLabel: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
  letterSpacing: '0.07em', color: '#6366f1',
  borderBottom: '1px solid #e5e7eb', paddingBottom: 4, marginBottom: 10,
};
