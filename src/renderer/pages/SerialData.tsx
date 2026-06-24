import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { SerialListResult, SerialWithCustomer } from '../../shared/types';
import SerialForm from '../components/SerialForm';
import ConfirmModal from '../components/ConfirmModal';
import LegacyImportWizard from '../components/LegacyImportWizard';
import SerialDetail from './SerialDetail';
import { useLang, useNav } from '../App';
import { t } from '../i18n';
import { api } from '../client';

type StatusFilter = 'all' | 'active' | 'not-activated' | 'expired' | 'cancelled' | 'broken';
type SpecialFilter = 'expiring' | null;

const STATUS_TAB_KEYS: { key: StatusFilter; i18nKey: string }[] = [
  { key: 'all',           i18nKey: 'tab_all' },
  { key: 'active',        i18nKey: 'status_active' },
  { key: 'not-activated', i18nKey: 'status_not_activated' },
  { key: 'expired',       i18nKey: 'status_expired' },
  { key: 'cancelled',     i18nKey: 'status_cancelled' },
  { key: 'broken',        i18nKey: 'status_broken' },
];

const PAGE_SIZE = 50;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export default function SerialData() {
  const { lang } = useLang();
  const { params } = useNav();
  const [serials, setSerials] = useState<SerialWithCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [specialFilter, setSpecialFilter] = useState<SpecialFilter>(null);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [detailId, setDetailId] = useState<number | null>(null);

  // pushState when detail opens so browser back closes it
  useEffect(() => {
    if (detailId !== null) {
      window.history.pushState({ serialDetail: detailId }, '');
      const onPop = () => setDetailId(null);
      window.addEventListener('popstate', onPop);
      return () => window.removeEventListener('popstate', onPop);
    }
  }, [detailId]);
  const [showForm, setShowForm] = useState<'create' | 'edit' | null>(null);
  const [editTarget, setEditTarget] = useState<SerialWithCustomer | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SerialWithCustomer | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [showLegacy, setShowLegacy] = useState(false);
  const [legacyAvailable, setLegacyAvailable] = useState(false);
  const [excelMsg, setExcelMsg] = useState('');
  const importInputRef = useRef<HTMLInputElement>(null);

    const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.listSerials({
        limit: PAGE_SIZE,
        offset,
        search: search.trim() || undefined,
        status: specialFilter ? undefined : statusFilter,
        expiring_this_month: specialFilter === 'expiring' || undefined,
      }) as SerialListResult;
      setSerials(data.items);
      setTotal(data.total);
    } catch (e) {
      setError(errorMessage(e) || t(lang, 'load_failed'));
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, specialFilter, offset]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    setOffset(0);
  }, [search, statusFilter, specialFilter]);

  useEffect(() => {
    const filter = params?.filter;
    if (filter === 'expiring') {
      setStatusFilter('all');
      setSpecialFilter('expiring');
    } else if (['active', 'not-activated', 'expired', 'cancelled', 'broken'].includes(filter)) {
      setStatusFilter(filter as StatusFilter);
      setSpecialFilter(null);
    } else {
      setStatusFilter('all');
      setSpecialFilter(null);
    }
  }, [params]);

  useEffect(() => {
    api.detectLegacy().then(r => setLegacyAvailable(r.available)).catch(() => {});
  }, []);

  const filtered = serials;
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);
  const selectedCount = selectedIds.size;
  const pageIds = filtered.map(serial => serial.id);
  const allPageSelected = pageIds.length > 0 && pageIds.every(id => selectedIds.has(id));

  useEffect(() => {
    setSelectedIds(prev => {
      const visible = new Set(serials.map(serial => serial.id));
      const next = new Set(Array.from(prev).filter(id => visible.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [serials]);

  const isDeleteSuccess = (result: unknown): boolean => {
    if (!result || typeof result !== 'object') return true;
    const value = result as { success?: boolean; ok?: boolean };
    return value.success !== false && value.ok !== false;
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      const result = await api.deleteSerial(deleteTarget.id);
      if (!isDeleteSuccess(result)) { alert((result as { error?: string }).error ?? t(lang, 'delete_failed')); return; }
      setSerials(prev => prev.filter(s => s.id !== deleteTarget.id));
      setSelectedIds(prev => {
        const next = new Set(prev);
        next.delete(deleteTarget.id);
        return next;
      });
      if (detailId === deleteTarget.id) setDetailId(null);
    } catch (e) {
      alert(errorMessage(e) || t(lang, 'error_occurred'));
    } finally {
      setDeleteTarget(null);
    }
  };

  const toggleSelected = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const togglePageSelected = () => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allPageSelected) pageIds.forEach(id => next.delete(id));
      else pageIds.forEach(id => next.add(id));
      return next;
    });
  };

  const handleBulkDelete = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;

    const failed: string[] = [];
    for (const id of ids) {
      const serial = serials.find(item => item.id === id);
      try {
        const result = await api.deleteSerial(id);
        if (!isDeleteSuccess(result)) failed.push(serial?.serial_number ?? String(id));
      } catch {
        failed.push(serial?.serial_number ?? String(id));
      }
    }

    setBulkDeleteOpen(false);
    setSelectedIds(new Set());
    await load();
    if (failed.length > 0) {
      alert(`${t(lang, 'delete_failed')}: ${failed.join(', ')}`);
    }
  };

  const handleBulkImport = async (file: File) => {
    setExcelMsg('');
    try {
      const result = await api.bulkImport(file);
      if (result.imported > 0) await load();
      const msg = result.errors.length > 0
        ? t(lang, 'import_done_with_errors').replace('{imported}', String(result.imported)).replace('{errors}', String(result.errors.length))
        : t(lang, 'import_done_count').replace('{n}', String(result.imported));
      setExcelMsg(msg);
    } catch (e) {
      setExcelMsg(t(lang, 'import_failed').replace('{error}', errorMessage(e)));
    }
    setTimeout(() => setExcelMsg(''), 6000);
  };

  const handleExport = async () => {
    setExcelMsg('');
    try {
      const result = await api.exportSerialsByFilter({
        search: search.trim() || undefined,
        status: specialFilter ? undefined : statusFilter,
        expiring_this_month: specialFilter === 'expiring' || undefined,
      });
      if (result.success) setExcelMsg(result.filePath ? t(lang, 'export_done_path').replace('{path}', result.filePath) : t(lang, 'export_done'));
      else if (result.error) setExcelMsg(t(lang, 'export_failed').replace('{error}', result.error));
    } catch (e) {
      setExcelMsg(t(lang, 'export_failed').replace('{error}', errorMessage(e)));
    }
    setTimeout(() => setExcelMsg(''), 6000);
  };

  const handleSaved = (serial: SerialWithCustomer) => {
    setSerials(prev => {
      const idx = prev.findIndex(s => s.id === serial.id);
      if (idx >= 0) { const next = [...prev]; next[idx] = serial; return next; }
      return [serial, ...prev];
    });
    setShowForm(null);
    setEditTarget(null);
  };

  if (detailId !== null) {
    return (
      <SerialDetail
        serialId={detailId}
        onBack={() => window.history.back()}
        onUpdated={serial => setSerials(prev => prev.map(s => s.id === serial.id ? serial : s))}
        onDeleted={id => { setSerials(prev => prev.filter(s => s.id !== id)); setDetailId(null); }}
      />
    );
  }

  return (
    <div style={{ padding: '24px 28px', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>{t(lang, 'page_title_serial_data')}</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          {legacyAvailable && (
            <button onClick={() => setShowLegacy(true)} style={btnOutline}>📦 Legacy Import</button>
          )}
          <button onClick={() => api.downloadTemplate()} style={btnOutline}>
            📋 {t(lang, 'btn_download_template').replace('📋 ', '')}
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            style={{ display: 'none' }}
            onChange={event => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void handleBulkImport(file);
            }}
          />
          <button onClick={() => importInputRef.current?.click()} style={btnOutline}>
            📥 {t(lang, 'excel_upload')}
          </button>
          <button onClick={handleExport} style={btnOutline} disabled={filtered.length === 0}>
            {t(lang, 'btn_serial_db_download')}
          </button>
          <button onClick={() => { setEditTarget(null); setShowForm('create'); }} style={btnPrimary}>
            {t(lang, 'btn_new_register')}
          </button>
        </div>
      </div>

      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder={t(lang, 'search_placeholder')}
        style={{
          padding: '9px 14px', border: '1px solid var(--border2)', borderRadius: 8,
          fontSize: 13, marginBottom: 12, width: '100%', boxSizing: 'border-box',
          background: 'var(--bg3)', color: 'var(--text)',
        }}
      />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {STATUS_TAB_KEYS.map(tab => (
            <button key={tab.key} onClick={() => { setStatusFilter(tab.key); setSpecialFilter(null); }} style={{
              padding: '5px 14px', borderRadius: 20, fontSize: 12, cursor: 'pointer',
              border: '1px solid',
              background: statusFilter === tab.key ? 'var(--accent)' : 'var(--bg3)',
              color: statusFilter === tab.key ? '#0d1117' : 'var(--text2)',
              borderColor: statusFilter === tab.key ? 'var(--accent)' : 'var(--border)',
              fontWeight: statusFilter === tab.key ? 600 : 400,
            }}>
              {t(lang, tab.i18nKey as any)}
            </button>
          ))}
          {specialFilter === 'expiring' && (
            <button style={{
              padding: '5px 14px', borderRadius: 20, fontSize: 12,
              border: '1px solid var(--accent)', background: 'var(--accent)', color: '#0d1117',
              fontWeight: 600,
            }}>
              {t(lang, 'dash_stat_expiring')}
            </button>
          )}
        </div>
        <button
          onClick={() => setBulkDeleteOpen(true)}
          style={{ ...btnDanger, opacity: selectedCount === 0 ? 0.55 : 1, cursor: selectedCount === 0 ? 'not-allowed' : 'pointer' }}
          disabled={selectedCount === 0}
        >
          {t(lang, 'selected_delete_count').replace('{n}', String(selectedCount))}
        </button>
      </div>

      {error && <div style={{ color: '#fc8181', marginBottom: 12, fontSize: 13 }}>⚠ {error}</div>}
      {excelMsg && (
        <div style={{ color: 'var(--accent)', marginBottom: 12, fontSize: 13, background: 'rgba(61,216,200,0.08)', border: '1px solid rgba(61,216,200,0.2)', borderRadius: 6, padding: '6px 12px' }}>
          ✓ {excelMsg}
        </div>
      )}

      <div style={{ flex: 1, overflow: 'auto', borderRadius: 10, border: '1px solid var(--border)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--bg3)', position: 'sticky', top: 0 }}>
              <th style={{ ...th, width: 36, textAlign: 'center' }}>
                <input
                  type="checkbox"
                  checked={allPageSelected}
                  disabled={filtered.length === 0}
                  onChange={togglePageSelected}
                  onClick={e => e.stopPropagation()}
                />
              </th>
              <th style={th}>{t(lang, 'col_serial')}</th>
              <th style={th}>{t(lang, 'col_customer')}</th>
              <th style={th}>{t(lang, 'label_email')}</th>
              <th style={th}>{t(lang, 'col_manager')}</th>
              <th style={th}>{t(lang, 'label_main_product')}</th>
              <th style={th}>{t(lang, 'col_status')}</th>
              <th style={th}>{t(lang, 'col_expiry_date')}</th>
              <th style={th}>Stop</th>
              <th style={th}>{t(lang, 'col_actions')}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} style={{ textAlign: 'center', padding: 40, color: 'var(--text3)' }}>{t(lang, 'loading')}</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={10} style={{ textAlign: 'center', padding: 40, color: 'var(--text3)' }}>{t(lang, 'no_data')}</td></tr>
            ) : filtered.map(serial => {
              const selected = selectedIds.has(serial.id);
              return (
                <tr
                  key={serial.id}
                  onClick={() => setDetailId(serial.id)}
                  style={{ cursor: 'pointer', borderBottom: '1px solid var(--border)', background: selected ? 'rgba(61,216,200,0.08)' : 'transparent' }}
                  onMouseEnter={e => (e.currentTarget as HTMLTableRowElement).style.background = 'var(--bg3)'}
                  onMouseLeave={e => (e.currentTarget as HTMLTableRowElement).style.background = selected ? 'rgba(61,216,200,0.08)' : 'transparent'}
                >
                  <td style={{ ...td, textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleSelected(serial.id)}
                    />
                  </td>
                  <td style={td}>
                    <code style={{ fontSize: 12, background: 'var(--bg3)', padding: '2px 6px', borderRadius: 4, color: 'var(--text)' }}>
                      {serial.serial_number}
                    </code>
                  </td>
                  <td style={td}>{serial.customer?.name ?? '-'}</td>
                  <td style={td}>{serial.customer?.email ?? '-'}</td>
                  <td style={td}>{serial.customer?.sales_manager ?? '-'}</td>
                  <td style={td}>{serial.main_product || '-'}</td>
                  <td style={td}><StatusBadge status={serial.status} lang={lang} /></td>
                  <td style={td}>{expiryDisplay(serial.expiry_date)}</td>
                  <td style={{ ...td, textAlign: 'center' }}>
                    {serial.renewal_stop_requested ? <span title={t(lang, 'serial_stop_requested')} style={{ color: '#fc8181' }}>🛑</span> : ''}
                  </td>
                  <td style={td} onClick={e => e.stopPropagation()}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <ActionBtn label={t(lang, 'edit')} onClick={() => { setEditTarget(serial); setShowForm('edit'); }} />
                      <ActionBtn label={t(lang, 'delete')} danger onClick={() => setDeleteTarget(serial)} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, fontSize: 12, color: 'var(--text3)' }}>
        <span>
          {t(lang, 'serial_data_count_summary').replace('{shown}', String(filtered.length)).replace('{total}', String(total))}
        </span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            disabled={offset === 0 || loading}
            style={pagerBtn}
          >
            ‹
          </button>
          <span style={{ minWidth: 64, textAlign: 'center' }}>{currentPage} / {totalPages}</span>
          <button
            onClick={() => setOffset(offset + PAGE_SIZE)}
            disabled={offset + PAGE_SIZE >= total || loading}
            style={pagerBtn}
          >
            ›
          </button>
        </div>
      </div>

      {showForm && (
        <SerialForm
          mode={showForm}
          initial={editTarget ?? undefined}
          onSaved={handleSaved}
          onClose={() => { setShowForm(null); setEditTarget(null); }}
        />
      )}

      {deleteTarget && (
        <ConfirmModal
          title={t(lang, 'serial_delete_title')}
          message={t(lang, 'serial_delete_confirm_name').replace('{sn}', deleteTarget.serial_number)}
          confirmLabel={t(lang, 'delete')}
          danger
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {bulkDeleteOpen && (
        <ConfirmModal
          title={t(lang, 'serial_delete_title')}
          message={t(lang, 'selected_delete_confirm').replace('{n}', String(selectedCount))}
          confirmLabel={t(lang, 'delete')}
          danger
          onConfirm={handleBulkDelete}
          onCancel={() => setBulkDeleteOpen(false)}
        />
      )}

      {showLegacy && (
        <LegacyImportWizard
          onClose={() => setShowLegacy(false)}
          onDone={() => { setShowLegacy(false); load(); }}
        />
      )}
    </div>
  );
}

function StatusBadge({ status, lang }: { status: string; lang: any }) {
  const map: Record<string, { bg: string; color: string }> = {
    active:          { bg: 'rgba(34,197,94,0.15)',    color: '#22c55e' },
    cancelled:       { bg: 'rgba(239,68,68,0.15)',    color: '#fc8181' },
    expired:         { bg: 'rgba(245,158,11,0.15)',   color: '#fbbf24' },
    'not-activated': { bg: 'rgba(156,163,175,0.12)',  color: 'var(--text3)' },
    broken:          { bg: 'rgba(167,139,250,0.15)',  color: '#a78bfa' },
  };
  const labelKey: Record<string, string> = {
    active: 'status_active', cancelled: 'status_cancelled', expired: 'status_expired',
    'not-activated': 'status_not_activated', broken: 'status_broken',
  };
  const c = map[status] ?? { bg: 'var(--bg3)', color: 'var(--text3)' };
  const label = labelKey[status] ? t(lang, labelKey[status] as any) : status;
  return (
    <span style={{ padding: '3px 9px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: c.bg, color: c.color }}>
      {label}
    </span>
  );
}

function ActionBtn({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} style={{
      padding: '3px 10px', fontSize: 11, borderRadius: 4, cursor: 'pointer', border: '1px solid',
      background: danger ? 'rgba(239,68,68,0.1)' : 'var(--bg3)',
      color: danger ? '#fc8181' : 'var(--text2)',
      borderColor: danger ? 'rgba(239,68,68,0.3)' : 'var(--border)',
    }}>
      {label}
    </button>
  );
}

function expiryDisplay(date: string | null): React.ReactNode {
  if (!date) return <span style={{ color: 'var(--text3)' }}>-</span>;
  const d = new Date(date);
  const today = new Date();
  const daysLeft = Math.ceil((d.getTime() - today.getTime()) / 86400000);
  const label = date.slice(0, 10);
  if (daysLeft < 0) return <span style={{ color: '#fc8181' }}>{label}</span>;
  if (daysLeft <= 30) return <span style={{ color: '#fbbf24' }}>{label} ({daysLeft}d)</span>;
  return <span style={{ color: 'var(--text)' }}>{label}</span>;
}

const th: React.CSSProperties = {
  padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600,
  color: 'var(--text3)', borderBottom: '2px solid var(--border)',
};
const td: React.CSSProperties = {
  padding: '10px 12px', verticalAlign: 'middle', color: 'var(--text)',
};
const btnPrimary: React.CSSProperties = {
  padding: '8px 18px', borderRadius: 7, background: 'var(--accent)', color: '#0d1117',
  border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 13,
};
const btnOutline: React.CSSProperties = {
  padding: '8px 14px', borderRadius: 7, background: 'var(--bg3)', color: 'var(--text)',
  border: '1px solid var(--border2)', cursor: 'pointer', fontSize: 13,
};
const btnDanger: React.CSSProperties = {
  padding: '8px 14px', borderRadius: 7, background: 'rgba(239,68,68,0.12)', color: '#fc8181',
  border: '1px solid rgba(239,68,68,0.35)', cursor: 'pointer', fontSize: 13,
};
const pagerBtn: React.CSSProperties = {
  width: 28,
  height: 26,
  borderRadius: 6,
  border: '1px solid var(--border2)',
  background: 'var(--bg3)',
  color: 'var(--text)',
  cursor: 'pointer',
  fontSize: 16,
  lineHeight: 1,
};
