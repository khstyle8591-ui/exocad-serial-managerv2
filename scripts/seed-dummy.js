/**
 * Dummy data seed script.
 * Usage: node scripts/seed-dummy.js [--clean]
 *   --clean  : delete all existing rows first (keeps settings & mail_templates)
 *
 * The script targets the active Electron userData DB.
 * Override with: DB_PATH=path/to/exocad.db node scripts/seed-dummy.js
 */

const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

// ── Resolve DB path ────────────────────────────────────────────────────────
const DB_PATH =
  process.env.DB_PATH ||
  path.join(os.homedir(), 'AppData', 'Roaming', 'Exocad Serial Manager', 'exocad.db');

console.log('[seed] Using DB:', DB_PATH);

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Optional clean ─────────────────────────────────────────────────────────
if (process.argv.includes('--clean')) {
  console.log('[seed] --clean: wiping existing data...');
  db.exec(`
    DELETE FROM activity_logs;
    DELETE FROM inbound_mails;
    DELETE FROM pending_orders;
    DELETE FROM serials;
    DELETE FROM customers;
  `);
  console.log('[seed] Cleared.');
}

// ── Helpers ────────────────────────────────────────────────────────────────
function daysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

// ── 1. Customers ───────────────────────────────────────────────────────────
const insertCustomer = db.prepare(`
  INSERT OR IGNORE INTO customers (name, email, phone, address, dealer, sales_manager, notes)
  VALUES (@name, @email, @phone, @address, @dealer, @sales_manager, @notes)
`);

const customers = [
  { name: '서울치과기공소', email: 'seoul.lab@example.com', phone: '02-1234-5678', address: '서울시 강남구 테헤란로 123', dealer: 'Dealer KR', sales_manager: '김민준', notes: '주요 고객' },
  { name: 'Osaka Dental Lab', email: 'osaka.dental@example.jp', phone: '+81-6-1234-5678', address: '大阪市中央区1-2-3', dealer: 'Dealer JP', sales_manager: '田中太郎', notes: '' },
  { name: '부산치과기술센터', email: 'busan.tech@example.com', phone: '051-987-6543', address: '부산시 해운대구 센텀로 45', dealer: 'Dealer KR', sales_manager: '이수진', notes: '연장 보류 중' },
  { name: 'Tokyo Prosth', email: 'tokyo.prosth@example.jp', phone: '+81-3-8765-4321', address: '東京都新宿区2-3-4', dealer: 'Dealer JP', sales_manager: '田中太郎', notes: '' },
  { name: '광주 스마일 기공소', email: 'gwangju.smile@example.com', phone: '062-345-6789', address: '광주시 서구 상무로 67', dealer: 'Dealer KR', sales_manager: '박지현', notes: '테스트 계정' },
  { name: 'Nagoya CAD Center', email: 'nagoya.cad@example.jp', phone: '+81-52-111-2222', address: '名古屋市中区3-4-5', dealer: 'Dealer JP', sales_manager: '山田花子', notes: '' },
  { name: '대구 프리미엄 기공소', email: 'daegu.premium@example.com', phone: '053-456-7890', address: '대구시 달서구 월성로 89', dealer: 'Dealer KR', sales_manager: '최현우', notes: '만료 예정' },
];

const insertMany = db.transaction((rows) => {
  for (const r of rows) insertCustomer.run(r);
});
insertMany(customers);

const allCustomers = db.prepare('SELECT id, name FROM customers').all();
console.log(`[seed] Customers: ${allCustomers.length}`);

function custId(name) {
  const c = allCustomers.find(x => x.name === name);
  if (!c) throw new Error('Customer not found: ' + name);
  return c.id;
}

// ── 2. Serials ─────────────────────────────────────────────────────────────
const insertSerial = db.prepare(`
  INSERT OR IGNORE INTO serials
    (serial_number, customer_id, purchase_date, expiry_date, status,
     engine_build, version, main_product, modules, notes, renewal_stop_requested, activated_at)
  VALUES
    (@serial_number, @customer_id, @purchase_date, @expiry_date, @status,
     @engine_build, @version, @main_product, @modules, @notes, @renewal_stop_requested, @activated_at)
`);

