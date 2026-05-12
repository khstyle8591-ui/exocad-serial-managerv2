import React, { useState, useEffect, useCallback } from 'react';
import type { SerialWithCustomer } from '../../shared/types';
import SerialForm from '../components/SerialForm';
import ConfirmModal from '../components/ConfirmModal';
import LegacyImportWizard from '../components/LegacyImportWizard';
import SerialDetail from './SerialDetail';
import { useLang } from '../App';
import { t } from '../i18n';

type StatusFilter = 'all' | 'active' | 'not-activated' | 'expired' | 'cancelled' | 'broken';

const STATUS_TAB_KEYS: { key: StatusFilter; i18nKey: string }[] = [
  { key: 'all',           i18nKey: 'tab_all' },
  { key: 'active',        i18nKey: 'status_active' },
  { key: 'not-activated', i18nKey: 'status_not_activated' },
  { key: 'expired',       i18nKey: 'status_expired' },
  { key: 'cancelled',     i18nKey: 'status_cancelled' },
  { key: 'broken',        i18nKey: 'status_broken' },
];

export default function SerialData() {
  const { lang } = useLang();
  const [serials, setSerials] = useState<SerialWithCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [detailId, setDetailId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState<'create' | 'edit' | null>(null);
  const [editTarget, setEditTarget] = useState<SerialWithCustomer | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SerialWithCustomer | null>(null);
  const [showLegacy, setShowLegacy] = useState(false);
  const [legacyAvailable, setLegacyAvailable] = useState(false);
  const [excelMsg, setExcelMsg] = useState('');

  const ea = window.electronAPI;

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = search.trim()
        ? await ea.searchSerials(search.trim())
        : await ea.getSerials();
      setSerials(data);
    } catch (e: any) {
      setError(e?.message ?? t(lang, 'load_failed'));
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    ea.detectLegacy().then(r => setLegacyAvailable(r.available)).catch(() => {});
  }, []);

  useEffect(() => {
    const cleanup = ea.onLogsPush(() => load());
    return cleanup;
  }, [load]);

  const filtered = statusFilter === 'all'
    ? serials
    : serials.filter(s => s.status === statusFilter);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      const result = await ea.deleteSerial(deleteTarget.id);
      if (!result.success) { alert(result.error ?? t(lang, 'delete_failed')); return; }
      setSerials(prev => prev.filter(s => s.id !== deleteTarget.id));
      if (detailId === deleteTarget.id) setDetailId(null);
    } catch (e: any) {
      alert(e?.message ?? t(lang, 'error_occurred'));
    } finally {
      setDeleteTarget(null);
    }
  };

  const handleBulkImport = async () => {
    setExcelMsg('');
    try {
      const result = await ea.bulkImport();
      if (result.imported > 0) await load();
      const msg = result.errors.length > 0
        ? t(lang, 'import_done_with_errors').replace('{imported}', String(result.imported)).replace('{errors}', String(result.errors.length))
        : t(lang, 'import_done_count').replace('{n}', String(result.imported));
      setExcelMsg(msg);
    } catch (e: any) {
      setExcelMsg(t(lang, 'import_failed').replace('{error}', e?.message ?? ''));
    }
    setTimeout(() => setExcelMsg(''), 6000);
  };

  const handleExport = async () => {
    setExcelMsg('');
    try {
      const result = await ea.exportSerials(filtered);
      if (result.success) setExcelMsg(result.filePath ? t(lang, 'export_done_path').replace('{path}', result.filePath) : t(lang, 'export_done'));
      else if (result.error) setExcelMsg(t(lang, 'export_failed').replace('{error}', result.error));
    } catch (e: any) {
      setExcelMsg(t(lang, 'export_failed').replace('{error}', e?.message ?? ''));
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
        onBack={() => setDetailId(null)}
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
          <button onClick={() => ea.downloadExcelTemplate()} style={btnOutline}>
            📋 {t(lang, 'btn_download_template').replace('📋 ', '')}
          </button>
          <button onClick={handleBulkImport} style={btnOutline}>
            📥 {t(lang, 'excel_upload')}
          </button>
          <button onClick={handleExport} style={btnOutline} disabled={filtered.length === 0}>
            📤 {t(lang, 'notification_export')}
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

      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
        {STATUS_TAB_KEYS.map(tab => (
          <button key={tab.key} onClick={() => setStatusFilter(tab.key)} style={{
            padding: '5px 14px', borderRadius: 20, fontSize: 12, cursor: 'pointer',
            border: '1px solid',
            background: statusFilter === tab.key ? 'var(--accent)' : 'var(--bg3)',
            color: statusFilter === tab.key ? '#0d1117' : 'var(--text2)',
            borderColor: statusFilter === tab.key ? 'var(--accent)' : 'var(--border)',
            fontWeight: statusFilter === tab.key ? 600 : 400,
          }}>
            {t(lang, tab.i18nKey as any)}
            {tab.key !== 'all' && (
              <span style={{ marginLeft: 4, opacity: 0.7 }}>
                {serials.filter(s => s.status === tab.key).length}
              </span>
            )}
          </button>
        ))}
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
              <th style={th}>{t(lang, 'col_serial')}</th>
              <th style={th}>{t(lang, 'col_customer')}</th>
              <th style={th}>{t(lang, 'label_email')}</th>
              <th style={th}>{t(lang, 'col_manager')}</th>
              <th style={th}>{t(lang, 'col_status')}</th>
              <th style={th}>{t(lang, 'col_expiry_date')}</th>
              <th style={th}>Stop</th>
              <th style={th}>{t(lang, 'col_actions')}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: 40, color: 'var(--text3)' }}>{t(lang, 'loading')}</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: 40, color: 'var(--text3)' }}>{t(lang, 'no_data')}</td></tr>
            ) : filtered.map(serial => (
              <tr
                key={serial.id}
                onClick={() => setDetailId(serial.id)}
                style={{ cursor: 'pointer', borderBottom: '1px solid var(--border)' }}
                onMouseEnter={e => (e.currentTarget as HTMLTableRowElement).style.background = 'var(--bg3)'}
                onMouseLeave={e => (e.currentTarget as HTMLTableRowElement).style.background = 'transparent'}
              >
                <td style={td}>
                  <code style={{ fontSize: 12, background: 'var(--bg3)', padding: '2px 6px', borderRadius: 4, color: 'var(--text)' }}>
                    {serial.serial_number}
                  </code>
                </td>
                <td style={td}>{serial.customer?.name ?? '-'}</td>
                <td style={td}>{serial.customer?.email ?? '-'}</td>
                <td style={td}>{serial.customer?.sales_manager ?? '-'}</td>
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
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text3)' }}>
        {t(lang, 'serial_data_count_summary').replace('{shown}', String(filtered.length)).replace('{total}', String(serials.length))}
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
