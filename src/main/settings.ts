import { getDb } from './database';
import type { AppSettings } from '../shared/types';

const DEFAULT_SETTINGS: AppSettings = {
  mail_protocol: 'pop3',                     // 기본 프로토콜: POP3
  pop3_host: '',
  pop3_port: 995,
  pop3_user: '',
  pop3_password: '',
  pop3_tls: true,
  pop3_keep_copy: false,                     // 기본값: 삭제 (기존 동작)
  imap_host: '',
  imap_port: 993,
  imap_user: '',
  imap_password: '',
  imap_tls: true,
  imap_mark_seen_after_check: false,
  smtp_host: '',
  smtp_port: 587,
  smtp_user: '',
  smtp_password: '',
  smtp_tls: false,
  smtp_from_name: 'Exocad Manager',
  report_email_to: '',
  smtp_test_address: '',
  slack_webhook_url: '',
  slack_webhook_url_related: '',
  slack_enabled: true,                       // 기본값: ON
  critical_alert_emails: [],
  slack_alert_enabled: true,
  alert_suppress_minutes: 360,
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
  renewal_action_keywords: ['stop renewal', 'cancel', 'cancellation', '갱신 중단', '갱신중단', '해지', '취소', '更新停止', '更新中止', '中止', '解約'],
  renewal_exclude_keywords: [],
  require_serial_format: true,
  mail_serial_pattern: 'XXXXXXXX-XXXX-XXXXXXXX',
  missing_info_auto_reply_enabled: false,
  missing_info_template: 'missing_info_request',
  renewal_keywords: ['stop renewal', 'cancel', 'cancellation', '갱신 중단', '갱신중단', '해지', '취소', '更新停止', '更新中止', '中止', '解約'],
  mail_check_times: ['12:00', '17:00'],
  auto_cancel_enabled: false,
  auto_cancel_days_before: 1,
  auto_cancel_time: '09:00',
  app_language: 'ko',
  dedicated_email: '',
  custom_product_code_rules: [],
  daily_report_times: ['10:00'],
  expiry_notice_enabled: true,
  expiry_notice_time: '05:00',
  expiry_notice_rules: [
    { id: 'd90', days_before: 90, renewal_template: 'renewal_reminder' },
    { id: 'd30', days_before: 30, renewal_template: 'renewal_reminder' },
    { id: 'd10', days_before: 10, renewal_template: 'renewal_reminder' },
  ],
  expiry_notice_days: [90, 30, 10],
  expiry_notice_renewal_template: 'renewal_reminder',
  expiry_notice_stop_template: 'stop_expiry_reminder',
  stop_request_notice_enabled: true,
  stop_request_notice_template: 'stop_request_received',
  cancel_complete_notice_enabled: true,
  cancel_complete_notice_template: 'cancel_confirmation',
};

let cachedSettings: AppSettings | null = null;

export function getSettings(forceRefresh = false): AppSettings {
  if (cachedSettings && !forceRefresh) return cachedSettings;

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

  const hasRuleRows = rows.some(row => row.key === 'expiry_notice_rules');
  if (!hasRuleRows && Array.isArray(settings.expiry_notice_days) && settings.expiry_notice_days.length > 0) {
    const template = settings.expiry_notice_renewal_template || 'renewal_reminder';
    settings.expiry_notice_rules = settings.expiry_notice_days
      .map((day: unknown) => Number(day))
      .filter((day: number) => Number.isInteger(day) && day >= 0 && day <= 365)
      .map((day: number) => ({ id: `d${day}`, days_before: day, renewal_template: template }));
  }

  cachedSettings = settings as AppSettings;
  return cachedSettings;
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
  cachedSettings = null; // 캐시 무효화
}
