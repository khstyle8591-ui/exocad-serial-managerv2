import React, { useEffect, useMemo, useState } from 'react';
import type { GroupedOrder, PendingOrder, MergeCandidate } from '../../shared/types';
import { useLang } from '../App';
import { t } from '../i18n';

type FilterType = 'all' | 'duplicate' | 'single' | 'grouped';
type CustomerMode = 'auto' | 'existing' | 'new';
type EditableOrder = PendingOrder;

export default function RequestedOrder() {
  const { lang } = useLang();
  const [groups, setGroups] = useState<GroupedOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterType>('all');
  const [targetStatusByKey, setTargetStatusByKey] = useState<Record<string, 'active' | 'not-activated'>>({});
  const [customerModeByKey, setCustomerModeByKey] = useState<Record<string, CustomerMode>>({});
  const [selectedCustomerByKey, setSelectedCustomerByKey] = useState<Record<string, number>>({});
  const [candidateMap, setCandidateMap] = useState<Record<string, MergeCandidate[]>>({});
  const [editingGroup, setEditingGroup] = useState<GroupedOrder | null>(null);

  useEffect(() => { void load(); }, []);

  const load = async () => {
    setLoading(true);
    try {
      const result = await window.electronAPI.listGroupedOrders();
      setGroups(result);
    } finally {
      setLoading(false);
    }
  };

  const filtered = useMemo(() => {
    return groups.filter(group => {
      if (filter === 'duplicate') return group.flagged_duplicate;
      if (filter === 'single') return !group.trade_number;
      if (filter === 'grouped') return !!group.trade_number;
      return true;
    });
  }, [filter, groups]);

  const runPollNow = async () => {
    setPolling(true);
    try {
      await window.electronAPI.pollNow();
      await load();
    } finally {
      setPolling(false);
    }
  };

  const getGroupKey = (group: GroupedOrder) => group.trade_number || `single:${group.main?.id ?? group.created_at}`;

  const approveGroup = async (group: GroupedOrder) => {
    const key = getGroupKey(group);
    const targetStatus = targetStatusByKey[key] || 'active';
    const customerMode = customerModeByKey[key] || 'auto';
    const selectedCustomerId = selectedCustomerByKey[key];
    setBusyKey(`approve:${key}`);
    try {
      const ordered = [group.main, ...group.modules].filter(Boolean) as PendingOrder[];
      const primaryFirst = ordered.sort((a, b) => {
        const aScore = a.order_type === 'new' ? 0 : a.order_type === 'renewal' ? 1 : 2;
        const bScore = b.order_type === 'new' ? 0 : b.order_type === 'renewal' ? 1 : 2;
        return aScore - bScore;
      });

      let resolvedCustomerId: number | undefined = customerMode === 'existing' ? selectedCustomerId : undefined;

      for (const order of primaryFirst) {
        let customerPayload: Record<string, unknown>;
        if (resolvedCustomerId !== undefined) {
          customerPayload = { customer_id: resolvedCustomerId };
        } else if (customerMode === 'new') {
          const mainOrder = group.main ?? order;
          customerPayload = {
            customer_data: {
              name: mainOrder.customer_name, email: mainOrder.customer_email,
              phone: mainOrder.customer_phone, address: mainOrder.customer_address,
              dealer: mainOrder.dealer, sales_manager: mainOrder.sales_manager,
            },
          };
        } else {
          customerPayload = {};
        }

        const result = await window.electronAPI.approveOrder(order.id, { serial_status: targetStatus, ...customerPayload });
        if (!result?.success) throw new Error(result?.error || t(lang, 'orders_approve_fail') + order.id);
        if (resolvedCustomerId === undefined && result.customer_id) {
          resolvedCustomerId = result.customer_id;
        }
      }
      await load();
    } catch (error: any) {
      alert(error.message || t(lang, 'requested_order_approve_error'));
    } finally {
      setBusyKey(null);
    }
  };

  const saveEditedGroup = async (orders: EditableOrder[]) => {
    setBusyKey('edit-save');
    try {
      for (const order of orders) {
        await window.electronAPI.updateOrder(order.id, order);
      }
      setEditingGroup(null);
      await load();
    } catch (error: any) {
      alert(error.message || t(lang, 'requested_order_save_error'));
    } finally {
      setBusyKey(null);
    }
  };

  const loadCandidates = async (group: GroupedOrder) => {
    const key = getGroupKey(group);
    if (candidateMap[key] || !group.main) return;
    const query = {
      name: group.main.customer_name, email: group.main.customer_email,
      phone: group.main.customer_phone, dealer: group.main.dealer,
    };
    const candidates = await window.electronAPI.getCustomerMergeCandidates(query);
    setCandidateMap(current => ({ ...current, [key]: candidates }));
    if (candidates[0]) {
      setSelectedCustomerByKey(current => ({ ...current, [key]: candidates[0].customer.id }));
    }
  };

  const rejectGroup = async (group: GroupedOrder) => {
    const key = getGroupKey(group);
    if (!confirm(t(lang, 'requested_order_reject_confirm'))) return;
    setBusyKey(`reject:${key}`);
    try {
      const orders = [group.main, ...group.modules].filter(Boolean) as PendingOrder[];
      for (const order of orders) { await window.electronAPI.rejectOrder(order.id); }
      await load();
    } finally {
      setBusyKey(null);
    }
  };

  if (loading) {
    return <div style={{ padding: 32, color: 'var(--text3)' }}>{t(lang, 'requested_order_loading')}</div>;
  }

  return (
    <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 18, minHeight: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
        <div>
          <h2 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>{t(lang, 'requested_order_title')}</h2>
          <p style={{ margin: 0, color: 'var(--text3)', fontSize: 13 }}>{t(lang, 'requested_order_desc')}</p>
        </div>
        <button onClick={runPollNow} disabled={polling} style={primaryButtonStyle}>
          {polling ? t(lang, 'requested_order_polling') : t(lang, 'orders_poll_btn')}
        </button>
      </div>

      <div style={{ background: 'rgba(61,216,200,0.08)', border: '1px solid rgba(61,216,200,0.2)', borderRadius: 8, padding: '12px 14px', color: 'var(--accent)', fontSize: 13 }}>
        {t(lang, 'requested_order_hint')}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {([
          ['all', `${t(lang, 'orders_filter_all')} ${groups.length}`],
          ['grouped', `${t(lang, 'requested_order_filter_grouped')} ${groups.filter(g => !!g.trade_number).length}`],
          ['single', `${t(lang, 'requested_order_filter_single')} ${groups.filter(g => !g.trade_number).length}`],
          ['duplicate', `${t(lang, 'requested_order_filter_duplicate')} ${groups.filter(g => g.flagged_duplicate).length}`],
        ] as [FilterType, string][]).map(([value, label]) => (
          <button key={value} onClick={() => setFilter(value)} style={{
            ...chipStyle,
            background: filter === value ? 'var(--accent)' : 'var(--bg3)',
            color: filter === value ? '#0d1117' : 'var(--text)',
            borderColor: filter === value ? 'var(--accent)' : 'var(--border)',
          }}>
            {label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div style={emptyPanelStyle}>{t(lang, 'requested_order_empty')}</div>
      ) : (
        filtered.map(group => {
          const key = getGroupKey(group);
          const main = group.main;
          const statusValue = targetStatusByKey[key] || 'active';
          const customerMode = customerModeByKey[key] || 'auto';
          const candidates = candidateMap[key] || [];
          const orders = [group.main, ...group.modules].filter(Boolean) as PendingOrder[];
          return (
            <section key={key} style={panelStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span style={badgeStyle('rgba(61,216,200,0.1)', 'var(--accent)')}>
                      {group.trade_number ? `${t(lang, 'requested_order_trade_label')} ${group.trade_number}` : t(lang, 'requested_order_single')}
                    </span>
                    <span style={badgeStyle('var(--bg3)', 'var(--text3)')}>
                      {orders.length}{t(lang, 'requested_order_count_suffix')}
                    </span>
                    {group.flagged_duplicate && (
                      <span style={badgeStyle('rgba(239,68,68,0.1)', '#fc8181')}>{t(lang, 'requested_order_duplicate_badge')}</span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text3)' }}>
                    {t(lang, 'requested_order_collected_at')} {group.created_at?.slice(0, 16)}
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 210 }}>
                  <select
                    value={statusValue}
                    onChange={ev => setTargetStatusByKey(c => ({ ...c, [key]: ev.target.value as any }))}
                    style={selectStyle}
                  >
                    <option value="active">{t(lang, 'requested_order_status_active')}</option>
                    <option value="not-activated">{t(lang, 'requested_order_status_not_activated')}</option>
                  </select>
                  <button onClick={() => setEditingGroup(group)} style={ghostButtonStyle}>
                    {t(lang, 'requested_order_edit_group')}
                  </button>
                  <button onClick={() => approveGroup(group)} disabled={busyKey === `approve:${key}`} style={primaryButtonStyle}>
                    {busyKey === `approve:${key}` ? t(lang, 'requested_order_approving_group') : t(lang, 'requested_order_approve_group')}
                  </button>
                  <button onClick={() => rejectGroup(group)} disabled={busyKey === `reject:${key}`} style={dangerButtonStyle}>
                    {busyKey === `reject:${key}` ? t(lang, 'requested_order_rejecting_group') : t(lang, 'requested_order_reject_group')}
                  </button>
                </div>
              </div>

              {main && (
                <div style={blockStyle}>
                  <div style={blockTitleStyle}>{t(lang, 'requested_order_main')}</div>
                  <OrderSummary order={main} lang={lang} />
                  <div style={{ marginTop: 10, padding: 12, borderRadius: 8, background: 'var(--bg)', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)' }}>{t(lang, 'requested_order_customer_mode')}</div>
                      <button onClick={() => loadCandidates(group)} style={ghostButtonStyle}>
                        {t(lang, 'requested_order_find_candidates')}
                      </button>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {([
                        ['auto', t(lang, 'requested_order_customer_auto')],
                        ['existing', t(lang, 'requested_order_customer_existing')],
                        ['new', t(lang, 'requested_order_customer_new')],
                      ] as [CustomerMode, string][]).map(([mode, label]) => (
                        <button key={mode} onClick={() => setCustomerModeByKey(c => ({ ...c, [key]: mode }))} style={{
                          ...chipStyle,
                          background: customerMode === mode ? 'var(--text)' : 'var(--bg3)',
                          color: customerMode === mode ? 'var(--bg)' : 'var(--text)',
                          borderColor: customerMode === mode ? 'var(--text)' : 'var(--border)',
                        }}>
                          {label}
                        </button>
                      ))}
                    </div>
                    {customerMode === 'existing' && (
                      candidates.length > 0 ? (
                        <select
                          value={selectedCustomerByKey[key] || ''}
                          onChange={ev => setSelectedCustomerByKey(c => ({ ...c, [key]: Number(ev.target.value) }))}
                          style={selectStyle}
                        >
                          {candidates.map(c => (
                            <option key={c.customer.id} value={c.customer.id}>
                              {c.customer.name} / {c.customer.email || c.customer.phone || '-'} / {c.matched_field}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <div style={helperTextStyle}>{t(lang, 'requested_order_no_candidates')}</div>
                      )
                    )}
                    {customerMode !== 'existing' && (
                      <div style={helperTextStyle}>
                        {customerMode === 'auto' ? t(lang, 'requested_order_customer_auto_help') : t(lang, 'requested_order_customer_new_help')}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {group.modules.length > 0 && (
                <div style={blockStyle}>
                  <div style={blockTitleStyle}>{t(lang, 'requested_order_modules')}</div>
                  <div style={{ display: 'grid', gap: 10 }}>
                    {group.modules.map(order => <OrderSummary key={order.id} order={order} compact lang={lang} />)}
                  </div>
                </div>
              )}

              {main?.modules && JSON.parse(main.modules || '[]').length > 0 && (
                <div style={blockStyle}>
                  <div style={blockTitleStyle}>{t(lang, 'requested_order_embedded_addons')}</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {(JSON.parse(main.modules || '[]') as Array<{ name: string }>).map((m, i) => (
                      <span key={`${m.name}-${i}`} style={badgeStyle('rgba(99,102,241,0.1)', '#a78bfa')}>{m.name}</span>
                    ))}
                  </div>
                </div>
              )}
            </section>
          );
        })
      )}

      {editingGroup && (
        <EditGroupedOrdersModal
          group={editingGroup} lang={lang}
          saving={busyKey === 'edit-save'}
          onSave={saveEditedGroup}
          onClose={() => setEditingGroup(null)}
        />
      )}
    </div>
  );
}

function OrderSummary({ order, compact = false, lang }: { order: PendingOrder; compact?: boolean; lang: Parameters<typeof t>[0] }) {
  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: 8, padding: compact ? 10 : 12,
      background: 'var(--bg)', display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '8px 12px',
    }}>
      <SummaryField label={t(lang, 'orders_label_order_type')} value={order.order_type} />
      <SummaryField label={t(lang, 'orders_field_serial')} value={order.serial_number} highlight />
      <SummaryField label={t(lang, 'orders_field_customer')} value={order.customer_name} />
      <SummaryField label={t(lang, 'orders_field_phone')} value={order.customer_phone} />
      <SummaryField label={t(lang, 'orders_field_purchase')} value={order.purchase_date} />
      <SummaryField label={t(lang, 'orders_field_expiry')} value={order.expiry_date} />
      <SummaryField label={t(lang, 'requested_order_product_label')} value={order.main_product || order.version} />
      <SummaryField label={t(lang, 'orders_field_notes')} value={order.notes} />
    </div>
  );
}

function SummaryField({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 3, fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 13, color: highlight ? 'var(--accent)' : 'var(--text)', fontWeight: highlight ? 700 : 500 }}>
        {value || '—'}
      </div>
    </div>
  );
}

function badgeStyle(background: string, color: string): React.CSSProperties {
  return { background, color, borderRadius: 999, padding: '3px 10px', fontSize: 12, fontWeight: 700 };
}

function EditGroupedOrdersModal({ group, lang, saving, onSave, onClose }: {
  group: GroupedOrder; lang: Parameters<typeof t>[0]; saving: boolean;
  onSave: (orders: EditableOrder[]) => void; onClose: () => void;
}) {
  const initialOrders = useMemo(
    () => [group.main, ...group.modules].filter(Boolean).map(o => ({ ...o! })) as EditableOrder[],
    [group],
  );
  const [orders, setOrders] = useState<EditableOrder[]>(initialOrders);

  const setField = (id: number, field: keyof EditableOrder, value: string) =>
    setOrders(c => c.map(o => o.id === id ? { ...o, [field]: value } : o));

  const syncCustomerFromMain = () => {
    const main = orders.find(o => o.order_type === 'new' || o.order_type === 'renewal') ?? orders[0];
    if (!main) return;
    const customerFields: (keyof EditableOrder)[] = ['customer_name', 'customer_email', 'customer_phone', 'customer_address', 'dealer', 'sales_manager'];
    setOrders(c => c.map(o => o.id === main.id ? o : customerFields.reduce((acc, f) => ({ ...acc, [f]: (main as any)[f] ?? '' }), o)));
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={onClose}>
      <div style={{ background: 'var(--bg2)', borderRadius: 12, maxWidth: 920, width: '92%', border: '1px solid var(--border2)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', maxHeight: '90vh' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>{t(lang, 'requested_order_edit_group')}</h3>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {orders.length > 1 && (
              <button onClick={syncCustomerFromMain} style={{ ...ghostButtonStyle, fontSize: 11, color: 'var(--accent)', borderColor: 'rgba(61,216,200,0.3)' }}>
                {t(lang, 'requested_order_sync_customer')}
              </button>
            )}
            <button onClick={onClose} style={ghostButtonStyle}>✕</button>
          </div>
        </div>

        <div style={{ maxHeight: '70vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 18, padding: '18px 24px' }}>
          {orders.map(order => (
            <div key={order.id} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 12, alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={badgeStyle('rgba(99,102,241,0.1)', '#a78bfa')}>{order.order_type}</span>
                  <span style={badgeStyle('var(--bg3)', 'var(--text3)')}>#{order.id}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text3)' }}>{order.trade_number || 'single'}</div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(220px, 1fr))', gap: 12 }}>
                {([
                  ['label_serial_number', 'serial_number'],
                  ['label_customer_name', 'customer_name'],
                  ['label_phone', 'customer_phone'],
                  ['label_email', 'customer_email'],
                  ['label_address', 'customer_address'],
                  ['requested_order_dealer_label', 'dealer'],
                  ['label_manager', 'sales_manager'],
                  ['label_version', 'version'],
                ] as [string, keyof EditableOrder][]).map(([lk, fk]) => (
                  <label key={fk} style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--text3)' }}>
                    <span style={{ fontWeight: 700 }}>{t(lang, lk as any)}</span>
                    <input
                      value={(order as any)[fk] ?? ''}
                      onChange={ev => setField(order.id, fk, ev.target.value)}
                      style={{ padding: '6px 8px', border: '1px solid var(--border2)', borderRadius: 4, fontSize: 12, background: 'var(--bg3)', color: 'var(--text)', boxSizing: 'border-box', width: '100%' }}
                    />
                  </label>
                ))}
                {([
                  ['label_purchase_date', 'purchase_date', 'date'],
                  ['label_expiry_date', 'expiry_date', 'date'],
                ] as [string, keyof EditableOrder, string][]).map(([lk, fk, type]) => (
                  <label key={fk} style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--text3)' }}>
                    <span style={{ fontWeight: 700 }}>{t(lang, lk as any)}</span>
                    <input
                      type={type}
                      value={(order as any)[fk] ?? ''}
                      onChange={ev => setField(order.id, fk, ev.target.value)}
                      style={{ padding: '6px 8px', border: '1px solid var(--border2)', borderRadius: 4, fontSize: 12, background: 'var(--bg3)', color: 'var(--text)', boxSizing: 'border-box', width: '100%' }}
                    />
                  </label>
                ))}
              </div>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--text3)', marginTop: 10 }}>
                <span style={{ fontWeight: 700 }}>{t(lang, 'label_notes')}</span>
                <textarea
                  value={order.notes}
                  onChange={ev => setField(order.id, 'notes', ev.target.value)}
                  rows={2}
                  style={{ padding: '6px 8px', border: '1px solid var(--border2)', borderRadius: 4, fontSize: 12, background: 'var(--bg3)', color: 'var(--text)', resize: 'vertical', fontFamily: 'inherit' }}
                />
              </label>
            </div>
          ))}
        </div>

        <div style={{ padding: '14px 24px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={ghostButtonStyle}>{t(lang, 'cancel')}</button>
          <button onClick={() => onSave(orders)} disabled={saving} style={primaryButtonStyle}>
            {saving ? t(lang, 'saving') : t(lang, 'requested_order_save_group')}
          </button>
        </div>
      </div>
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10,
  padding: 18, display: 'flex', flexDirection: 'column', gap: 14,
};
const blockStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8 };
const blockTitleStyle: React.CSSProperties = { fontSize: 12, color: 'var(--text3)', fontWeight: 700, textTransform: 'uppercase' };
const emptyPanelStyle: React.CSSProperties = {
  background: 'var(--bg2)', border: '2px dashed var(--border)', borderRadius: 10,
  padding: 36, textAlign: 'center', color: 'var(--text3)',
};
const primaryButtonStyle: React.CSSProperties = {
  border: 'none', borderRadius: 6, background: 'var(--accent)', color: '#0d1117',
  padding: '9px 14px', fontSize: 13, cursor: 'pointer', fontWeight: 600,
};
const dangerButtonStyle: React.CSSProperties = {
  border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6, background: 'rgba(239,68,68,0.1)',
  color: '#fc8181', padding: '9px 14px', fontSize: 13, cursor: 'pointer',
};
const chipStyle: React.CSSProperties = {
  border: '1px solid var(--border)', borderRadius: 999, padding: '6px 12px',
  fontSize: 12, cursor: 'pointer',
};
const selectStyle: React.CSSProperties = {
  border: '1px solid var(--border2)', borderRadius: 6, padding: '8px 10px',
  fontSize: 13, background: 'var(--bg3)', color: 'var(--text)',
};
const helperTextStyle: React.CSSProperties = { fontSize: 12, color: 'var(--text3)' };
const ghostButtonStyle: React.CSSProperties = {
  border: '1px solid var(--border2)', borderRadius: 6, background: 'var(--bg3)',
  color: 'var(--text)', padding: '7px 12px', fontSize: 12, cursor: 'pointer',
};
