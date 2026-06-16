import React from 'react';
import { t, type Language } from '../../i18n';
import { SectionHeader } from './SettingsShared';
import type { SetSettingValue, SettingsFormRef } from './settingsTypes';

type ExocadSectionProps = {
  lang: Language;
  loadKey: number;
  formVals: SettingsFormRef;
  setVal: SetSettingValue;
  onManual: () => void;
};

export function ExocadSection({
  lang,
  loadKey,
  formVals,
  setVal,
  onManual,
}: ExocadSectionProps) {
  return (
    <div className="settings-section">
      <SectionHeader title={t(lang, 'section_exocad')} onManual={onManual} />
      <div className="form-group">
        <label>{t(lang, 'label_license_url')}</label>
        <input key={`esite-${loadKey}`} defaultValue={formVals.current.exocad_site_url || ''} onChange={e => setVal('exocad_site_url', e.target.value)} placeholder="https://partner.exocad.com/license-management" />
      </div>
      <div className="form-group">
        <label>{t(lang, 'label_login_url')}</label>
        <input key={`elogin-${loadKey}`} defaultValue={formVals.current.exocad_login_url || ''} onChange={e => setVal('exocad_login_url', e.target.value)} placeholder="https://myaccount-us.aligntech.com/u/login?..." />
      </div>
      <div className="form-row">
        <div className="form-group">
          <label>{t(lang, 'label_login_email')}</label>
          <input key={`euser-${loadKey}`} defaultValue={formVals.current.exocad_username || ''} onChange={e => setVal('exocad_username', e.target.value)} placeholder="email@example.com" />
        </div>
        <div className="form-group">
          <label>{t(lang, 'label_login_password')}</label>
          <input key={`epw-${loadKey}`} type="password" defaultValue={formVals.current.exocad_password || ''} onChange={e => setVal('exocad_password', e.target.value)} />
        </div>
      </div>
      <div className="form-row-3">
        <div className="form-group">
          <label>{t(lang, 'label_cancel_btn_text')}</label>
          <input key={`cbtn-${loadKey}`} defaultValue={formVals.current.cancel_button_text || ''} onChange={e => setVal('cancel_button_text', e.target.value)} placeholder="opt out upgrade" />
          <small style={{ color: 'var(--text3)', fontSize: 12 }}>{t(lang, 'cancel_btn_hint')}</small>
        </div>
        <div className="form-group">
          <label>{t(lang, 'label_cancel_confirm_text')}</label>
          <input key={`cconf-${loadKey}`} defaultValue={formVals.current.cancel_confirm_text || ''} onChange={e => setVal('cancel_confirm_text', e.target.value)} placeholder="okay" />
          <small style={{ color: 'var(--text3)', fontSize: 12 }}>{t(lang, 'cancel_confirm_hint')}</small>
        </div>
        <div className="form-group">
          <label>{t(lang, 'label_cancel_option_btn_text')}</label>
          <input key={`copt-${loadKey}`} defaultValue={formVals.current.cancel_option_button_text || ''} onChange={e => setVal('cancel_option_button_text', e.target.value)} placeholder="more options, actions, ..." />
          <small style={{ color: 'var(--text3)', fontSize: 12 }}>{t(lang, 'cancel_option_hint')}</small>
        </div>
      </div>
    </div>
  );
}
