// =========================================================
// Database Models
// =========================================================

/** Customer — 회사(업체) 단위. 동명이인 없음. */
export interface Customer {
  id: number;
  name: string;
  email: string;
  phone: string;
  address: string;
  dealer: string;
  sales_manager: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface CustomerInput {
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  dealer?: string;
  sales_manager?: string;
  notes?: string;
}

export interface MergeCandidate {
  customer: Customer;
  score: number;
  matched_field: 'email' | 'name_phone' | 'name_dealer' | 'name_partial';
}

export interface CustomerSerialSummary {
  customer_id: number;
  total: number;
  active: number;
  cancelled: number;
  expired: number;
  not_activated: number;
  broken: number;
}

/** Serial — 신규 스키마. customer_id FK. */
export interface Serial {
  id: number;
  serial_number: string;
  customer_id: number;
  purchase_date: string | null;
  expiry_date: string | null;
  status: 'active' | 'cancelled' | 'expired' | 'not-activated' | 'broken';
  engine_build: string;
  version: string;
  main_product: string;
  modules: string;          // JSON string[]
  notes: string;
  renewal_stop_requested: number;   // 0 | 1 (SQLite BOOLEAN)
  stop_requested_at: string | null;
  activated_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Serial with joined Customer data (returned by getAll/getById/search). */
export interface SerialWithCustomer extends Serial {
  customer: Customer;
}

export interface ActivityLog {
  id: number;
  serial_id: number | null;
  action:
    | 'registered' | 'renewed' | 'cancelled' | 'addon_added'
    | 'activated' | 'stop_requested' | 'stop_cleared'
    | 'status_forced_expired' | 'bulk_imported' | 'customer_merged'
    | 'legacy_imported' | 'mail_sent' | 'mail_failed' | 'cron_ran' | 'system';
  actor: 'manual' | 'auto' | 'email' | 'polling' | 'system';
  diff: string;             // JSON {field:[old,new]}
  details: string;
  trigger_id: string | null;
  severity: 'info' | 'warn' | 'error' | 'critical';
  created_at: string;
}

export interface SerialMailNoticeLog {
  id: number;
  serial_id: number | null;
  serial_number: string;
  template_code: string;
  notice_kind: 'expiry_renewal' | 'expiry_stop';
  days_before: number;
  recipient_email: string;
  status: 'sent' | 'failed';
  message: string;
  sent_at: string;
  expires_at: string;
  created_at: string;
}

export interface AutoRenewalOrderNoticeLog {
  id: number;
  serial_id: number | null;
  serial_number: string;
  customer_name: string;
  customer_email: string;
  main_product: string;
  modules: string;
  previous_expiry_date: string;
  renewed_expiry_date: string;
  recipient_email: string;
  subject: string;
  html_body: string;
  status: 'sent' | 'failed';
  message: string;
  sent_at: string;
  created_at: string;
}

// ── Mail ──────────────────────────────────────────────────────────────────────

export interface MailTemplate {
  id: number;
  code: string;
  name: string;
  subject: string;
  body: string;
  is_builtin: number;
  enabled: number;
  updated_at: string;
}

export interface MailTemplateUpsert {
  id?: number;
  code: string;
  name: string;
  subject: string;
  body: string;
  enabled: boolean;
}

export interface InboundMail {
  id: number;
  message_id: string | null;
  mail_from: string;
  mail_to: string;
  subject: string;
  body: string;
  received_at: string;
  classification: 'unclassified' | 'renewal_request' | 'stop_request_candidate' | 'stop_request' | 'missing_info' | 'invalid_cancellation_response' | 'unrelated' | 'error';
  matched_template: string | null;
  matched_keywords: string;     // JSON string[]
  extracted_serial: string | null;
  linked_serial_id: number | null;
  processed: number;
  missing_fields: string | null; // JSON string[]
  template_sent_at: string | null;
  response_errors: string;
  response_attempt: number;
  response_customer_name: string | null;
  admin_review: number;
  admin_review_resolved: number;
  error: string | null;
}

// ── Pending Orders ────────────────────────────────────────────────────────────

export interface PendingOrder {
  id: number;
  source_id: string;
  source_url: string;
  trade_number: string;
  serial_number: string;
  customer_name: string;
  customer_email: string;
  customer_address: string;
  customer_phone: string;
  dealer: string;
  sales_manager: string;
  purchase_date: string;
  expiry_date: string;
  engine_build: string;
  version: string;
  main_product: string;
  modules: string;              // JSON string[]
  order_type: 'new' | 'renewal' | 'addon';
  raw_data: string;
  status: 'pending' | 'approved' | 'rejected';
  flag_duplicate: number;
  notes: string;
  product_code: string;
  created_at: string;

