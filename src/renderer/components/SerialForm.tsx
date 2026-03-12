import React, { useState } from 'react';
import { useLang } from '../App';
import { t } from '../i18n';

interface AddOnRow {
  name: string;
  added_date: string;
}

interface Props {
  serial: any | null;
  onSave: (input: any) => void;
  onClose: () => void;
}

export default function SerialForm({ serial, onSave, onClose }: Props) {
  const { lang } = useLang();

  const [form, setForm] = useState({
    serial_number:    serial?.serial_number    || '',
    customer_name:    serial?.customer_name    || '',
    customer_email:   serial?.customer_email   || '',
    customer_address: serial?.customer_address || '',
    customer_phone:   serial?.customer_phone   || '',
    customer_manager: serial?.customer_manager || '',
    purchase_date:    serial?.purchase_date    || new Date().toISOString().slice(0, 10),
    expiry_date:      serial?.expiry_date      || '',
    engine_build:     serial?.engine_build     || '',
    version:          serial?.version          || '',
    notes:            serial?.notes            || '',
    status:           serial?.status           || 'active',
  });

  // Add-ons 관리 (등록/수정 폼 내부)
  const [addOns, setAddOns] = useState<AddOnRow[]>(() => {
    try {
      return JSON.parse(serial?.add_ons || '[]');
    } catch {
      return [];
    }
  });
  const [newAddonName, setNewAddonName] = useState('');

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleAddAddon = () => {
    const name = newAddonName.trim();
    if (!name) return;
    setAddOns([...addOns, { name, added_date: new Date().toISOString().slice(0, 10) }]);
    setNewAddonName('');
  };

  const handleRemoveAddon = (idx: number) => {
    setAddOns(addOns.filter((_, i) => i !== idx));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const isNotActivated = form.status === 'not-activated';
    if (!form.serial_number || (!isNotActivated && !form.expiry_date)) {
      alert(t(lang, 'required_fields'));
      return;
    }
    onSave({ ...form, add_ons: addOns });
  };

  return (
    // ★ overlay 클릭해도 닫히지 않도록: onClick={onClose} 제거
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 640, width: '100%' }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{serial ? t(lang, 'form_title_edit') : t(lang, 'form_title_new')}</h3>
          {/* X 버튼으로만 닫기 가능 */}
          <button className="btn btn-sm btn-secondary" onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit} style={{ overflowY: 'auto', maxHeight: '72vh', padding: '0 4px' }}>

          {/* ── 시리얼 정보 ── */}
          <div className="form-section-title" style={sectionTitleStyle}>{t(lang, 'section_serial_info')}</div>

          <div className="form-group">
            <label>{t(lang, 'label_serial_number')} <span style={{ color: '#ef4444' }}>*</span></label>
            <input
              name="serial_number"
              value={form.serial_number}
              onChange={handleChange}
              placeholder="EXO-2024-001"
              required
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>{t(lang, 'label_purchase_date')}</label>
              <input name="purchase_date" type="date" value={form.purchase_date} onChange={handleChange} />
            </div>
            <div className="form-group">
              <label>{t(lang, 'label_expiry_date')} {form.status !== 'not-activated' && <span style={{ color: '#ef4444' }}>*</span>}</label>
              <input name="expiry_date" type="date" value={form.expiry_date} onChange={handleChange} required={form.status !== 'not-activated'} />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>{t(lang, 'label_engine_build')}</label>
              <input name="engine_build" value={form.engine_build} onChange={handleChange} placeholder="4.0.1" />
            </div>
            <div className="form-group">
              <label>{t(lang, 'label_version')}</label>
              <input name="version" value={form.version} onChange={handleChange} placeholder="24.01" />
            </div>
          </div>

          <div className="form-group">
            <label>{t(lang, 'col_status')}</label>
            <select
              name="status"
              value={form.status}
              onChange={handleChange}
              style={{
                width: '100%',
                padding: '8px 12px',
                border: '1px solid #ddd',
                borderRadius: '6px',
                fontSize: '14px'
              }}
            >
              <option value="active">{t(lang, 'status_active')}</option>
              <option value="not-activated">{t(lang, 'status_not_activated')}</option>
              <option value="cancelled">{t(lang, 'status_cancelled')}</option>
              <option value="expired">{t(lang, 'status_expired')}</option>
            </select>
          </div>

          {/* ── 고객 정보 ── */}
          <div className="form-section-title" style={{ ...sectionTitleStyle, marginTop: 20 }}>{t(lang, 'section_customer_info')}</div>

          <div className="form-row">
            <div className="form-group">
              <label>{t(lang, 'label_customer_name')}</label>
              <input name="customer_name" value={form.customer_name} onChange={handleChange} placeholder="홍길동 치과" />
            </div>
            <div className="form-group">
              <label>{t(lang, 'label_manager')}</label>
              <input name="customer_manager" value={form.customer_manager} onChange={handleChange} placeholder="김담당" />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>{t(lang, 'label_email')}</label>
              <input name="customer_email" type="email" value={form.customer_email} onChange={handleChange} placeholder="hong@example.com" />
            </div>
            <div className="form-group">
              <label>{t(lang, 'label_phone')}</label>
              <input name="customer_phone" value={form.customer_phone} onChange={handleChange} placeholder="010-1234-5678" />
            </div>
          </div>

          <div className="form-group">
            <label>{t(lang, 'label_address')}</label>
            <input name="customer_address" value={form.customer_address} onChange={handleChange} placeholder="서울시 강남구 테헤란로 123" />
          </div>

          {/* ── Add-ons ── */}
          <div className="form-section-title" style={{ ...sectionTitleStyle, marginTop: 20 }}>{t(lang, 'section_addons')}</div>

          {/* 기존 add-ons 목록 */}
          {addOns.length > 0 && (
            <div style={{ marginBottom: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {addOns.map((a, i) => (
                <span
                  key={i}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    background: '#ede9fe', color: '#5b21b6',
                    borderRadius: 20, padding: '3px 10px', fontSize: 13,
                  }}
                >
                  {a.name}
                  <span style={{ fontSize: 11, color: '#7c3aed', opacity: 0.7 }}>({a.added_date})</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveAddon(i)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', fontWeight: 700, fontSize: 13, padding: 0, lineHeight: 1 }}
                  >×</button>
                </span>
              ))}
            </div>
          )}

          {/* 새 add-on 입력 */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="text"
              value={newAddonName}
              onChange={e => setNewAddonName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddAddon(); } }}
              placeholder={t(lang, 'label_addon_name')}
              style={{ flex: 1 }}
            />
            <button type="button" className="btn btn-secondary btn-sm" onClick={handleAddAddon}>
              {t(lang, 'btn_add_addon')}
            </button>
          </div>

          {/* ── 비고 ── */}
          <div className="form-group" style={{ marginTop: 16 }}>
            <label>{t(lang, 'label_notes')}</label>
            <textarea
              name="notes"
              value={form.notes}
              onChange={handleChange}
              rows={3}
              placeholder="메모를 입력하세요..."
              style={{ resize: 'vertical' }}
            />
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>{t(lang, 'cancel')}</button>
            <button type="submit" className="btn btn-primary">{serial ? t(lang, 'edit') : t(lang, 'btn_register')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: '#6366f1',
  borderBottom: '1px solid #e5e7eb',
  paddingBottom: 6,
  marginBottom: 12,
};
