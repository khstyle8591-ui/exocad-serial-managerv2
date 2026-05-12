import React, { useState } from 'react';
import { api } from '../api';
import { useLang } from '../App';
import { t } from '../i18n';

interface Props {
  serial: any;
  onClose: () => void;
}

export default function AddOnManager({ serial, onClose }: Props) {
  const { lang } = useLang();
  const [addOns, setAddOns] = useState<{ name: string; added_date: string }[]>(
    JSON.parse(serial.add_ons || '[]')
  );
  const [newAddon, setNewAddon] = useState('');

  const handleAdd = async () => {
    if (!newAddon.trim()) return;
    const addon = {
      name: newAddon.trim(),
      added_date: new Date().toISOString().slice(0, 10),
    };
    await api.addAddon(serial.id, addon);
    setAddOns([...addOns, addon]);
    setNewAddon('');
  };

  const handleRemove = async (name: string) => {
    const updated = addOns.filter(a => a.name !== name);
    await api.updateSerial(serial.id, { add_ons: updated });
    setAddOns(updated);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ width: 400 }}>
        <div className="modal-header">
          <h3>{t(lang, 'addon_manage_title').replace('{sn}', serial.serial_number)}</h3>
          <button className="btn btn-sm btn-secondary" onClick={onClose}>X</button>
        </div>

        <div style={{ marginBottom: 16 }}>
          {addOns.length === 0 ? (
            <div style={{ color: '#888', padding: 10 }}>{t(lang, 'no_addons')}</div>
          ) : (
            <div className="addon-tags" style={{ gap: 8 }}>
              {addOns.map((addon, i) => (
                <span key={i} className="addon-tag" style={{ padding: '6px 12px', fontSize: 14 }}>
                  {addon.name}
                  <span style={{ fontSize: 11, color: '#888', marginLeft: 4 }}>({addon.added_date})</span>
                  <span className="remove" onClick={() => handleRemove(addon.name)}>x</span>
                </span>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            placeholder={t(lang, 'addon_name_placeholder')}
            value={newAddon}
            onChange={e => setNewAddon(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
            style={{ flex: 1, padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6 }}
          />
          <button className="btn btn-primary" onClick={handleAdd}>{t(lang, 'add')}</button>
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>{t(lang, 'close')}</button>
        </div>
      </div>
    </div>
  );
}
