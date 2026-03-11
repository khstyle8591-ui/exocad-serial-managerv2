import { getDb } from './database';
import type { AppSettings } from '../shared/types';

const DEFAULT_SETTINGS: AppSettings = {
  mail_protocol: 'pop3',                     // 기본 프로토콜: POP3
  pop3_host: '',
  pop3_port: 995,
  pop3_user: '',
  pop3_password: '',
  pop3_tls: true,
  imap_host: '',
  imap_port: 993,
  imap_user: '',
  imap_password: '',
  imap_tls: true,
  smtp_host: '',
  smtp_port: 587,
  smtp_user: '',
  smtp_password: '',
  smtp_tls: false,
  report_email_to: '',
  slack_webhook_url: '',
  slack_webhook_url_related: '',
  slack_language: 'ko' as const,
  exocad_site_url: 'https://partner.exocad.com/license-management',
  exocad_login_url: 'https://myaccount-us.aligntech.com/u/login?state=hKFo2SBvVS1pa3MyUFUtZkhvSWdVWngzZmZiY3VISUhPWW5TNKFur3VuaXZlcnNhbC1sb2dpbqN0aWTZIElkN25mZDdNTzBOdWRWaU9lVHZyVEdnLVBLSkR2Mjk5o2NpZNkgV3NZNmUyY0ZTWEFwMUdlSkhsRmJwcllhYUNySWVZWVQ',
  exocad_username: '',
  exocad_password: '',
  cancel_button_text: 'opt out upgrade',
  cancel_confirm_text: 'okay',
  cancel_option_button_text: '',             // 비어있으면 CSS 클래스 자동 감지 (기존 동작 유지)
  poll_sources: [],                          // URL 폴링 소스 목록
  renewal_product_keywords: ['exocad', 'exoplan'],
  renewal_action_keywords: ['renewal', 'renew', '갱신', '연장'],
  renewal_exclude_keywords: [],
  require_serial_format: true,
  renewal_keywords: ['renewal', 'renew', '갱신', '연장'],
  mail_check_times: ['12:00', '17:00'],
  auto_cancel_enabled: false,
  auto_cancel_days_before: 1,
  auto_cancel_time: '09:00',
  app_language: 'ko',
  dedicated_email: '',
  custom_product_code_rules: [],
};

export function getSettings(): AppSettings {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];

  const settings: any = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    if (row.key in settings) {
      const defaultVal = (DEFAULT_SETTINGS as any)[row.key];
      if (typeof defaultVal === 'number') {
        settings[row.key] = Number(row.value);
      } else if (typeof defaultVal === 'boolean') {
        settings[row.key] = row.value === 'true';
      } else if (Array.isArray(defaultVal)) {
        try {
          settings[row.key] = JSON.parse(row.value);
        } catch {
          settings[row.key] = defaultVal;
        }
      } else {
        settings[row.key] = row.value;
      }
    }
  }

  return settings as AppSettings;
}

export function saveSettings(settings: Partial<AppSettings>): void {
  const db = getDb();
  const upsert = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?'
  );

  const transaction = db.transaction(() => {
    for (const [key, value] of Object.entries(settings)) {
      const strValue = Array.isArray(value) ? JSON.stringify(value) : String(value);
      upsert.run(key, strValue, strValue);
    }
  });

  transaction();
}