  // JOIN helpers (UI)
  existing_status?: string;
  existing_expiry?: string;
  existing_customer_name?: string;
  serial_status?: Serial['status'];
}

export interface GroupedOrder {
  trade_number: string;
  main: PendingOrder | null;
  modules: PendingOrder[];
  flagged_duplicate: boolean;
  created_at: string;
}

// ── Service Input Types ───────────────────────────────────────────────────────

export interface SerialInput {
  serial_number: string;
  customer_id?: number;
  customer_resolution?: 'merge' | 'separate';
  customer_merge_target_id?: number;
  customer_name?: string;
  customer_email?: string;
  customer_address?: string;
  customer_phone?: string;
  customer_manager?: string;
  dealer?: string;
  purchase_date?: string;
  expiry_date?: string | null;
  engine_build?: string;
  version?: string;
  main_product?: string;
  modules?: string[];
  add_ons?: AddOn[];
  notes?: string;
  status?: Serial['status'];
  renewal_stop_requested?: boolean | number;
}

export interface SerialListQuery {
  limit?: number;
  offset?: number;
  search?: string;
  status?: Serial['status'] | 'all';
  customer_id?: number;
  renewal_stop_requested?: boolean;
  expiring_this_month?: boolean;
}

export interface SerialExportQuery {
  search?: string;
  status?: Serial['status'] | 'all';
  customer_id?: number;
  renewal_stop_requested?: boolean;
  expiring_this_month?: boolean;
}

export interface SerialListResult {
  items: SerialWithCustomer[];
  total: number;
  limit: number;
  offset: number;
}

export interface SerialVersionSummary {
  version: string;
  total: number;
  active: number;
  cancelled: number;
  expired: number;
  not_activated: number;
  broken: number;
}

/** Legacy AddOn — kept for backward compatibility */
export interface AddOn {
  name: string;
  added_date: string;
}

export interface LogFilter {
  date_from?: string;
  date_to?: string;
  actions?: ActivityLog['action'][];
  actors?: ActivityLog['actor'][];
  severities?: ActivityLog['severity'][];
  serial_id?: number;
  limit?: number;
  offset?: number;
}

export interface StatsSeries {
  granularity: 'day' | 'month' | 'year';
  buckets: Array<{
    label: string;
    registered: number;
    renewed: number;
    cancelled: number;
    addon_added: number;
  }>;
}

export interface StatsCountsResult {
  total: number;
  active: number;
  cancelled: number;
  expired: number;
  not_activated: number;
  broken: number;
  expiringThisMonth: number;
}

export interface OrderApproveInput {
  id: number;
  customer: { kind: 'existing'; customer_id: number } | { kind: 'new'; data: CustomerInput };
  target_status?: 'not-activated' | 'active';
  overrides?: Partial<SerialInput>;
}

export interface LegacyImportInput {
  legacy_id: number;
  target_customer:
    | { kind: 'existing'; customer_id: number }
    | { kind: 'new'; data: CustomerInput };
  set_stop_requested?: boolean;
  status_override?: Serial['status'];
  field_overrides?: Partial<SerialInput>;
}

export interface LegacyImportResult {
  success: boolean;
  serial_id?: number;
  error?: string;
}

export interface ExcelSerialRow {
  serial_number: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  customer_address: string;
  purchase_date: string;
  expiry_date: string;
  status: string;
  engine_build: string;
  version: string;
  main_product: string;
  modules: string;
  dealer: string;
  customer_manager: string;
  renewal_stop_requested: string;
  notes: string;
  [key: string]: string;
}

// ── Product Code Groups ───────────────────────────────────────────────────────

export type ProductCodeGroup = 'renewal' | 'addon' | 'main' | 'memo' | 'version_update' | 'ignore';

export interface ProductCodeRule {
  code: string;
  group: ProductCodeGroup;
  note?: string;
}

export interface ExpiryNoticeRule {
  id: string;
  days_before: number;
  renewal_template: string;
}

// ── Poll Types ────────────────────────────────────────────────────────────────

export interface PollSource {
  id: string;
  name: string;
  url: string;
  login_url: string;
  login_id: string;
  login_pw: string;
  enabled: boolean;
  field_serial: string;
  field_customer: string;
  field_phone: string;
  field_purchase: string;
  field_expiry: string;
  field_product: string;
  product_filter: string;
  last_polled: string;
  schedule_times: string[];
  interval_min?: number;
  register_directly?: boolean;
}

export interface PreviewRow {
  serial_number: string;
  customer_name: string;
  phone: string;
  purchase_date: string;
  expiry_date: string;
  product: string;
  already_exists: boolean;
  filtered_out: boolean;
}

export interface PollDryRunSourceResult {
  source_name: string;
  source_id: string;
  rows: PreviewRow[];
  already_fetched: number;
  would_insert: number;
  error?: string;
}

export interface PollDryRunResult {
  sources: PollDryRunSourceResult[];
}

// ── Cancel ───────────────────────────────────────────────────────────────────

export interface CancelResult {
  serial_number: string;
  success: boolean;
  error?: string;
  verified?: boolean;
  verified_status?: string;
  screenshot_path?: string;
}

export interface CancelDryRunResult {
  serial_number: string;
  customer_name: string;
  expiry_date: string | null;
  stop_requested: boolean;
  cancel_skipped: boolean;
  /** @deprecated Use cancel_skipped. Older UI used this as "skip because no stop request". */
  has_renewal: boolean;
  is_test_serial?: boolean;
  product_name?: string;
  cancel_btn_label?: string;
  login_ok?: boolean;
  serial_found?: boolean;
  option_btn_found?: boolean;
  cancel_item_found?: boolean;
  cancel_item_clicked?: boolean;
  error?: string;
}

// ── Mail connection ───────────────────────────────────────────────────────────

export interface MailConnectionResult {
  success: boolean;
  message: string;
  mail_count?: number;
}

export interface RenewalDryRunEmail {
  from: string;
  subject: string;
  date: string;
  matched_keywords: string[];
  is_dedicated: boolean;
  serial_number: string | null;
  serial_exists: boolean;
  is_renewal: boolean;
  is_related: boolean;
}

export interface RenewalDryRunResult {
  total_checked: number;
  matched: number;
  emails: RenewalDryRunEmail[];
  error?: string;
}

// ── Reports ───────────────────────────────────────────────────────────────────

export interface DailyReport {
  date: string;
  new_registrations: number;
  renewals: number;
  auto_renewals: number;
  manual_renewals: number;
  cancellations: number;
  failed_cancellations: CancelResult[];
  details: ActivityLog[];
}

export interface MonthlyExpiryReport {
  report_date: string;
  target_month: string;
  expiring_serials: SerialWithCustomer[];
  total_count: number;
}

// ── Settings ─────────────────────────────────────────────────────────────────

export interface CreditPackage {
  id: string;
  label: string;
  quantity: number;
  price: number;
}

export interface LocalizedText {
  ko: string;
  en: string;
  ja: string;
}

export interface PortalRequestDescriptions {
  credit: LocalizedText;
  renewal_stop: LocalizedText;
  renewal_resume: LocalizedText;
}

export interface AppSettings {
  mail_protocol: 'pop3' | 'imap';
  pop3_host: string;
  pop3_port: number;
  pop3_user: string;
  pop3_password: string;
  pop3_tls: boolean;
  pop3_keep_copy: boolean;
  imap_host: string;
  imap_port: number;
  imap_user: string;
  imap_password: string;
  imap_tls: boolean;
  imap_mark_seen_after_check: boolean;
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  smtp_password: string;
  smtp_tls: boolean;
  smtp_from_name: string;
  report_email_to: string;
  smtp_test_address: string;
  slack_webhook_url: string;
  slack_webhook_url_related: string;
  slack_enabled: boolean;
  critical_alert_emails: string[];
  slack_alert_enabled: boolean;
  alert_suppress_minutes: number;
  slack_language: 'ko' | 'en' | 'ja';
  exocad_site_url: string;
  exocad_login_url: string;
  exocad_username: string;
  exocad_password: string;
  cancel_button_text: string;
  cancel_confirm_text: string;
  cancel_option_button_text: string;
  poll_sources: PollSource[];
  renewal_product_keywords: string[];
  renewal_action_keywords: string[];
  renewal_exclude_keywords: string[];
  require_serial_format: boolean;
  mail_serial_pattern: string;
  missing_info_auto_reply_enabled: boolean;
  missing_info_template: string;
  invalid_response_auto_reply_enabled: boolean;
  invalid_response_template: string;
  renewal_keywords: string[];
  mail_check_times: string[];
  auto_cancel_enabled: boolean;
  auto_cancel_days_before: number;
  app_language: 'ko' | 'en' | 'ja';
  auto_cancel_time: string;
  dedicated_email: string;
  custom_product_code_rules: ProductCodeRule[];
  daily_report_times: string[];
  expiry_notice_enabled: boolean;
  expiry_notice_time: string;
  expiry_notice_rules: ExpiryNoticeRule[];
  expiry_notice_days: number[];
  expiry_notice_renewal_template: string;
  expiry_notice_stop_template: string;
  stop_request_notice_enabled: boolean;
  stop_request_notice_template: string;
  cancel_complete_notice_enabled: boolean;
  cancel_complete_notice_template: string;
  // ── 고객 포털 (feature/credit-system) ─────────────────────────────────────
  portal_enabled: boolean;
  credit_auto_alloc_enabled: boolean;
  credit_notification_email: string;
  credit_packages: CreditPackage[];
  portal_request_descriptions: PortalRequestDescriptions;
  // 데이터 미매치 시 안내 팝업 문구 (PM 연락 안내 포함)
  portal_mismatch_message: LocalizedText;
  // 갱신재개 신청 시 견적서 안내 2단계 팝업 문구
  portal_resume_quote_prompt: LocalizedText;
  // 견적서 신청 완료 안내 문구
  portal_resume_quote_sent: LocalizedText;
}

// =========================================================
// IPC Channel Names
// =========================================================

export const IPC_CHANNELS = {
  // @deprecated Use SERIAL_LIST or domain-specific serial channels.
  SERIAL_GET_ALL: 'serial:getAll',
  SERIAL_LIST: 'serial:list',
  SERIAL_GET_EXPIRING_SOON: 'serial:getExpiringSoon',
  SERIAL_GET_VERSION_SUMMARY: 'serial:getVersionSummary',
  SERIAL_GET_BY_ID: 'serial:getById',
  SERIAL_CREATE: 'serial:create',
  SERIAL_UPDATE: 'serial:update',
  SERIAL_DELETE: 'serial:delete',
  SERIAL_SEARCH: 'serial:search',
  SERIAL_ADD_ADDON: 'serial:addAddon',
  SERIAL_BULK_IMPORT: 'serial:bulkImport',
  SERIAL_ACTIVATE: 'serial:activate',
  SERIAL_SET_STOP_REQUESTED: 'serial:setStopRequested',
  SERIAL_RENEW: 'serial:renew',
  SERIAL_CANCEL_DB: 'serial:cancelDb',
  SERIAL_REMOVE_MODULE: 'serial:removeModule',

  CUSTOMER_LIST: 'customer:list',
  CUSTOMER_SERIAL_SUMMARIES: 'customer:serialSummaries',
  CUSTOMER_GET_BY_ID: 'customer:getById',
  CUSTOMER_CREATE: 'customer:create',
  CUSTOMER_UPDATE: 'customer:update',
  CUSTOMER_DELETE: 'customer:delete',
  CUSTOMER_SEARCH: 'customer:search',
  CUSTOMER_MERGE_CANDIDATES: 'customer:mergeCandidates',

  EXCEL_DOWNLOAD_TEMPLATE: 'excel:downloadTemplate',
  EXCEL_EXPORT_SERIALS: 'excel:exportSerials',
  EXCEL_EXPORT_SERIALS_BY_FILTER: 'excel:exportSerialsByFilter',

  CANCEL_SUBSCRIPTION: 'cancel:subscription',
  CANCEL_CHECK_EXPIRING: 'cancel:checkExpiring',
  CANCEL_PRE_EXPIRY_AUTO: 'cancel:preExpiryAutoCancel',
  CANCEL_DRY_RUN: 'cancel:dryRun',
  CANCEL_RESTART_SCHEDULER: 'cancel:restartScheduler',

  AUTOMATION_RUN_AUTO_RENEW: 'automation:runAutoRenewNow',
  AUTOMATION_RUN_AUTO_CANCEL: 'automation:runAutoCancelNow',
  AUTOMATION_RUN_LIMBO: 'automation:runLimboFallbackNow',

  MAIL_CHECK_INBOUND: 'mail:checkInboundNow',
  MAIL_INBOUND_DRY_RUN: 'mail:inboundDryRun',
  MAIL_TEST_CONNECTION: 'mail:testConnection',
  MAIL_LIST_INBOUND: 'mail:listInbound',
  MAIL_CONFIRM_STOP_REQUEST: 'mail:confirmStopRequest',
  MAIL_SEND_MISSING_INFO_TEMPLATE: 'mail:sendMissingInfoTemplate',

  MAIL_SEND_TEMPLATE: 'mail:sendTemplate',
  MAIL_TEST_SMTP: 'mail:testSmtp',
  MAIL_SEND_TEST_DRY_RUN: 'mail:sendTestDryRun',
  MAIL_TEMPLATE_LIST: 'mailTemplate:list',
  MAIL_TEMPLATE_GET: 'mailTemplate:get',
  MAIL_TEMPLATE_UPSERT: 'mailTemplate:upsert',
  MAIL_TEMPLATE_DELETE: 'mailTemplate:delete',
  MAIL_TEMPLATE_PREVIEW: 'mailTemplate:preview',

  STATS_COUNTS: 'stats:counts',
  STATS_SERIES: 'stats:series',
  STATS_FAILURES: 'stats:failures',

  SETTINGS_GET: 'settings:get',
  SETTINGS_SAVE: 'settings:save',
  SETTINGS_EXPORT: 'settings:export',
  SETTINGS_IMPORT: 'settings:import',

  LOGS_LIST: 'logs:list',
  // Main-to-renderer event, not an ipcMain.handle request channel.
  LOGS_PUSH: 'logs:push',

  ORDER_GET_PENDING: 'order:getPending',
  ORDER_LIST_GROUPED: 'order:listGrouped',
  ORDER_APPROVE: 'order:approve',
  ORDER_REJECT: 'order:reject',
  ORDER_UPDATE: 'order:update',
  ORDER_UPDATE_DATA: 'order:updateData',
  ORDER_DELETE: 'order:delete',
  ORDER_POLL_NOW: 'order:pollNow',
  ORDER_GET_POLL_STATUS: 'order:getPollStatus',
  ORDER_POLL_DRY_RUN: 'order:pollDryRun',
  ORDER_RESTART_SCHEDULER: 'order:restartScheduler',

  NOTIFICATION_TEST_SLACK: 'notification:testSlack',
  NOTIFICATION_SEND_DAILY_NOW: 'notification:sendDailyReportNow',
  NOTIFICATION_LIST_REPORT_TIMES: 'notification:listReportTimes',
  NOTIFICATION_SET_REPORT_TIMES: 'notification:setReportTimes',
  EXPIRY_NOTICE_DRY_RUN: 'expiryNotice:dryRun',
  STOP_LIFECYCLE_NOTICE_DRY_RUN: 'stopLifecycleNotice:dryRun',

  LEGACY_DETECT: 'legacy:detect',
  LEGACY_LIST_SERIALS: 'legacy:listSerials',
  LEGACY_SUGGEST_MERGE: 'legacy:suggestMerge',
  LEGACY_IMPORT: 'legacy:import',

  WEBHOOK_GET_STATUS: 'webhook:getStatus',
  WEBHOOK_START: 'webhook:start',
  WEBHOOK_STOP: 'webhook:stop',
} as const;