const serials = [
  // active — 여유 있음
  {
    serial_number: 'EXO-2024-001-ACTIVE',
    customer_id: custId('서울치과기공소'),
    purchase_date: '2024-01-15', expiry_date: daysFromNow(180),
    status: 'active', engine_build: 'Build 2024.01', version: '24.1',
    main_product: 'DentalCAD', modules: JSON.stringify(['chairside', 'exoplan']),
    notes: '', renewal_stop_requested: 0, activated_at: '2024-01-16',
  },
  // active — 30일 내 만료 예정
  {
    serial_number: 'EXO-2024-002-EXPIRING',
    customer_id: custId('부산치과기술센터'),
    purchase_date: '2023-04-01', expiry_date: daysFromNow(25),
    status: 'active', engine_build: 'Build 2023.04', version: '23.4',
    main_product: 'DentalCAD', modules: JSON.stringify([]),
    notes: '갱신 요청 미수신', renewal_stop_requested: 0, activated_at: '2023-04-02',
  },
  // active — 10일 내 만료 (긴급)
  {
    serial_number: 'EXO-2024-003-URGENT',
    customer_id: custId('광주 스마일 기공소'),
    purchase_date: '2023-03-10', expiry_date: daysFromNow(8),
    status: 'active', engine_build: 'Build 2023.03', version: '23.3',
    main_product: 'ExoPlan', modules: JSON.stringify(['exoplan']),
    notes: '긴급 갱신 필요', renewal_stop_requested: 0, activated_at: '2023-03-11',
  },
  // active — stop_requested
  {
    serial_number: 'EXO-2024-004-STOP',
    customer_id: custId('서울치과기공소'),
    purchase_date: '2023-06-01', expiry_date: daysFromNow(12),
    status: 'active', engine_build: 'Build 2023.06', version: '23.6',
    main_product: 'DentalCAD', modules: JSON.stringify(['chairside']),
    notes: '해지 요청 수신됨', renewal_stop_requested: 1, activated_at: '2023-06-02',
  },
  // active — 90일 내 만료 예고
  {
    serial_number: 'EXO-2024-005-NOTICE90',
    customer_id: custId('대구 프리미엄 기공소'),
    purchase_date: '2023-08-15', expiry_date: daysFromNow(88),
    status: 'active', engine_build: 'Build 2023.08', version: '23.8',
    main_product: 'DentalCAD', modules: JSON.stringify([]),
    notes: '', renewal_stop_requested: 0, activated_at: '2023-08-16',
  },
  // Osaka — active
  {
    serial_number: 'EXO-2024-006-JP',
    customer_id: custId('Osaka Dental Lab'),
    purchase_date: '2024-02-01', expiry_date: daysFromNow(200),
    status: 'active', engine_build: 'Build 2024.02', version: '24.2',
    main_product: 'DentalCAD', modules: JSON.stringify(['chairside', 'exoplan', 'implant']),
    notes: '', renewal_stop_requested: 0, activated_at: '2024-02-02',
  },
  // cancelled
  {
    serial_number: 'EXO-2023-007-CANCELLED',
    customer_id: custId('부산치과기술센터'),
    purchase_date: '2022-11-01', expiry_date: '2023-11-01',
    status: 'cancelled', engine_build: 'Build 2022.11', version: '22.11',
    main_product: 'ExoPlan', modules: JSON.stringify([]),
    notes: '계약 종료', renewal_stop_requested: 1, activated_at: '2022-11-02',
  },
  // expired
  {
    serial_number: 'EXO-2022-008-EXPIRED',
    customer_id: custId('광주 스마일 기공소'),
    purchase_date: '2022-03-01', expiry_date: daysFromNow(-5),
    status: 'expired', engine_build: 'Build 2022.03', version: '22.3',
    main_product: 'DentalCAD', modules: JSON.stringify([]),
    notes: '', renewal_stop_requested: 0, activated_at: '2022-03-02',
  },
  // not-activated
  {
    serial_number: 'EXO-2024-009-NEW',
    customer_id: custId('Tokyo Prosth'),
    purchase_date: daysFromNow(-3), expiry_date: daysFromNow(362),
    status: 'not-activated', engine_build: '', version: '',
    main_product: 'DentalCAD', modules: JSON.stringify([]),
    notes: '신규 등록, 미활성화', renewal_stop_requested: 0, activated_at: null,
  },
  // broken (limbo)
  {
    serial_number: 'EXO-2024-010-BROKEN',
    customer_id: custId('Nagoya CAD Center'),
    purchase_date: '2024-01-01', expiry_date: null,
    status: 'broken', engine_build: '', version: '',
    main_product: 'DentalCAD', modules: JSON.stringify([]),
    notes: 'activation 실패 — limbo 상태', renewal_stop_requested: 0, activated_at: null,
  },
  // 추가 active
  {
    serial_number: 'EXO-2024-011-ACTIVE',
    customer_id: custId('대구 프리미엄 기공소'),
    purchase_date: '2024-03-01', expiry_date: daysFromNow(300),
    status: 'active', engine_build: 'Build 2024.03', version: '24.3',
    main_product: 'ExoPlan', modules: JSON.stringify(['exoplan']),
    notes: '', renewal_stop_requested: 0, activated_at: '2024-03-02',
  },
  // Tokyo — not-activated
  {
    serial_number: 'EXO-2024-012-JP-NEW',
    customer_id: custId('Tokyo Prosth'),
    purchase_date: daysFromNow(-1), expiry_date: daysFromNow(364),
    status: 'not-activated', engine_build: '', version: '',
    main_product: 'ExoPlan', modules: JSON.stringify([]),
    notes: '', renewal_stop_requested: 0, activated_at: null,
  },
];

