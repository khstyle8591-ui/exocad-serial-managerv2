import React from 'react';
import { t, type Language } from '../../i18n';
import { SectionHeader } from './SettingsShared';

type LanguageSectionProps = {
  lang: Language;
  appLanguage: Language;
  setAppLanguage: React.Dispatch<React.SetStateAction<Language>>;
  onManual: () => void;
};

export function LanguageSection({
  lang,
  appLanguage,
  setAppLanguage,
  onManual,
}: LanguageSectionProps) {
  return (
    <div className="settings-section">
      <SectionHeader title={t(lang, 'section_language')} onManual={onManual} />
      <div className="form-group">
        <label>{t(lang, 'label_language')}</label>
        <div style={{ display: 'flex', gap: 12, marginTop: 6 }}>
          {([
            { value: 'ko', label: '🇰🇷 한국어' },
            { value: 'en', label: '🇺🇸 English' },
            { value: 'ja', label: '🇯🇵 日本語' },
          ] as { value: Language; label: string }[]).map(opt => (
            <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', padding: '6px 14px', borderRadius: 8, border: `2px solid ${appLanguage === opt.value ? 'var(--accent)' : 'var(--border2)'}`, background: appLanguage === opt.value ? 'var(--accent-dim2)' : 'var(--bg3)', fontWeight: appLanguage === opt.value ? 700 : 400, color: appLanguage === opt.value ? 'var(--accent)' : 'var(--text2)', fontSize: 13 }}>
              <input
                type="radio"
                name="app_language"
                value={opt.value}
                checked={appLanguage === opt.value}
                onChange={() => setAppLanguage(opt.value)}
                style={{ display: 'none' }}
              />
              {opt.label}
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
