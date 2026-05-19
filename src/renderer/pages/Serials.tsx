import React, { useEffect, useState, useMemo } from 'react';
import SerialForm from '../components/SerialForm';
import { useLang, useNav } from '../App';
import { t } from '../i18n';
import { api } from '../client';

interface Serial {
  id: number;
  serial_number: string;
  customer_name: string;
  customer_email: string;
  customer_address: string;
  customer_phone: string;
  customer_manager: string;
  purchase_date: string;
  expiry_date: string;
  status: string;
  engine_build: string;
  version: string;
  add_ons: string;
  notes: string;
}

type SortDir = 'asc' | 'desc';
type SpecialFilter = 'expiring' | null;

// ── SVG icons ──────────────────────────────────────────────────────────────────
const SearchIcon = () => (
  <svg width={13} height={13} viewBox="0 0 16 16" fill="none">
    <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.5"/>
    <path d="M10 10L14 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
  </svg>
);
const PlusIcon = () => (
  <svg width={13} height={13} viewBox="0 0 16 16" fill="none">
    <path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
  </svg>
);
const SortIcon = ({ active }: { active: boolean }) => (
  <svg width={11} height={11} viewBox="0 0 16 16" fill="none" style={{ opacity: active ? 1 : 0.3, marginLeft: 3 }}>
    <path d="M5 4l3-3 3 3M5 12l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);
const EditIcon = () => (
  <svg width={11} height={11} viewBox="0 0 16 16" fill="none">
    <path d="M11 2l3 3L5 14H2v-3L11 2Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
  </svg>
);
const TrashIcon = () => (
  <svg width={11} height={11} viewBox="0 0 16 16" fill="none">
    <path d="M2 4h12M5 4V3a1 1 0 011-1h4a1 1 0 011 1v1M6 7v5M10 7v5M3 4l1 9a1 1 0 001 1h6a1 1 0 001-1l1-9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);
const CopyIcon = () => (
  <svg width={12} height={12} viewBox="0 0 16 16" fill="none">
    <rect x="5" y="5" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
    <path d="M3 11V3a1 1 0 011-1h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
  </svg>
);
const CloseIcon = () => (
  <svg width={15} height={15} viewBox="0 0 16 16" fill="none">
    <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
  </svg>
);

export default function Serials() {
  const { lang }  = useLang();
  const { params } = useNav();

  const [serials, setSerials]           = useState<Serial[]>([]);
  const [search, setSearch]             = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [specialFilter, setSpecialFilter] = useState<SpecialFilter>(null);
  const [showForm, setShowForm]         = useState(false);
  const [editingSerial, setEditingSerial] = useState<Serial | null>(null);
  const [detailSerial, setDetailSerial] = useState<Serial | null>(null);
  const [detailTab, setDetailTab]       = useState<'info' | 'addons'>('info');
  const [loading, setLoading]           = useState(true);
  const [newAddonInput, setNewAddonInput] = useState('');
  const [addonSaving, setAddonSaving]   = useState(false);
  const [selected, setSelected]         = useState(new Set<number>());
  const [sortBy, setSortBy]             = useState('purchase_date');
  const [sortDir, setSortDir]           = useState<SortDir>('desc');
  const [copiedId, setCopiedId]         = useState<number | null>(null);

  useEffect(() => { loadSerials(); }, [params]);

  const loadSerials = async () => {
    try {
      let data = await api.getSerials() as Serial[];

      if (params?.filter) {
        const filter = params.filter;
        if (filter === 'active') {
          setFilterStatus('active');
          setSpecialFilter(null);
        } else if (filter === 'cancelled') {
          setFilterStatus('cancelled');
          setSpecialFilter(null);
        } else if (filter === 'expired') {
          setFilterStatus('expired');
          setSpecialFilter(null);
        } else if (filter === 'not-activated') {
          setFilterStatus('not-activated');
          setSpecialFilter(null);
        } else if (filter === 'expiring') {
          setFilterStatus('all');
          setSpecialFilter('expiring');
        } else {
          setFilterStatus('all');
          setSpecialFilter(null);
        }
      } else {
        setFilterStatus('all');
        setSpecialFilter(null);
      }

      setSerials(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    const now = new Date();
    const todayStr = now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const endOfMonth = lastDay.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });

    return serials
      .filter(s => {
        if (q && !s.serial_number.toLowerCase().includes(q) &&
                 !s.customer_name.toLowerCase().includes(q) &&
                 !s.customer_manager.toLowerCase().includes(q) &&
                 !s.customer_email.toLowerCase().includes(q) &&
                 !s.customer_phone.toLowerCase().includes(q)) return false;
        if (filterStatus !== 'all' && s.status !== filterStatus) return false;
        if (specialFilter === 'expiring') {
          return s.status === 'active' && s.expiry_date >= todayStr && s.expiry_date <= endOfMonth;
        }
        return true;
      })
      .sort((a: any, b: any) => {
        const va = a[sortBy] || '', vb = b[sortBy] || '';
        return sortDir === 'asc' ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
      });
  }, [serials, search, filterStatus, specialFilter, sortBy, sortDir]);

  const handleSort = (col: string) => {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('asc'); }
  };

  const handleSearch = async () => {
    if (!search.trim()) { loadSerials(); return; }
    try {
      const data = await api.searchSerials(search) as Serial[];
      setSerials(data);
    } catch (err) { console.error(err); }
  };

  const handleDelete = async (id: number) => {
    if (!confirm(t(lang, 'confirm_delete'))) return;
    await api.deleteSerial(id);
    loadSerials();
  };

  const handleRenew = async (id: number) => {
    if (!confirm(t(lang, 'confirm_renew'))) return;
    await api.renewSerial(id);
    loadSerials();
  };

  const handleCancel = async (serialNumber: string) => {
    if (!confirm(`${serialNumber}${t(lang, 'confirm_cancel')}`)) return;
    const result = await api.cancelSubscription(serialNumber) as any;
    if (result.success) alert(t(lang, 'cancel_success'));
    else alert(`${t(lang, 'cancel_fail')}${result.error}`);
    loadSerials();
  };

  const handleBulkImport = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls,.csv';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const result = await api.bulkImport(file) as any;
      if (result.imported > 0) alert(t(lang, 'import_done_count').replace('{n}', String(result.imported)));
      if (result.errors.length > 0) alert(t(lang, 'orders_poll_errors') + result.errors.join('\n'));
      loadSerials();
    };
    input.click();
  };

  const handleExport = async () => {
    const result = await api.exportSerials(filtered as any[]) as any;
    if (result.success) {
      alert(result.filePath ? t(lang, 'export_done_path').replace('{path}', result.filePath) : t(lang, 'export_done'));
    } else if (result.error) {
      alert(t(lang, 'export_failed').replace('{error}', result.error));
    }
  };

  const handleFormSave = async (input: any) => {
    try {
      if (editingSerial) await api.updateSerial(editingSerial.id, input);
      else await api.createSerial(input);
      setShowForm(false);
      setEditingSerial(null);
      loadSerials();
    } catch (err: any) {
      alert(err.message || t(lang, 'save_fail'));
    }
  };

  const handleDetailAddAddon = async () => {
    if (!detailSerial || !newAddonInput.trim()) return;
    setAddonSaving(true);
    try {
      const updated = await api.addAddon(detailSerial.id, {
        name: newAddonInput.trim(),
        added_date: new Date().toISOString().slice(0, 10),
      }) as any;
      setDetailSerial(updated);
      setNewAddonInput('');
      loadSerials();
    } finally {
      setAddonSaving(false);
    }
  };

  const copySerial = (id: number, text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    });
  };

  const toggleSelect = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map(s => s.id)));
  };

  const deleteSelected = () => {
    if (!confirm(t(lang, 'selected_delete_confirm').replace('{n}', String(selected.size)))) return;
    Promise.all([...selected].map(id => api.deleteSerial(id))).then(() => {
      setSelected(new Set());
      loadSerials();
    });
  };

  const statusLabel = (s: string) => {
    if (s === 'active')        return t(lang, 'status_active');
    if (s === 'cancelled')     return t(lang, 'status_cancelled');
    if (s === 'expired')       return t(lang, 'status_expired');
    if (s === 'not-activated') return t(lang, 'status_not_activated');
    return s;
  };

  const STATUSES = ['active', 'cancelled', 'expired', 'not-activated'];

  const inputStyle: React.CSSProperties = {
    background: 'var(--bg3)', border: '1px solid var(--border2)',
    borderRadius: 7, padding: '7px 11px', color: 'var(--text)',
    fontSize: 12.5, outline: 'none', fontFamily: 'inherit', width: '100%',
    transition: 'border-color 0.12s',
  };

  const thStyle = (col: string): React.CSSProperties => ({
    padding: '9px 12px', textAlign: 'left', fontSize: 11, fontWeight: 500,
    color: 'var(--text3)', letterSpacing: '0.04em', cursor: 'pointer',
    userSelect: 'none', whiteSpace: 'nowrap',
    borderBottom: '1px solid var(--border)',
    background: sortBy === col ? 'var(--bg3)' : 'var(--bg2)',
    position: 'sticky', top: 0, zIndex: 10,
  });

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)' }}>{t(lang, 'loading')}</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* ── Header ── */}
      <div style={{
        padding: '16px 20px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
        background: 'var(--bg)',
      }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>{t(lang, 'page_title_serials')}</div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
            {t(lang, 'serials_count_summary').replace('{total}', String(serials.length)).replace('{shown}', String(filtered.length))}
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {selected.size > 0 && (
            <button onClick={deleteSelected} className="btn btn-sm" style={{
              background: 'var(--red-dim)', color: 'var(--red)', border: '1px solid rgba(240,82,82,0.3)',
            }}>
              {t(lang, 'selected_delete_count').replace('{n}', String(selected.size))}
            </button>
          )}
          <button className="btn btn-secondary btn-sm" onClick={() => api.downloadTemplate()} title={t(lang, 'btn_download_template')}>
            {t(lang, 'btn_download_template')}
          </button>
          <button className="btn btn-secondary btn-sm" onClick={handleBulkImport}>
            {t(lang, 'btn_excel_upload')}
          </button>
          <button className="btn btn-secondary btn-sm" onClick={handleExport} disabled={filtered.length === 0}>
            {t(lang, 'btn_serial_db_download')}
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => { setEditingSerial(null); setShowForm(true); }}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <PlusIcon /> {t(lang, 'btn_new_register')}
          </button>
        </div>
      </div>

      {/* ── Filter bar ── */}
      <div style={{
        padding: '10px 20px', borderBottom: '1px solid var(--border)',
        display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0,
        background: 'var(--bg2)',
      }}>
        <div style={{ position: 'relative', flex: '0 0 220px' }}>
          <span style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--text3)' }}>
            <SearchIcon />
          </span>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            placeholder={t(lang, 'search_placeholder')}
            style={{ ...inputStyle, paddingLeft: 30 }}
            onFocus={e => (e.target as HTMLElement).style.borderColor = 'var(--accent)'}
            onBlur={e  => (e.target as HTMLElement).style.borderColor = 'var(--border2)'}
          />
        </div>
        <select
          value={filterStatus}
          onChange={e => { setFilterStatus(e.target.value); setSpecialFilter(null); }}
          style={{ ...inputStyle, width: 'auto', color: filterStatus !== 'all' || specialFilter ? 'var(--accent)' : 'var(--text2)' }}
        >
          <option value="all">{t(lang, 'status_all')}</option>
          {STATUSES.map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}
        </select>
        {(search || filterStatus !== 'all' || specialFilter) && (
          <button
            onClick={() => { setSearch(''); setFilterStatus('all'); setSpecialFilter(null); }}
            className="btn btn-ghost btn-sm"
          >
            {t(lang, 'reset')}
          </button>
        )}
      </div>

      {/* ── Table ── */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1100 }}>
          <thead>
            <tr>
              <th style={{ ...thStyle(''), width: 36, cursor: 'default' }}>
                <input
                  type="checkbox"
                  checked={selected.size === filtered.length && filtered.length > 0}
                  onChange={toggleAll}
                  style={{ accentColor: 'var(--accent)', cursor: 'pointer' }}
                />
              </th>
              <th style={thStyle('serial_number')}     onClick={() => handleSort('serial_number')}>
                {t(lang, 'col_serial')} <SortIcon active={sortBy === 'serial_number'} />
              </th>
              <th style={thStyle('customer_name')}     onClick={() => handleSort('customer_name')}>
                {t(lang, 'col_customer')} <SortIcon active={sortBy === 'customer_name'} />
              </th>
              <th style={thStyle('customer_manager')}  onClick={() => handleSort('customer_manager')}>
                {t(lang, 'col_manager')} <SortIcon active={sortBy === 'customer_manager'} />
              </th>
              <th style={thStyle('customer_phone')}    onClick={() => handleSort('customer_phone')}>
                {t(lang, 'col_phone')} <SortIcon active={sortBy === 'customer_phone'} />
              </th>
              <th style={thStyle('purchase_date')}     onClick={() => handleSort('purchase_date')}>
                {t(lang, 'col_purchase_date')} <SortIcon active={sortBy === 'purchase_date'} />
              </th>
              <th style={thStyle('expiry_date')}       onClick={() => handleSort('expiry_date')}>
                {t(lang, 'col_expiry_date')} <SortIcon active={sortBy === 'expiry_date'} />
              </th>
              <th style={{ ...thStyle('status'), cursor: 'default' }}>{t(lang, 'col_status')}</th>
              <th style={thStyle('engine_build')}      onClick={() => handleSort('engine_build')}>
                {t(lang, 'col_engine_build')} <SortIcon active={sortBy === 'engine_build'} />
              </th>
              <th style={thStyle('version')}           onClick={() => handleSort('version')}>
                {t(lang, 'col_version')} <SortIcon active={sortBy === 'version'} />
              </th>
              <th style={{ ...thStyle(''), cursor: 'default' }}>{t(lang, 'col_addons')}</th>
              <th style={{ ...thStyle(''), cursor: 'default' }}>{t(lang, 'col_actions')}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={12} style={{ padding: 40, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
                  {t(lang, 'no_serials')}
                </td>
              </tr>
            ) : (
              filtered.map((serial, i) => {
                const addOns    = JSON.parse(serial.add_ons || '[]');
                const isSelected = selected.has(serial.id);
                const today     = new Date();
                const expDays   = Math.ceil((new Date(serial.expiry_date).getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
                const expSoon   = expDays >= 0 && expDays <= 60 && serial.status === 'active';

                return (
                  <tr
                    key={serial.id}
                    style={{
                      background: isSelected ? 'var(--accent-dim)' : 'transparent',
                      transition: 'background 0.08s',
                    }}
                    onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'var(--bg3)'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = isSelected ? 'var(--accent-dim)' : 'transparent'; }}
                  >
                    <td style={{ padding: '8px 12px', width: 36 }}>
                      <input
                        type="checkbox" checked={isSelected}
                        onChange={() => toggleSelect(serial.id)}
                        style={{ accentColor: 'var(--accent)', cursor: 'pointer' }}
                      />
                    </td>
                    <td style={{ padding: '8px 12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span
                          style={{
                            fontFamily: "'JetBrains Mono', monospace",
                            fontSize: 12, color: 'var(--accent)',
                            letterSpacing: '0.03em', cursor: 'pointer',
                          }}
                          title={t(lang, 'title_view_detail')}
                          onClick={() => { setDetailSerial(serial); setDetailTab('info'); }}
                        >
                          {serial.serial_number}
                        </span>
                        <button
                          onClick={() => copySerial(serial.id, serial.serial_number)}
                          style={{
                            background: 'none', border: 'none', padding: 3, borderRadius: 4,
                            cursor: 'pointer',
                            color: copiedId === serial.id ? 'var(--accent)' : 'var(--text3)',
                            opacity: copiedId === serial.id ? 1 : 0.5,
                            transition: 'all 0.1s',
                          }}
                          title={t(lang, 'title_copy')}
                        >
                          <CopyIcon />
                        </button>
                      </div>
                      {serial.notes && (
                        <div style={{ fontSize: 10.5, color: 'var(--text3)', marginTop: 2 }}>{serial.notes}</div>
                      )}
                    </td>
                    <td style={{ padding: '8px 12px', fontSize: 12.5, color: 'var(--text)' }}>{serial.customer_name}</td>
                    <td style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text2)' }}>{serial.customer_manager}</td>
                    <td style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text2)', fontFamily: "'JetBrains Mono', monospace" }}>{serial.customer_phone}</td>
                    <td style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text2)', fontFamily: "'JetBrains Mono', monospace", whiteSpace: 'nowrap' }}>{serial.purchase_date}</td>
                    <td style={{ padding: '8px 12px', fontSize: 12, whiteSpace: 'nowrap', fontFamily: "'JetBrains Mono', monospace" }}>
                      <span style={{ color: expSoon ? 'var(--yellow)' : 'var(--text2)' }}>{serial.expiry_date}</span>
                      {expSoon && (
                        <span style={{ fontSize: 10, marginLeft: 5, color: expDays <= 30 ? 'var(--red)' : 'var(--yellow)' }}>
                          D-{expDays}
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '8px 12px' }}>
                      <span className={`badge ${serial.status}`}>{statusLabel(serial.status)}</span>
                    </td>
                    <td style={{ padding: '8px 12px', fontSize: 11.5, color: 'var(--text2)', fontFamily: "'JetBrains Mono', monospace" }}>{serial.engine_build}</td>
                    <td style={{ padding: '8px 12px', fontSize: 11.5, color: 'var(--text2)', fontFamily: "'JetBrains Mono', monospace" }}>{serial.version}</td>
                    <td style={{ padding: '8px 12px' }}>
                      <div className="addon-tags">
                        {addOns.map((a: any, idx: number) => (
                          <span key={idx} className="addon-tag">{a.name}</span>
                        ))}
                        <span
                          className="addon-tag"
                          style={{ cursor: 'pointer', color: 'var(--accent)', borderColor: 'var(--accent)30' }}
                          onClick={() => { setDetailSerial(serial); setDetailTab('addons'); }}
                        >+</span>
                      </div>
                    </td>
                    <td style={{ padding: '8px 12px' }}>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => { setEditingSerial(serial); setShowForm(true); }}
                          style={{ display: 'flex', alignItems: 'center', gap: 3 }}
                          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--accent)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(61,216,200,0.4)'; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text2)';  (e.currentTarget as HTMLElement).style.borderColor = 'var(--border2)'; }}
                        >
                          <EditIcon /> {t(lang, 'edit')}
                        </button>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => handleRenew(serial.id)}
                          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--green)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(74,222,128,0.4)'; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text2)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--border2)'; }}
                        >
                          {t(lang, 'btn_renew')}
                        </button>
                        {serial.status === 'active' && (
                          <button
                            className="btn btn-sm"
                            style={{ background: 'var(--red-dim)', color: 'var(--red)', border: '1px solid rgba(240,82,82,0.3)' }}
                            onClick={() => handleCancel(serial.serial_number)}
                          >
                            {t(lang, 'btn_cancel_sub')}
                          </button>
                        )}
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => handleDelete(serial.id)}
                          style={{ display: 'flex', alignItems: 'center', gap: 3 }}
                          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--red)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(240,82,82,0.4)'; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text2)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--border2)'; }}
                        >
                          <TrashIcon />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ── Add / Edit form ── */}
      {showForm && (
        <SerialForm
          mode={editingSerial ? 'edit' : 'create'}
          initial={(editingSerial as any) ?? undefined}
          onSaved={handleFormSave}
          onClose={() => { setShowForm(false); setEditingSerial(null); }}
        />
      )}

      {/* ── Detail modal ── */}
      {detailSerial && (
        <div className="modal-overlay" onClick={() => setDetailSerial(null)}>
          <div className="modal" style={{ maxWidth: 600 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{t(lang, 'detail_title')}</h3>
              <button
                onClick={() => setDetailSerial(null)}
                style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', padding: 4, borderRadius: 5 }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--text)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--text3)'}
              >
                <CloseIcon />
              </button>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', padding: '0 20px' }}>
              {(['info', 'addons'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setDetailTab(tab)}
                  style={{
                    padding: '10px 16px', border: 'none', background: 'none', cursor: 'pointer',
                    fontSize: 13, fontFamily: 'inherit',
                    color: detailTab === tab ? 'var(--accent)' : 'var(--text3)',
                    borderBottom: `2px solid ${detailTab === tab ? 'var(--accent)' : 'transparent'}`,
                    marginBottom: -1,
                    transition: 'all 0.12s',
                  }}
                >
                  {tab === 'info' ? 'Info' : `Add-ons (${JSON.parse(detailSerial.add_ons || '[]').length})`}
                </button>
              ))}
            </div>

            <div className="modal-body">
              {detailTab === 'info' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 24px' }}>
                  <DetailField label={t(lang, 'col_serial')}         value={detailSerial.serial_number} mono />
                  <DetailField label={t(lang, 'col_status')}         value={statusLabel(detailSerial.status)} />
                  <DetailField label={t(lang, 'label_customer_name')} value={detailSerial.customer_name} />
                  <DetailField label={t(lang, 'label_manager')}      value={detailSerial.customer_manager} />
                  <DetailField label={t(lang, 'label_email')}        value={detailSerial.customer_email} />
                  <DetailField label={t(lang, 'label_phone')}        value={detailSerial.customer_phone} mono />
                  <DetailField label={t(lang, 'label_address')}      value={detailSerial.customer_address} colSpan />
                  <DetailField label={t(lang, 'label_purchase_date')} value={detailSerial.purchase_date} mono />
                  <DetailField label={t(lang, 'label_expiry_date')}  value={detailSerial.expiry_date} mono />
                  <DetailField label={t(lang, 'label_engine_build')} value={detailSerial.engine_build} mono />
                  <DetailField label={t(lang, 'label_version')}      value={detailSerial.version} mono />
                  <DetailField label={t(lang, 'label_notes')}        value={detailSerial.notes} colSpan />
                </div>
              )}

              {detailTab === 'addons' && (
                <div>
                  {(() => {
                    const addOns = JSON.parse(detailSerial.add_ons || '[]');
                    return addOns.length === 0 ? (
                      <div style={{ color: 'var(--text3)', textAlign: 'center', padding: '20px 0', fontSize: 13 }}>
                        {t(lang, 'no_addons')}
                      </div>
                    ) : (
                      <div style={{ marginBottom: 16 }}>
                        {addOns.map((a: any, i: number) => (
                          <div key={i} style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            padding: '8px 12px', marginBottom: 6,
                            background: 'var(--bg3)', borderRadius: 8, border: '1px solid var(--border2)',
                          }}>
                            <div>
                              <span style={{ fontWeight: 600, color: 'var(--accent)' }}>{a.name}</span>
                              <span style={{ marginLeft: 10, fontSize: 11, color: 'var(--text3)', fontFamily: "'JetBrains Mono', monospace" }}>
                                {a.added_date}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      type="text" value={newAddonInput}
                      onChange={e => setNewAddonInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleDetailAddAddon(); }}
                      placeholder={t(lang, 'label_addon_name')}
                      disabled={addonSaving}
                      style={{
                        flex: 1, background: 'var(--bg3)', border: '1px solid var(--border2)',
                        borderRadius: 7, padding: '7px 11px', color: 'var(--text)',
                        fontSize: 13, fontFamily: 'inherit', outline: 'none',
                      }}
                      onFocus={e => (e.target as HTMLElement).style.borderColor = 'var(--accent)'}
                      onBlur={e  => (e.target as HTMLElement).style.borderColor = 'var(--border2)'}
                    />
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={handleDetailAddAddon}
                      disabled={addonSaving || !newAddonInput.trim()}
                    >
                      {addonSaving ? '...' : t(lang, 'btn_add_addon')}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button className="btn btn-secondary btn-sm" onClick={() => { setEditingSerial(detailSerial); setDetailSerial(null); setShowForm(true); }}>
                {t(lang, 'edit')}
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => { handleRenew(detailSerial.id); setDetailSerial(null); }}>
                {t(lang, 'btn_renew')}
              </button>
              <button className="btn btn-primary btn-sm" onClick={() => setDetailSerial(null)}>
                {t(lang, 'close')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DetailField({ label, value, colSpan, mono }: { label: string; value: string; colSpan?: boolean; mono?: boolean }) {
  return (
    <div style={{ gridColumn: colSpan ? '1 / -1' : undefined }}>
      <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 3, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: 13, color: 'var(--text)', wordBreak: 'break-all', fontFamily: mono ? "'JetBrains Mono', monospace" : 'inherit' }}>
        {value || <span style={{ color: 'var(--border2)' }}>—</span>}
      </div>
    </div>
  );
}
