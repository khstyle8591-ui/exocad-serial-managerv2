import React, { useEffect, useState } from 'react';
import SerialForm from '../components/SerialForm';
import { useLang, useNav } from '../App';
import { t } from '../i18n';
import { api } from '../api';

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

export default function Serials() {
  const { lang } = useLang();
  const [serials, setSerials] = useState<Serial[]>([]);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingSerial, setEditingSerial] = useState<Serial | null>(null);
  const [detailSerial, setDetailSerial] = useState<Serial | null>(null);
  // 상세 모달 탭: 'info' | 'addons'
  const [detailTab, setDetailTab] = useState<'info' | 'addons'>('info');
  const [loading, setLoading] = useState(true);
  // 새 add-on 입력 (상세 모달용)
  const [newAddonInput, setNewAddonInput] = useState('');
  const [addonSaving, setAddonSaving] = useState(false);

  const { params } = useNav();

  useEffect(() => { loadSerials(); }, [params]);

  const loadSerials = async () => {
    try {
      let data = await api.getSerials() as Serial[];

      // Dashboard 등에서 넘어온 필터 처리
      if (params?.filter) {
        const filter = params.filter;
        if (filter === 'active') data = data.filter(s => s.status === 'active');
        else if (filter === 'cancelled') data = data.filter(s => s.status === 'cancelled');
        else if (filter === 'expired') data = data.filter(s => s.status === 'expired');
        else if (filter === 'not-activated') data = data.filter(s => s.status === 'not-activated');
        else if (filter === 'expiring') {
          const now = new Date();
          const todayStr = now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
          const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
          const endOfMonthStr = lastDayOfMonth.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
          data = data.filter(s => s.status === 'active' && s.expiry_date >= todayStr && s.expiry_date <= endOfMonthStr);
        }
      }

      setSerials(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async () => {
    if (!search.trim()) { loadSerials(); return; }
    try {
      const data = await api.searchSerials(search) as Serial[];
      setSerials(data);
    } catch (err) {
      console.error(err);
    }
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
    if (result.success) {
      alert(t(lang, 'cancel_success'));
    } else {
      alert(`${t(lang, 'cancel_fail')}${result.error}`);
    }
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
      if (result.imported > 0) alert(`${result.imported}건 임포트 완료`);
      if (result.errors.length > 0) alert(`오류:\n${result.errors.join('\n')}`);
      loadSerials();
    };
    input.click();
  };

  const handleDownloadTemplate = async () => {
    api.downloadTemplate();
  };

  const handleFormSave = async (input: any) => {
    try {
      if (editingSerial) {
        await api.updateSerial(editingSerial.id, input);
      } else {
        await api.createSerial(input);
      }
      setShowForm(false);
      setEditingSerial(null);
      loadSerials();
    } catch (err: any) {
      alert(err.message || '저장 중 오류가 발생했습니다.');
    }
  };

  // 상세 모달에서 add-on 추가
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

  const statusLabel = (s: string) => {
    if (s === 'active') return t(lang, 'status_active');
    if (s === 'cancelled') return t(lang, 'status_cancelled');
    if (s === 'expired') return t(lang, 'status_expired');
    if (s === 'not-activated') return t(lang, 'status_not_activated');
    return s;
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}>{t(lang, 'loading')}</div>;

  return (
    <div>
      {/* ── 페이지 헤더 ── */}
      <div className="page-header">
        <h1 className="page-title">{t(lang, 'page_title_serials')}</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={handleDownloadTemplate} title="엑셀 업로드용 템플릿 다운로드">
            {t(lang, 'btn_download_template')}
          </button>
          <button className="btn btn-success" onClick={handleBulkImport}>
            {t(lang, 'btn_excel_upload')}
          </button>
          <button className="btn btn-primary" onClick={() => { setEditingSerial(null); setShowForm(true); }}>
            {t(lang, 'btn_new_register')}
          </button>
        </div>
      </div>

      {/* ── 검색 바 ── */}
      <div className="table-container">
        <div className="table-toolbar">
          <input
            type="text"
            placeholder={t(lang, 'search_placeholder')}
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            style={{ minWidth: 320 }}
          />
          <button className="btn btn-secondary" onClick={handleSearch}>{t(lang, 'search')}</button>
          <button className="btn btn-secondary" onClick={() => { setSearch(''); loadSerials(); }}>{t(lang, 'reset')}</button>
        </div>

        {/* ── 테이블 ── */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ minWidth: 1200 }}>
            <thead>
              <tr>
                <th style={{ minWidth: 140 }}>{t(lang, 'col_serial')}</th>
                <th style={{ minWidth: 110 }}>{t(lang, 'col_customer')}</th>
                <th style={{ minWidth: 90 }}>{t(lang, 'col_manager')}</th>
                <th style={{ minWidth: 110 }}>{t(lang, 'col_phone')}</th>
                <th style={{ minWidth: 100 }}>{t(lang, 'col_purchase_date')}</th>
                <th style={{ minWidth: 100 }}>{t(lang, 'col_expiry_date')}</th>
                <th style={{ minWidth: 70 }}>{t(lang, 'col_status')}</th>
                <th style={{ minWidth: 80 }}>{t(lang, 'col_engine_build')}</th>
                <th style={{ minWidth: 70 }}>{t(lang, 'col_version')}</th>
                <th style={{ minWidth: 120 }}>{t(lang, 'col_addons')}</th>
                <th style={{ minWidth: 190 }}>{t(lang, 'col_actions')}</th>
              </tr>
            </thead>
            <tbody>
              {serials.length === 0 ? (
                <tr>
                  <td colSpan={11} style={{ textAlign: 'center', padding: 40, color: '#888' }}>
                    {t(lang, 'no_serials')}
                  </td>
                </tr>
              ) : (
                serials.map(serial => {
                  const addOns = JSON.parse(serial.add_ons || '[]');
                  return (
                    <tr key={serial.id}>
                      <td>
                        <strong
                          style={{ cursor: 'pointer', color: '#6366f1' }}
                          title="클릭하여 상세 정보 보기"
                          onClick={() => { setDetailSerial(serial); setDetailTab('info'); }}
                        >
                          {serial.serial_number}
                        </strong>
                      </td>
                      <td>{serial.customer_name}</td>
                      <td>{serial.customer_manager}</td>
                      <td>{serial.customer_phone}</td>
                      <td>{serial.purchase_date}</td>
                      <td>{serial.expiry_date}</td>
                      <td>
                        <span className={`badge ${serial.status}`}>
                          {statusLabel(serial.status)}
                        </span>
                      </td>
                      <td>{serial.engine_build}</td>
                      <td>{serial.version}</td>
                      <td>
                        <div className="addon-tags">
                          {addOns.map((a: any, i: number) => (
                            <span key={i} className="addon-tag">{a.name}</span>
                          ))}
                          {/* + 클릭 → 상세 모달 add-ons 탭 열기 */}
                          <span
                            className="addon-tag"
                            style={{ cursor: 'pointer', background: '#f0f0f0', color: '#666' }}
                            onClick={() => { setDetailSerial(serial); setDetailTab('addons'); }}
                          >+</span>
                        </div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => { setEditingSerial(serial); setShowForm(true); }}
                          >{t(lang, 'edit')}</button>
                          <button
                            className="btn btn-success btn-sm"
                            onClick={() => handleRenew(serial.id)}
                          >{t(lang, 'btn_renew')}</button>
                          {serial.status === 'active' && (
                            <button
                              className="btn btn-danger btn-sm"
                              onClick={() => handleCancel(serial.serial_number)}
                            >{t(lang, 'btn_cancel_sub')}</button>
                          )}
                          <button
                            className="btn btn-sm"
                            style={{ background: '#fecaca', color: '#dc2626' }}
                            onClick={() => handleDelete(serial.id)}
                          >{t(lang, 'delete')}</button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── 신규 등록 / 수정 폼 ── */}
      {showForm && (
        <SerialForm
          serial={editingSerial}
          onSave={handleFormSave}
          onClose={() => { setShowForm(false); setEditingSerial(null); }}
        />
      )}

      {/* ── 상세 정보 + Add-on 통합 모달 ── */}
      {detailSerial && (
        <div className="modal-overlay" onClick={() => setDetailSerial(null)}>
          <div className="modal" style={{ maxWidth: 600 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{t(lang, 'detail_title')}</h3>
              <button className="btn btn-sm btn-secondary" onClick={() => setDetailSerial(null)}>✕</button>
            </div>

            {/* 탭 */}
            <div style={{ display: 'flex', borderBottom: '2px solid #e5e7eb', marginBottom: 16 }}>
              <button
                onClick={() => setDetailTab('info')}
                style={{
                  padding: '8px 20px', border: 'none', background: 'none', cursor: 'pointer',
                  fontWeight: detailTab === 'info' ? 700 : 400,
                  color: detailTab === 'info' ? '#6366f1' : '#6b7280',
                  borderBottom: detailTab === 'info' ? '2px solid #6366f1' : '2px solid transparent',
                  marginBottom: -2,
                }}
              >
                📋 Info
              </button>
              <button
                onClick={() => setDetailTab('addons')}
                style={{
                  padding: '8px 20px', border: 'none', background: 'none', cursor: 'pointer',
                  fontWeight: detailTab === 'addons' ? 700 : 400,
                  color: detailTab === 'addons' ? '#6366f1' : '#6b7280',
                  borderBottom: detailTab === 'addons' ? '2px solid #6366f1' : '2px solid transparent',
                  marginBottom: -2,
                }}
              >
                🧩 Add-ons ({JSON.parse(detailSerial.add_ons || '[]').length})
              </button>
            </div>

            {/* Info 탭 */}
            {detailTab === 'info' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 24px', padding: '0 0 16px' }}>
                <DetailField label={t(lang, 'col_serial')} value={detailSerial.serial_number} />
                <DetailField label={t(lang, 'col_status')} value={statusLabel(detailSerial.status)} />
                <DetailField label={t(lang, 'label_customer_name')} value={detailSerial.customer_name} />
                <DetailField label={t(lang, 'label_manager')} value={detailSerial.customer_manager} />
                <DetailField label={t(lang, 'label_email')} value={detailSerial.customer_email} />
                <DetailField label={t(lang, 'label_phone')} value={detailSerial.customer_phone} />
                <DetailField label={t(lang, 'label_address')} value={detailSerial.customer_address} colSpan />
                <DetailField label={t(lang, 'label_purchase_date')} value={detailSerial.purchase_date} />
                <DetailField label={t(lang, 'label_expiry_date')} value={detailSerial.expiry_date} />
                <DetailField label={t(lang, 'label_engine_build')} value={detailSerial.engine_build} />
                <DetailField label={t(lang, 'label_version')} value={detailSerial.version} />
                <DetailField label={t(lang, 'label_notes')} value={detailSerial.notes} colSpan />
              </div>
            )}

            {/* Add-ons 탭 */}
            {detailTab === 'addons' && (
              <div style={{ padding: '0 0 16px' }}>
                {/* 기존 add-ons */}
                {(() => {
                  const addOns = JSON.parse(detailSerial.add_ons || '[]');
                  return addOns.length === 0 ? (
                    <div style={{ color: '#9ca3af', textAlign: 'center', padding: '20px 0', fontSize: 14 }}>
                      등록된 Add-on이 없습니다.
                    </div>
                  ) : (
                    <div style={{ marginBottom: 16 }}>
                      {addOns.map((a: any, i: number) => (
                        <div key={i} style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          padding: '8px 12px', marginBottom: 6,
                          background: '#f5f3ff', borderRadius: 8, border: '1px solid #ddd6fe',
                        }}>
                          <div>
                            <span style={{ fontWeight: 600, color: '#5b21b6' }}>{a.name}</span>
                            <span style={{ marginLeft: 10, fontSize: 12, color: '#9ca3af' }}>{a.added_date}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}

                {/* 새 add-on 추가 */}
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="text"
                    value={newAddonInput}
                    onChange={e => setNewAddonInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleDetailAddAddon(); }}
                    placeholder={t(lang, 'label_addon_name')}
                    style={{ flex: 1 }}
                    disabled={addonSaving}
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

            <div className="modal-footer">
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setEditingSerial(detailSerial);
                  setDetailSerial(null);
                  setShowForm(true);
                }}
              >✏️ {t(lang, 'edit')}</button>
              <button
                className="btn btn-success btn-sm"
                onClick={() => { handleRenew(detailSerial.id); setDetailSerial(null); }}
              >{t(lang, 'btn_renew')}</button>
              <button className="btn btn-primary" onClick={() => setDetailSerial(null)}>{t(lang, 'close')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DetailField({ label, value, colSpan }: { label: string; value: string; colSpan?: boolean }) {
  return (
    <div style={{ gridColumn: colSpan ? '1 / -1' : undefined }}>
      <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 2, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: 14, color: '#111827', wordBreak: 'break-all' }}>{value || <span style={{ color: '#d1d5db' }}>—</span>}</div>
    </div>
  );
}
