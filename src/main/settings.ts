import { getDb } from './database';
import fs from 'fs';
import path from 'path';
import type { AppSettings } from '../shared/types';

const MASKED_SECRET = '***';
const SECRET_ENV_KEYS = {
  pop3_password: 'POP3_PASSWORD',
  imap_password: 'IMAP_PASSWORD',
  smtp_password: 'SMTP_PASSWORD',
  exocad_password: 'EXOCAD_PASSWORD',
  slack_webhook_url: 'SLACK_WEBHOOK_URL',
  slack_webhook_url_related: 'SLACK_WEBHOOK_URL_RELATED',
} as const satisfies Record<keyof Pick<
  AppSettings,
  | 'pop3_password'
  | 'imap_password'
  | 'smtp_password'
  | 'exocad_password'
  | 'slack_webhook_url'
  | 'slack_webhook_url_related'
>, string>;

type SecretSettingKey = keyof typeof SECRET_ENV_KEYS;

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
  invalid_response_auto_reply_enabled: false,
  invalid_response_template: 'invalid_cancellation_response',
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
  // ── 고객 포털 (feature/credit-system) ─────────────────────────────────────
  portal_enabled: false,
  credit_auto_alloc_enabled: false,
  credit_notification_email: '',
  credit_packages: [],
  portal_request_descriptions: {
    credit: {
      ko: '크레딧 추가 구매를 신청합니다. 관리자 확인 후 처리됩니다.',
      en: 'Request additional credit purchase. Processed after administrator review.',
      ja: 'クレジットの追加購入を申請します。管理者の確認後に処理されます。',
    },
    renewal_stop: {
      ko: '갱신을 중단할 시리얼 번호를 입력하세요. 만료 당일/익일인 경우 즉시 처리됩니다.',
      en: 'Enter the serial number to stop renewal. Requests on or one day before the expiry date are applied immediately.',
      ja: '更新を停止するシリアル番号を入力してください。有効期限当日・前日の場合は即時処理されます。',
    },
    renewal_resume: {
      ko: '갱신 재개 또는 만료된 시리얼 재구독을 신청합니다.',
      en: 'Request renewal resumption or re-subscription of an expired serial.',
      ja: '更新の再開、または期限切れシリアルの再購読を申請します。',
    },
  },
};

let cachedSettings: AppSettings | null = null;

function isSecretSettingKey(key: string): key is SecretSettingKey {
  return key in SECRET_ENV_KEYS;
}

function persistSecretEnvValue(envName: string, value: string): void {
  process.env[envName] = value;

  const envPath = process.env.ENV_FILE_PATH || path.join(process.cwd(), '.env');
  let content = '';
  try {
    content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  } catch {
    return;
  }

  const line = `${envName}=${JSON.stringify(value)}`;
  const pattern = new RegExp(`^${envName}=.*$`, 'm');
  const next = pattern.test(content)
    ? content.replace(pattern, line)
    : `${content}${content && !content.endsWith('\n') ? '\n' : ''}${line}\n`;

  try {
    fs.writeFileSync(envPath, next, 'utf8');
  } catch {
    // Runtime process.env is already updated; persistence may be unavailable in packaged installs.
  }
}

function resolveSecretEnvName(key: SecretSettingKey, storedValue: string): string {
  return /^[A-Z][A-Z0-9_]*$/.test(storedValue) ? storedValue : SECRET_ENV_KEYS[key];
}

function toEnvToken(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function pollSourcePasswordEnvName(source: { id?: string; name?: string; login_pw?: string }): string {
  if (source.login_pw && /^[A-Z][A-Z0-9_]*$/.test(source.login_pw)) return source.login_pw;
  const token = toEnvToken(source.id || source.name || 'DEFAULT') || 'DEFAULT';
  return `POLL_SOURCE_${token}_PASSWORD`;
}

function readStoredPollSourcePasswordEnvNames(): Map<string, string> {
  const db = getDb();
  const row = db.prepare("SELECT value FROM settings WHERE key = 'poll_sources'").get() as { value: string } | undefined;
  if (!row) return new Map();

  try {
    const sources = JSON.parse(row.value) as Array<{ id?: string; login_pw?: string }>;
    return new Map(
      sources
        .filter(source => source.id && source.login_pw)
        .map(source => [String(source.id), pollSourcePasswordEnvName(source)])
    );
  } catch {
    return new Map();
  }
}

function resolveSecretsFromEnv(settings: AppSettings): AppSettings {
  const next: AppSettings = { ...settings, poll_sources: [...settings.poll_sources] };
  for (const key of Object.keys(SECRET_ENV_KEYS) as SecretSettingKey[]) {
    const envName = resolveSecretEnvName(key, String(next[key] || ''));
    next[key] = (process.env[envName] || '') as AppSettings[typeof key];
  }
  next.poll_sources = next.poll_sources.map(source => {
    if (!source.login_pw) return source;
    const envName = pollSourcePasswordEnvName(source);
    return { ...source, login_pw: process.env[envName] || '' };
  });
  return next;
}

function cleanupStoredSecretValues(rows: { key: string; value: string }[]): void {
  const db = getDb();
  const upsert = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?'
  );
  const transaction = db.transaction(() => {
    for (const row of rows) {
      if (!isSecretSettingKey(row.key)) continue;
      const envName = resolveSecretEnvName(row.key, row.value);
      if (row.value !== envName) {
        upsert.run(row.key, envName, envName);
      }
    }
    const pollSourcesRow = rows.find(row => row.key === 'poll_sources');
    if (pollSourcesRow) {
      try {
        const pollSources = JSON.parse(pollSourcesRow.value) as AppSettings['poll_sources'];
        const sanitized = pollSources.map(source => {
          if (!source.login_pw || /^[A-Z][A-Z0-9_]*$/.test(source.login_pw)) return source;
          return { ...source, login_pw: pollSourcePasswordEnvName(source) };
        });
        const sanitizedValue = JSON.stringify(sanitized);
        if (sanitizedValue !== pollSourcesRow.value) {
          upsert.run('poll_sources', sanitizedValue, sanitizedValue);
        }
      } catch {
        // Ignore malformed legacy JSON; normal settings parsing will fall back to defaults.
      }
    }
  });
  transaction();
}