const insertSerials = db.transaction((rows) => {
  for (const r of rows) insertSerial.run(r);
});
insertSerials(serials);

const allSerials = db.prepare('SELECT id, serial_number FROM serials').all();
console.log(`[seed] Serials: ${allSerials.length}`);

function serialId(sn) {
  const s = allSerials.find(x => x.serial_number === sn);
  return s ? s.id : null;
}

// ── 3. Activity Logs ───────────────────────────────────────────────────────
const insertLog = db.prepare(`
  INSERT INTO activity_logs (serial_id, action, actor, diff, details, severity, created_at)
  VALUES (@serial_id, @action, @actor, @diff, @details, @severity, @created_at)
`);

const logsData = [
  { serial_id: serialId('EXO-2024-001-ACTIVE'), action: 'registered', actor: 'manual', diff: '{}', details: '시리얼 신규 등록 — DentalCAD', severity: 'info', created_at: '2024-01-15 09:00:00' },
  { serial_id: serialId('EXO-2024-001-ACTIVE'), action: 'activated', actor: 'auto', diff: '{}', details: 'Exocad 사이트 활성화 완료', severity: 'info', created_at: '2024-01-16 10:00:00' },
  { serial_id: serialId('EXO-2024-001-ACTIVE'), action: 'addon_added', actor: 'manual', diff: '{}', details: 'exoplan 모듈 추가', severity: 'info', created_at: '2024-02-01 11:00:00' },
  { serial_id: serialId('EXO-2024-002-EXPIRING'), action: 'registered', actor: 'manual', diff: '{}', details: '부산치과기술센터 신규 등록', severity: 'info', created_at: '2023-04-01 09:00:00' },
  { serial_id: serialId('EXO-2024-002-EXPIRING'), action: 'activated', actor: 'auto', diff: '{}', details: '활성화 완료', severity: 'info', created_at: '2023-04-02 10:30:00' },
  { serial_id: serialId('EXO-2024-003-URGENT'), action: 'registered', actor: 'polling', diff: '{}', details: '주문 폴링으로 자동 등록', severity: 'info', created_at: '2023-03-10 08:00:00' },
  { serial_id: serialId('EXO-2024-004-STOP'), action: 'stop_requested', actor: 'email', diff: '{}', details: '고객 이메일로 해지 요청 수신', severity: 'warn', created_at: '2024-03-15 14:00:00' },
  { serial_id: serialId('EXO-2023-007-CANCELLED'), action: 'cancelled', actor: 'auto', diff: '{}', details: '자동 Cancel 실행 — 갱신 요청 없음', severity: 'info', created_at: '2023-10-31 09:00:00' },
  { serial_id: serialId('EXO-2022-008-EXPIRED'), action: 'status_forced_expired', actor: 'system', diff: '{}', details: '만료일 경과 — 상태 변경', severity: 'warn', created_at: daysFromNow(-5) + ' 03:00:00' },
  { serial_id: serialId('EXO-2024-009-NEW'), action: 'registered', actor: 'polling', diff: '{}', details: 'Tokyo Prosth 신규 주문 승인', severity: 'info', created_at: daysFromNow(-3) + ' 09:30:00' },
  { serial_id: serialId('EXO-2024-010-BROKEN'), action: 'registered', actor: 'manual', diff: '{}', details: 'Nagoya — 수동 등록', severity: 'info', created_at: '2024-01-01 10:00:00' },
  { serial_id: serialId('EXO-2024-010-BROKEN'), action: 'system', actor: 'system', diff: '{}', details: 'Activation 실패: timeout. Limbo 상태로 표시', severity: 'error', created_at: '2024-01-01 10:05:00' },
  { serial_id: null, action: 'cron_ran', actor: 'system', diff: '{}', details: 'auto-cancel cron 실행 — 대상 없음', severity: 'info', created_at: daysFromNow(-1) + ' 09:00:00' },
  { serial_id: serialId('EXO-2024-006-JP'), action: 'renewed', actor: 'email', diff: '{}', details: '갱신 완료 — Build 2024.02', severity: 'info', created_at: '2024-02-15 11:00:00' },
  { serial_id: serialId('EXO-2024-001-ACTIVE'), action: 'mail_sent', actor: 'system', diff: '{}', details: '만료 예고 메일 발송 (90일 전)', severity: 'info', created_at: daysFromNow(-2) + ' 05:00:00' },
];

