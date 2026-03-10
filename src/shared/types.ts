// === Database Models ===

export interface Serial {
  id: number;
  serial_number: string;
  customer_name: string;
  customer_email: string;
  customer_address: string;
  customer_phone: string;
  customer_manager: string;
  purchase_date: string;
  expiry_date: string;
  status: 'active' | 'cancelled' | 'expired';
  engine_build: string;
  version: string;
  add_ons: string; // JSON string of AddOn[]
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface AddOn {
  name: string;
  added_date: string;
}

// Product code group classification
export type ProductCodeGroup = 'renewal' | 'addon' | 'main' | 'memo' | 'version_update' | 'ignore';

export interface ProductCodeRule {
  code: string;           // e.g. "006-001099"
  group: ProductCodeGroup;
  note?: string;          // optional user memo
}

export interface RenewalRequest {
  id: number;
  serial_id: number;
  request_date: string;
  request_source: 'email' | 'manual';
  processed: number; // 0 or 1 (SQLite boolean)
  created_at: string;
}

export interface ActivityLog {
  id: number;
  serial_id: number;
  action: 'registered' | 'renewed' | 'cancelled' | 'addon_added' | 'bulk_imported';
  details: string;
  created_at: string;
}

// 폴링으로 수집된 대기 주문
export interface PendingOrder {
  id: number;
  source_id: string;       // 원본 사이트의 주문 고유 ID (중복 방지용)
  source_url: string;      // 수집된 URL
  serial_number: string;
  customer_name: string;
  customer_email: string;
  customer_address: string;
  customer_phone: string;
  customer_manager: string;
  purchase_date: string;
  expiry_date: string;
  engine_build: string;
  version: string;
  notes: string;
  order_type: 'new' | 'renewal' | 'addon';
  raw_data: string;        // 원본 파싱 데이터 (JSON)
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  product_code: string;    // 상품코드 (商品コード) — 그룹 분류 기준
  flag_duplicate: number;  // 1 = DB에 동일 serial 이미 존재 (구 UI 빨간색 표시)
}

// === Service Types ===

export interface SerialInput {
  serial_number: string;
  customer_name: string;
  customer_email: string;
  customer_address?: string;
  customer_phone?: string;
  customer_manager?: string;
  purchase_date: string;
  expiry_date: string;
  engine_build?: string;
  version?: string;
  add_ons?: AddOn[];
  notes?: string;
}

export interface ExcelSerialRow {
  serial_number: string;
  customer_name: string;
  customer_email: string;
  customer_address?: string;
  customer_phone?: string;
  customer_manager?: string;
  purchase_date: string;
  expiry_date: string;
  engine_build?: string;
  version?: string;
  add_ons?: string;
  notes?: string;
}

// URL 폴링 소스 설정
export interface PollSource {
  id: string;          // uuid
  name: string;        // 사용자 정의 이름 (예: "카페24 주문관리")
  url: string;         // 폴링할 URL
  login_url: string;   // 로그인 페이지 URL (없으면 '')
  login_id: string;
  login_pw: string;
  enabled: boolean;
  // 필드 매핑: 사이트 HTML에서 어떤 셀렉터/키워드로 값을 추출할지
  field_serial: string;    // 시리얼 넘버 셀렉터 or 헤더 텍스트
  field_customer: string;  // 고객명
  field_phone: string;     // 전화번호
  field_purchase: string;  // 구매일
  field_expiry: string;    // 만료일
  field_product: string;   // 제품명(버전/엔진빌드 파싱용)
  product_filter: string;  // 키워드 필터: 비어있으면 전체 수집, 설정 시 product 열에 키워드 포함된 행만 수집 (대소문자 무시)
  last_polled: string;     // 마지막 폴링 시각
  schedule_times: string[]; // 스케줄링 시간 (예: ['10:00', '17:00'])
  register_directly?: boolean; // 수집 즉시 시리얼 목록에 등록 여부
}

export interface CancelResult {
  serial_number: string;
  success: boolean;
  error?: string;
  verified?: boolean;          // true = 웹 페이지에서 opted out/expired 상태 확인됨
  verified_status?: string;    // 감지된 상태 텍스트 (e.g. "opted out", "expired")
  screenshot_path?: string;    // cancel 완료 후 스크린샷 파일 경로
}

// Cancel dry-run result (Playwright check without actually confirming)
export interface CancelDryRunResult {
  serial_number: string;
  customer_name: string;
  expiry_date: string;
  has_renewal: boolean;       // true = would be SKIPPED (renewal request exists)
  is_test_serial?: boolean;   // true = no DB targets found; used fallback test serial
  product_name?: string;      // product name detected from the result row
  cancel_btn_label?: string;  // which button would be clicked ("Cancel subscription" | "Opt out upgrade")
  login_ok?: boolean;
  serial_found?: boolean;
  option_btn_found?: boolean;
  cancel_item_found?: boolean;
  cancel_item_clicked?: boolean; // true = cancel dropdown item was clicked (confirmation dialog NOT confirmed)
  error?: string;
}

// Poll dry-run types (crawl without saving to DB)
export interface PreviewRow {
  serial_number: string;
  customer_name: string;
  phone: string;
  purchase_date: string;
  expiry_date: string;
  product: string;
  already_exists: boolean;   // true if source_id already in pending_orders
  filtered_out: boolean;     // true if product_filter excluded this row
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

// Renewal dry-run: preview which emails would be detected (no DB write)
export interface RenewalDryRunEmail {
  from: string;
  subject: string;
  date: string;
  matched_keywords: string[];   // which keywords matched
  is_dedicated: boolean;        // detected via dedicated_email header
  serial_number: string | null; // extracted serial number
  serial_exists: boolean;       // whether serial exists in DB
}

export interface RenewalDryRunResult {
  total_checked: number;
  matched: number;
  emails: RenewalDryRunEmail[];
  error?: string;
}

// Mail connection test result
export interface MailConnectionResult {
  success: boolean;
  message: string;
  mail_count?: number;
}

export interface DailyReport {
  date: string;
  new_registrations: number;
  renewals: number;
  cancellations: number;
  failed_cancellations: CancelResult[];
  details: ActivityLog[];
}

export interface MonthlyExpiryReport {
  report_date: string;
  target_month: string;
  expiring_serials: Serial[];
  total_count: number;
}

// === Settings ===

export interface AppSettings {
  // Mail Protocol Selection
  mail_protocol: 'pop3' | 'imap';