export function redactSettingsForClient(settings: AppSettings = getSettings()): AppSettings {
  const redacted: AppSettings = { ...settings, poll_sources: [...settings.poll_sources] };
  for (const key of Object.keys(SECRET_ENV_KEYS) as SecretSettingKey[]) {
    redacted[key] = (settings[key] ? MASKED_SECRET : '') as AppSettings[typeof key];
  }
  redacted.poll_sources = redacted.poll_sources.map(source => ({
    ...source,
    login_pw: source.login_pw ? MASKED_SECRET : '',
  }));
  return redacted;
}

function coerceSettingValue<K extends keyof AppSettings>(key: K, rawValue: string): AppSettings[K] {
  const defaultVal = DEFAULT_SETTINGS[key];
  if (typeof defaultVal === 'number') {
    return Number(rawValue) as AppSettings[K];
  }
  if (typeof defaultVal === 'boolean') {
    return (rawValue === 'true') as AppSettings[K];
  }
  if (Array.isArray(defaultVal)) {
    try {
      return JSON.parse(rawValue) as AppSettings[K];
    } catch {
      return defaultVal;
    }
  }
  if (defaultVal !== null && typeof defaultVal === 'object') {
    try {
      return JSON.parse(rawValue) as AppSettings[K];
    } catch {
      return defaultVal;
    }
  }
  return rawValue as AppSettings[K];
}

export function getSettings(forceRefresh = false): AppSettings {
  if (cachedSettings && !forceRefresh) return cachedSettings;

  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  cleanupStoredSecretValues(rows);

  const settings = { ...DEFAULT_SETTINGS } as Record<keyof AppSettings, AppSettings[keyof AppSettings]>;
  for (const row of rows) {
    if (row.key in DEFAULT_SETTINGS) {
      const key = row.key as keyof AppSettings;
      settings[key] = coerceSettingValue(key, row.value);
    }
  }

  const loadedSettings = settings as AppSettings;
  const hasRuleRows = rows.some(row => row.key === 'expiry_notice_rules');
  if (!hasRuleRows && Array.isArray(loadedSettings.expiry_notice_days) && loadedSettings.expiry_notice_days.length > 0) {
    const template = loadedSettings.expiry_notice_renewal_template || 'renewal_reminder';
    loadedSettings.expiry_notice_rules = loadedSettings.expiry_notice_days
      .map((day: unknown) => Number(day))
      .filter((day: number) => Number.isInteger(day) && day >= 0 && day <= 365)
      .map((day: number) => ({ id: `d${day}`, days_before: day, renewal_template: template }));
  }

  cachedSettings = resolveSecretsFromEnv(loadedSettings);
  return cachedSettings;
}

export function saveSettings(settings: Partial<AppSettings>): void {
  const db = getDb();
  const upsert = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?'
  );

  const transaction = db.transaction(() => {
    for (const [key, value] of Object.entries(settings)) {
      if (isSecretSettingKey(key)) {
        if (value === MASKED_SECRET || value === '') continue;
        const envName = typeof value === 'string' && /^[A-Z][A-Z0-9_]*$/.test(value)
          ? value
          : SECRET_ENV_KEYS[key];
        if (typeof value === 'string' && value !== envName) {
          persistSecretEnvValue(envName, value);
        }
        upsert.run(key, envName, envName);
        continue;
      }
      if (key === 'poll_sources' && Array.isArray(value)) {
        const existingPasswordEnvNames = readStoredPollSourcePasswordEnvNames();
        const sanitizedSources = value.map(source => {
          if (!source || typeof source !== 'object') return source;
          const pollSource = source as AppSettings['poll_sources'][number];
          if (pollSource.login_pw === MASKED_SECRET || pollSource.login_pw === '') {
            const existingEnvName = existingPasswordEnvNames.get(pollSource.id);
            return existingEnvName ? { ...pollSource, login_pw: existingEnvName } : { ...pollSource, login_pw: '' };
          }
          return { ...pollSource, login_pw: pollSourcePasswordEnvName(pollSource) };
        });
        const strValue = JSON.stringify(sanitizedSources);
        upsert.run(key, strValue, strValue);
        continue;
      }
      const strValue = (value !== null && typeof value === 'object') ? JSON.stringify(value) : String(value);
      upsert.run(key, strValue, strValue);
    }
  });

  transaction();
  cachedSettings = null; // 캐시 무효화
}