const insertLogs = db.transaction((rows) => {
  for (const r of rows) insertLog.run(r);
});
insertLogs(logsData);
console.log(`[seed] Activity logs: ${logsData.length}`);

// ── 4. Inbound Mails ───────────────────────────────────────────────────────
const insertMail = db.prepare(`
  INSERT INTO inbound_mails
    (message_id, mail_from, mail_to, subject, body, received_at,
     classification, matched_keywords, extracted_serial, linked_serial_id, processed)
  VALUES
    (@message_id, @mail_from, @mail_to, @subject, @body, @received_at,
     @classification, @matched_keywords, @extracted_serial, @linked_serial_id, @processed)
`);

const inboundMails = [
  {
    message_id: 'msg-001@example.com',
    mail_from: 'busan.tech@example.com',
    mail_to: 'renewal@yourcompany.com',
    subject: '[갱신요청] EXO-2024-002-EXPIRING 갱신 부탁드립니다',
    body: '안녕하세요. EXO-2024-002-EXPIRING 시리얼 갱신 요청드립니다. renewal',
    received_at: daysFromNow(-1) + ' 10:00:00',
    classification: 'stop_request',
    matched_keywords: JSON.stringify(['갱신', 'renewal']),
    extracted_serial: 'EXO-2024-002-EXPIRING',
    linked_serial_id: serialId('EXO-2024-002-EXPIRING'),
    processed: 1,
  },
  {
    message_id: 'msg-002@example.com',
    mail_from: 'seoul.lab@example.com',
    mail_to: 'renewal@yourcompany.com',
    subject: 'DentalCAD 구독 해지 요청 — EXO-2024-004-STOP',
    body: '구독을 더 이상 유지하지 않으려 합니다. EXO-2024-004-STOP. stop.',
    received_at: daysFromNow(-2) + ' 14:00:00',
    classification: 'stop_request',
    matched_keywords: JSON.stringify(['stop', '해지']),
    extracted_serial: 'EXO-2024-004-STOP',
    linked_serial_id: serialId('EXO-2024-004-STOP'),
    processed: 1,
  },
  {
    message_id: 'msg-003@example.com',
    mail_from: 'newsletter@dentalnews.com',
    mail_to: 'info@yourcompany.com',
    subject: '이번 달 치과 뉴스레터',
    body: '이번 달 치과 업계 소식입니다.',
    received_at: daysFromNow(-3) + ' 08:00:00',
    classification: 'unrelated',
    matched_keywords: JSON.stringify([]),
    extracted_serial: null,
    linked_serial_id: null,
    processed: 1,
  },
  {
    message_id: 'msg-004@example.jp',
    mail_from: 'osaka.dental@example.jp',
    mail_to: 'renewal@yourcompany.com',
    subject: 'EXO-2024-006-JP 更新リクエスト',
    body: 'お世話になっております。EXO-2024-006-JP の更新をお願いします。renewal',
    received_at: daysFromNow(0) + ' 09:00:00',
    classification: 'stop_request',
    matched_keywords: JSON.stringify(['renewal', '更新']),
    extracted_serial: 'EXO-2024-006-JP',
    linked_serial_id: serialId('EXO-2024-006-JP'),
    processed: 0,
  },
  {
    message_id: 'msg-005@example.com',
    mail_from: 'gwangju.smile@example.com',
    mail_to: 'renewal@yourcompany.com',
    subject: 'RE: 시리얼 만료 예고 — EXO-2024-003-URGENT',
    body: '안녕하세요. 갱신 원합니다. EXO-2024-003-URGENT',
    received_at: daysFromNow(0) + ' 11:30:00',
    classification: 'stop_request',
    matched_keywords: JSON.stringify(['갱신']),
    extracted_serial: 'EXO-2024-003-URGENT',
    linked_serial_id: serialId('EXO-2024-003-URGENT'),
    processed: 0,
  },
];