  // POP3 Mail Settings
  pop3_host: string;
  pop3_port: number;
  pop3_user: string;
  pop3_password: string;
  pop3_tls: boolean;

  // IMAP Mail Settings
  imap_host: string;
  imap_port: number;
  imap_user: string;
  imap_password: string;
  imap_tls: boolean;

  // SMTP Mail Settings
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  smtp_password: string;
  smtp_tls: boolean;
  report_email_to: string;

  // Slack Settings
  slack_webhook_url: string;
  slack_language: 'ko' | 'en' | 'ja';  // Slack 메시지 언어 (UI 언어와 독립)

  // Exocad Site Settings (브라우저 자동화)
  exocad_site_url: string;
  exocad_login_url: string;
  exocad_username: string;
  exocad_password: string;
  cancel_button_text: string;
  cancel_confirm_text: string;
  cancel_option_button_text: string;  // 옵션 버튼 aria-label 또는 표시 텍스트; 비어있으면 CSS 클래스 자동 감지

  // URL 폴링 소스 목록 (JSON 직렬화)
  poll_sources: PollSource[];

  // Renewal email keywords
  renewal_keywords: string[];

  // Mail check times (HH:MM format)
  mail_check_times: string[];

  // Auto-cancel: days before expiry to auto-cancel if no renewal request
  auto_cancel_enabled: boolean;
  auto_cancel_days_before: number; // default: 1

  // Language
  app_language: 'ko' | 'en' | 'ja';

  // Auto-cancel execution time (HH:MM format, e.g. '09:00')
  auto_cancel_time: string;

  // Dedicated email address for this app (forward detection)
  // 이 주소가 To/Cc/X-Forwarded-To 등에 포함된 메일도 갱신 요청으로 감지
  dedicated_email: string;

  // 사용자 커스텀 product code 규칙 (내장 코드에 추가)
  custom_product_code_rules: ProductCodeRule[];
}

// === IPC Channel Names ===

export const IPC_CHANNELS = {
  // Serial CRUD
  SERIAL_GET_ALL: 'serial:getAll',
  SERIAL_GET_BY_ID: 'serial:getById',
  SERIAL_CREATE: 'serial:create',
  SERIAL_UPDATE: 'serial:update',
  SERIAL_DELETE: 'serial:delete',
  SERIAL_SEARCH: 'serial:search',
  SERIAL_ADD_ADDON: 'serial:addAddon',
  SERIAL_BULK_IMPORT: 'serial:bulkImport',

  // Cancel
  CANCEL_SUBSCRIPTION: 'cancel:subscription',
  CANCEL_CHECK_EXPIRING: 'cancel:checkExpiring',

  // Renewal
  RENEWAL_CHECK_EMAILS: 'renewal:checkEmails',
  RENEWAL_PROCESS: 'renewal:process',
  RENEWAL_DRY_RUN: 'renewal:dryRun',
  RENEWAL_TEST_CONNECTION: 'renewal:testConnection',

  REPORT_DAILY: 'report:daily',
  REPORT_MONTHLY_EXPIRY: 'report:monthlyExpiry',
  REPORT_SEND: 'report:send',
  SMTP_TEST_EMAIL: 'smtp:testEmail',

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_SAVE: 'settings:save',

  // Logs
  LOGS_GET: 'logs:get',
  LOGS_GET_TODAY: 'logs:getToday',

  // 주문 폴링 & 대기함
  ORDER_GET_PENDING: 'order:getPending',
  ORDER_APPROVE: 'order:approve',
  ORDER_REJECT: 'order:reject',
  ORDER_UPDATE: 'order:update',
  ORDER_DELETE: 'order:delete',
  ORDER_POLL_NOW: 'order:pollNow',
  ORDER_GET_POLL_STATUS: 'order:getPollStatus',
} as const;