const insertMails = db.transaction((rows) => {
  for (const r of rows) insertMail.run(r);
});
insertMails(inboundMails);
console.log(`[seed] Inbound mails: ${inboundMails.length}`);

// ── 5. Pending Orders ──────────────────────────────────────────────────────
const insertOrder = db.prepare(`
  INSERT INTO pending_orders
    (source_id, source_url, trade_number, serial_number, customer_name, customer_email,
     customer_phone, customer_address, dealer, sales_manager, purchase_date, expiry_date,
     engine_build, version, main_product, modules, order_type, product_code, raw_data, status,
     flag_duplicate, notes)
  VALUES
    (@source_id, @source_url, @trade_number, @serial_number, @customer_name, @customer_email,
     @customer_phone, @customer_address, @dealer, @sales_manager, @purchase_date, @expiry_date,
     @engine_build, @version, @main_product, @modules, @order_type, @product_code, @raw_data, @status,
     @flag_duplicate, @notes)
`);

const orders = [
  {
    source_id: 'src-kr-main', source_url: 'https://order.example.com/list',
    trade_number: 'TRD-2024-0501', serial_number: 'EXO-2024-013-PENDING',
    customer_name: '인천 치과기공소', customer_email: 'incheon@example.com',
    customer_phone: '032-111-2222', customer_address: '인천시 남동구 구월로 10',
    dealer: 'Dealer KR', sales_manager: '김민준',
    purchase_date: daysFromNow(0), expiry_date: daysFromNow(365),
    engine_build: 'Build 2024.05', version: '24.5',
    main_product: 'DentalCAD', modules: JSON.stringify([]),
    order_type: 'new', product_code: 'DC-FULL',
    raw_data: '{}', status: 'pending', flag_duplicate: 0, notes: '',
  },
  {
    source_id: 'src-kr-main', source_url: 'https://order.example.com/list',
    trade_number: 'TRD-2024-0502', serial_number: 'EXO-2024-002-EXPIRING',
    customer_name: '부산치과기술센터', customer_email: 'busan.tech@example.com',
    customer_phone: '051-987-6543', customer_address: '부산시 해운대구 센텀로 45',
    dealer: 'Dealer KR', sales_manager: '이수진',
    purchase_date: daysFromNow(0), expiry_date: daysFromNow(365),
    engine_build: 'Build 2024.05', version: '24.5',
    main_product: 'DentalCAD', modules: JSON.stringify([]),
    order_type: 'renewal', product_code: 'DC-RENEW',
    raw_data: '{}', status: 'pending', flag_duplicate: 0, notes: '기존 시리얼 갱신',
  },
  {
    source_id: 'src-jp-main', source_url: 'https://order.example.jp/list',
    trade_number: 'TRD-JP-0201', serial_number: 'EXO-2024-014-JP-NEW',
    customer_name: 'Kyoto Dental', customer_email: 'kyoto@example.jp',
    customer_phone: '+81-75-333-4444', customer_address: '京都市中京区4-5-6',
    dealer: 'Dealer JP', sales_manager: '山田花子',
    purchase_date: daysFromNow(0), expiry_date: daysFromNow(365),
    engine_build: 'Build 2024.05', version: '24.5',
    main_product: 'ExoPlan', modules: JSON.stringify(['exoplan']),
    order_type: 'new', product_code: 'EP-FULL',
    raw_data: '{}', status: 'pending', flag_duplicate: 0, notes: '',
  },
  {
    source_id: 'src-kr-main', source_url: 'https://order.example.com/list',
    trade_number: 'TRD-2024-0490', serial_number: 'EXO-2024-001-ACTIVE',
    customer_name: '서울치과기공소', customer_email: 'seoul.lab@example.com',
    customer_phone: '02-1234-5678', customer_address: '서울시 강남구 테헤란로 123',
    dealer: 'Dealer KR', sales_manager: '김민준',
    purchase_date: '2024-01-15', expiry_date: daysFromNow(180),
    engine_build: 'Build 2024.01', version: '24.1',
    main_product: 'DentalCAD', modules: JSON.stringify([]),
    order_type: 'addon', product_code: 'DC-ADDON-CHAIR',
    raw_data: '{}', status: 'approved', flag_duplicate: 1, notes: '중복 주문 — 이미 승인됨',
  },
  {
    source_id: 'src-kr-main', source_url: 'https://order.example.com/list',
    trade_number: 'TRD-2024-0503', serial_number: 'EXO-2024-015-REJECT',
    customer_name: '테스트고객', customer_email: 'test@example.com',
    customer_phone: '010-0000-0000', customer_address: '서울시 종로구',
    dealer: 'Dealer KR', sales_manager: '박지현',
    purchase_date: daysFromNow(-1), expiry_date: daysFromNow(364),
    engine_build: 'Build 2024.05', version: '24.5',
    main_product: 'DentalCAD', modules: JSON.stringify([]),
    order_type: 'new', product_code: 'DC-FULL',
    raw_data: '{}', status: 'rejected', flag_duplicate: 0, notes: '정보 불일치로 거부',
  },
];

const insertOrders = db.transaction((rows) => {
  for (const r of rows) insertOrder.run(r);
});
insertOrders(orders);
console.log(`[seed] Pending orders: ${orders.length}`);

// ── Done ───────────────────────────────────────────────────────────────────
db.close();
console.log('\n[seed] Done. Restart the Electron app to see the data.\n');
console.log('Summary:');
console.log(`  Customers  : ${customers.length}`);
console.log(`  Serials    : ${serials.length} (active/cancelled/expired/not-activated/broken)`);
console.log(`  Logs       : ${logsData.length}`);
console.log(`  Inbound    : ${inboundMails.length}`);
console.log(`  Orders     : ${orders.length} (pending/approved/rejected)`);
