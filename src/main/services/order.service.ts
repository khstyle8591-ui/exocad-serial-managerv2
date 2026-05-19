import { chromium, Browser, BrowserContext, Page } from 'playwright';
import cron from 'node-cron';
import { getDb } from '../database';
import { getSettings, saveSettings } from '../settings';
import { serialService } from './serial.service';
import { logger } from '../utils/logger';
import { getDateString, getNowTimestampString, getTodayDateString } from '../utils/date-utils';
import type { PendingOrder, PollSource, SerialInput, PollDryRunResult, PollDryRunSourceResult, PreviewRow, ProductCodeGroup, ProductCodeRule, GroupedOrder } from '../../shared/types';
import { customerService } from './customer.service';

// ────────────────────────────────────────────────────────────
// 폴링 상태
// ────────────────────────────────────────────────────────────
interface PollStatus {
  running: boolean;
  lastRun: string;
  message: string;
}

const pollStatus: PollStatus = {
  running: false,
  lastRun: '',
  message: '아직 폴링하지 않았습니다.',
};

let cronTasks: Map<string, cron.ScheduledTask[]> = new Map();

// ────────────────────────────────────────────────────────────
// Product Code 그룹 상수
// ────────────────────────────────────────────────────────────
const BUILT_IN_CODES: Record<ProductCodeGroup, string[]> = {
  renewal: [
    '006-001017', '006-001035',
    '006-005200', '006-005201', '006-005212', '006-005213', '006-005214', '006-005215',
  ],
  addon: [
    '006-001002', '006-001003', '006-001004', '006-001005', '006-001006', '006-001007',
    '006-001008', '006-001009', '006-001010', '006-001011', '006-001012', '006-001013',
    '006-001014', '006-001015', '006-001016', '006-001037', '006-001039',
    '006-005100', '006-005101', '006-005102', '006-005103', '006-005104', '006-005105',
    '006-005106', '006-005107', '006-005108', '006-005109', '006-005110',
  ],
  main: [
    '006-001001', '006-001034', '006-001020',
    '006-005082', '006-005083', '006-005098', '006-005099',
  ],
  memo: [
    '006-001031', '006-001033', '006-001036', '006-001040', '006-001041',
    '006-005080', '006-005081', '006-006100', '006-006104',
  ],
  version_update: ['006-001032'],
  ignore: [
    '006-001018', '006-001019', '006-001021', '006-001022', '006-001023', '006-001024',
    '006-001025', '006-001026', '006-001027', '006-001028', '006-001029', '006-001030',
    '006-001038',
    '006-005198', '006-005199', '006-005202', '006-005203', '006-005204', '006-005205',
    '006-005206', '006-005207', '006-005208', '006-005209', '006-005210', '006-005211',
  ],
};

// resolveGroup: 코드 → 그룹 결정 (내장 횤옜 커스텀 순서)
function resolveGroup(code: string, customRules: ProductCodeRule[]): ProductCodeGroup | null {
  const c = code.trim();
  if (!c) return null;
  // 먼저 사용자 커스텀 코드 체크
  const custom = customRules.find(r => r.code.trim() === c);
  if (custom) return custom.group;
  // 내장 코드 체크
  for (const [group, codes] of Object.entries(BUILT_IN_CODES)) {
    if (codes.includes(c)) return group as ProductCodeGroup;
  }
  return null;
}

// product 필드가 인코딩 손상 등으로 비었을 때 _raw JSON에서 품명 직접 추출
function getProductFallback(row: Record<string, string>): string {
  if (row.product) return row.product;
  // _raw에서 일본어 品名(품명) 또는 product 키 검색
  const PRODUCT_KEYS = ['\u54c1\u540d', '\u5546\u54c1\u540d', 'product', 'item'];
  try {
    const raw = JSON.parse(row._raw || '{}');
    for (const k of Object.keys(raw)) {
      if (PRODUCT_KEYS.some(pk => k.includes(pk) || pk.includes(k))) {
        if (raw[k]) return raw[k];
      }
    }
  } catch { /* ignore */ }
  return '';
}

// product_filter 쉼표 구분 다중 키워드 매칭 (대소문자 무시)
// 예: 'exocad,exoplan' → exocad OR exoplan 중 하나라도 포함되면 true
function matchesProductFilter(productVal: string, filterKeyword: string): boolean {
  if (!filterKeyword.trim()) return true; // 필터 없으면 전체 통과
  const keywords = filterKeyword.split(',').map(k => k.trim()).filter(Boolean);
  if (keywords.length === 0) return true;
  const lc = productVal.toLowerCase();
  return keywords.some(k => lc.includes(k.toLowerCase()));
}

// ────────────────────────────────────────────────────────────
// 대기 주문 DB 헬퍼
// ────────────────────────────────────────────────────────────
export function getPendingOrders(): PendingOrder[] {
  const db = getDb();
  return db.prepare(
    "SELECT * FROM pending_orders WHERE status = 'pending' ORDER BY created_at DESC"
  ).all() as PendingOrder[];
}

export function getAllOrders(): PendingOrder[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM pending_orders ORDER BY created_at DESC'
  ).all() as PendingOrder[];
}

export function listGroupedOrders(): GroupedOrder[] {
  const orders = getPendingOrders();
  const grouped = new Map<string, PendingOrder[]>();

  for (const order of orders) {
    const key = order.trade_number?.trim() || `single:${order.id}`;
    const bucket = grouped.get(key) ?? [];
    bucket.push(order);
    grouped.set(key, bucket);
  }

  return Array.from(grouped.entries())
    .map(([tradeNumber, bucket]) => {
      const ordersInGroup = bucket.sort((a, b) => a.id - b.id);
      const main = ordersInGroup.find(order => order.order_type === 'new' || order.order_type === 'renewal') ?? ordersInGroup[0] ?? null;
      const modules = ordersInGroup.filter(order => order !== main);
      return {
        trade_number: tradeNumber.startsWith('single:') ? '' : tradeNumber,
        main,
        modules,
        flagged_duplicate: ordersInGroup.some(order => !!order.flag_duplicate),
        created_at: ordersInGroup[0]?.created_at || '',
      };
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function updatePendingOrder(id: number, data: Partial<PendingOrder>): PendingOrder | undefined {
  const db = getDb();
  const fields: string[] = [];
  const values: any[] = [];

  const allowed = [
    'serial_number', 'customer_name', 'customer_email', 'customer_address',
    'customer_phone', 'dealer', 'sales_manager', 'purchase_date', 'expiry_date',
    'engine_build', 'version', 'main_product', 'modules', 'product_code', 'notes', 'order_type',
  ] as const;

  for (const key of allowed) {
    // undefined인 경우만 제외 (빈 문자열 포함 모든 값 허용)
    if (data[key] !== undefined) {
      fields.push(`${key} = ?`);
      values.push(data[key] ?? '');
    }
  }
  if (fields.length === 0) return db.prepare('SELECT * FROM pending_orders WHERE id = ?').get(id) as PendingOrder;

  values.push(id);
  db.prepare(`UPDATE pending_orders SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return db.prepare('SELECT * FROM pending_orders WHERE id = ?').get(id) as PendingOrder;
}

export async function approvePendingOrder(
  id: number,
  options?: { serial_status?: string; customer_id?: number; customer_data?: { name: string; email?: string; phone?: string; address?: string; dealer?: string; sales_manager?: string; notes?: string } },
): Promise<{ success: boolean; error?: string; customer_id?: number; was_renewed?: boolean }> {
  const db = getDb();
  const order = db.prepare('SELECT * FROM pending_orders WHERE id = ?').get(id) as PendingOrder | undefined;
  if (!order) return { success: false, error: '주문을 찾을 수 없습니다.' };

  try {
    const targetStatus = (options?.serial_status as any) || 'active';
    let was_renewed = false;
    const customerInput = options?.customer_data ?? {
      name: order.customer_name,
      email: order.customer_email,
      phone: order.customer_phone,
      address: order.customer_address,
      dealer: order.dealer,
      sales_manager: order.sales_manager,
    };
    const selectedCustomerId = options?.customer_id
      ?? (customerInput.name ? customerService.findOrCreate(customerInput).id : undefined);
    const today = getTodayDateString();
    const oneYearLater = new Date();
    oneYearLater.setFullYear(oneYearLater.getFullYear() + 1);
    const pollGroup = getPendingOrderPollGroup(order);

    if (pollGroup === 'memo') {
      const memoText = order.notes || `[${today}] ${order.version || order.product_code || 'memo'}`;
      const existing = serialService.getBySerialNumber(order.serial_number);
      if (!existing) {
        serialService.create({
          serial_number: order.serial_number || `IMPORT-${Date.now()}`,
          customer_id: selectedCustomerId,
          customer_name: customerInput.name,
          customer_email: customerInput.email,
          customer_address: customerInput.address,
          customer_phone: customerInput.phone,
          customer_manager: customerInput.sales_manager,
          dealer: customerInput.dealer,
          purchase_date: order.purchase_date || today,
          expiry_date: order.expiry_date || today,
          version: order.version,
          notes: memoText,
          status: targetStatus,
        });
      } else {
        const newNotes = existing.notes ? `${existing.notes}\n${memoText}` : memoText;
        serialService.update(existing.id, { notes: newNotes });
      }
      db.prepare("UPDATE pending_orders SET status = 'approved' WHERE id = ?").run(id);
      return { success: true, customer_id: selectedCustomerId };
    }

    if (pollGroup === 'version_update') {
      const existing = serialService.getBySerialNumber(order.serial_number);
      if (!existing) {
        serialService.create({
          serial_number: order.serial_number || `IMPORT-${Date.now()}`,
          customer_id: selectedCustomerId,
          customer_name: customerInput.name,
          customer_email: customerInput.email,
          customer_address: customerInput.address,
          customer_phone: customerInput.phone,
          customer_manager: customerInput.sales_manager,
          dealer: customerInput.dealer,
          purchase_date: order.purchase_date || today,
          expiry_date: order.expiry_date || today,
          version: order.version,
          notes: order.notes,
          status: targetStatus,
        });
      } else {
        serialService.update(existing.id, { version: order.version || '', notes: order.notes || existing.notes });
      }
      db.prepare("UPDATE pending_orders SET status = 'approved' WHERE id = ?").run(id);
      return { success: true, customer_id: selectedCustomerId };
    }

    if (order.order_type === 'new') {
      const existing = serialService.getBySerialNumber(order.serial_number);
      if (existing) {
        // 이미 존재 → 갱신 처리 (flag_duplicate가 설정된 경우). 호출자에게 was_renewed로 알림
        was_renewed = true;
        serialService.renewSerial(existing.id, 'manual');
        const customerUpdates: any = {};
        if (order.customer_name) customerUpdates.customer_name = order.customer_name;
        if (order.customer_email) customerUpdates.customer_email = order.customer_email;
        if (order.customer_phone) customerUpdates.customer_phone = order.customer_phone;
        if (order.customer_address) customerUpdates.customer_address = order.customer_address;
        if (order.sales_manager) customerUpdates.customer_manager = order.sales_manager;
        if (order.version) customerUpdates.version = order.version;
        if (order.main_product) customerUpdates.main_product = order.main_product;
        const modules = parseOrderModules(order);
        if (modules.length > 0) customerUpdates.modules = modules;
        if (order.notes) customerUpdates.notes = order.notes;
        if (order.purchase_date) customerUpdates.purchase_date = order.purchase_date;
        if (order.expiry_date) customerUpdates.expiry_date = order.expiry_date;
        if (Object.keys(customerUpdates).length > 0) {
          serialService.update(existing.id, customerUpdates);
        }
      } else {
        const input: SerialInput = {
          serial_number: order.serial_number || `IMPORT-${Date.now()}`,
          customer_id: selectedCustomerId,
          customer_name: customerInput.name,
          customer_email: customerInput.email,
          customer_address: customerInput.address,
          customer_phone: customerInput.phone,
          customer_manager: customerInput.sales_manager,
          dealer: customerInput.dealer,
          purchase_date: order.purchase_date || today,
          expiry_date: order.expiry_date || (targetStatus === 'active' ? getDateString(oneYearLater) : ''),
          engine_build: order.engine_build,
          version: order.version,
          main_product: order.main_product || order.version,
          modules: parseOrderModules(order),
          notes: order.notes,
          status: targetStatus,
        };
        serialService.create(input);
      }
    } else if (order.order_type === 'renewal') {
      const serial = serialService.getBySerialNumber(order.serial_number);
      if (!serial) return { success: false, error: `시리얼 ${order.serial_number}을 찾을 수 없습니다.` };
      const pollExpiry = normalizeDate(order.expiry_date);
      if (pollGroup === 'renewal' && pollExpiry) {
        const newExpiry = new Date(pollExpiry);
        newExpiry.setFullYear(newExpiry.getFullYear() + 1);
        serialService.renewSerialWithExpiry(serial.id, getDateString(newExpiry), 'manual');
      } else {
        serialService.renewSerial(serial.id, 'manual');
      }
    } else if (order.order_type === 'addon') {
      // addon: serial DB에 add_ons 추가
      const serial = serialService.getBySerialNumber(order.serial_number);
      if (serial) {
        try {
          const rawObj = JSON.parse(order.raw_data || '{}');
          const addOns: Array<{ name: string; added_date: string }> = rawObj._add_ons || [];
          for (const addon of addOns) {
            serialService.addAddon(serial.id, addon);
          }
        } catch { /* raw_data 파싱 실패 시 무시 */ }
      }
    }

    db.prepare("UPDATE pending_orders SET status = 'approved' WHERE id = ?").run(id);
    return { success: true, customer_id: selectedCustomerId, was_renewed: was_renewed || undefined };
  } catch (err: any) {
    logger.error(`Approval error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

export async function updateDataFromPendingOrder(id: number, form: Partial<PendingOrder>): Promise<{ success: boolean; data?: any; error?: string }> {
  const db = getDb();
  const order = db.prepare('SELECT * FROM pending_orders WHERE id = ?').get(id) as PendingOrder | undefined;
  if (!order) return { success: false, error: '주문을 찾을 수 없습니다.' };

  try {
    const targetSerialName = form.serial_number || order.serial_number;
    const existing = serialService.getBySerialNumber(targetSerialName);
    if (!existing) return { success: false, error: `DB에 시리얼 ${targetSerialName}이 존재하지 않습니다.` };

    const updates: any = {};
    const fields = ['customer_name', 'customer_email', 'customer_phone', 'customer_address', 'sales_manager', 'purchase_date', 'version', 'main_product', 'notes'];
    fields.forEach(f => {
      // undefined/null인 경우만 제외 — 빈 문자열도 업데이트 허용
      if ((form as any)[f] !== undefined && (form as any)[f] !== null) {
        updates[f] = (form as any)[f];
      }
    });

    if (form.serial_status) updates.status = form.serial_status;
    if (form.modules !== undefined && form.modules !== null) updates.modules = parseOrderModules(form as PendingOrder);
    if (form.serial_status === 'broken') {
      updates.expiry_date = null;
    } else if (form.expiry_date !== undefined && form.expiry_date !== null) {
      updates.expiry_date = form.expiry_date;
    }

    if (Object.keys(updates).length > 0) {
      serialService.update(existing.id, updates);
    }

    db.prepare("UPDATE pending_orders SET status = 'approved' WHERE id = ?").run(id);
    return { success: true, data: serialService.getBySerialNumber(targetSerialName) };
  } catch (err: any) {
    logger.error(`Existing data update error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

export function rejectPendingOrder(id: number): void {
  const db = getDb();
  db.prepare("UPDATE pending_orders SET status = 'rejected' WHERE id = ?").run(id);
}

export function deletePendingOrder(id: number): void {
  const db = getDb();
  db.prepare('DELETE FROM pending_orders WHERE id = ?').run(id);
}

// ────────────────────────────────────────────────────────────
// source_id 중복 체크
// ────────────────────────────────────────────────────────────
export function isAlreadyFetched(sourceId: string): boolean {
  const db = getDb();
  const row = db.prepare(
    'SELECT COUNT(*) as cnt FROM pending_orders WHERE source_id = ?'
  ).get(sourceId) as { cnt: number };
  return row.cnt > 0;
}

type PendingOrderInsert =
  Omit<PendingOrder, 'id' | 'created_at' | 'trade_number' | 'dealer' | 'main_product' | 'modules'> &
  { trade_number?: string; dealer?: string; main_product?: string; modules?: string };

export function insertPendingOrder(
  data: PendingOrderInsert,
): boolean {
  const db = getDb();
  const result = db.prepare(`
    INSERT OR IGNORE INTO pending_orders
      (source_id, source_url, trade_number, serial_number, customer_name, customer_email,
       customer_address, customer_phone, dealer, sales_manager, purchase_date,
       expiry_date, engine_build, version, main_product, modules, notes, order_type, raw_data, status,
       product_code, flag_duplicate)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',?,?)
  `).run(
    data.source_id, data.source_url, data.trade_number ?? '', data.serial_number, data.customer_name,
    data.customer_email, data.customer_address, data.customer_phone,
    data.dealer ?? '', data.sales_manager, data.purchase_date, data.expiry_date,
    data.engine_build, data.version, data.main_product ?? '', data.modules ?? '[]',
    data.notes, data.order_type, data.raw_data, data.product_code ?? '', data.flag_duplicate ?? 0,
  );
  if (result.changes === 0) {
    logger.info(`[Polling] duplicate pending order ignored: source_id=${data.source_id} serial=${data.serial_number || '(empty)'}`);
    return false;
  }
  logger.info(`[Polling] pending order saved: source_id=${data.source_id} serial=${data.serial_number || '(empty)'} type=${data.order_type}`);
  return true;
}

function withPollingMetadata(rawData: string, metadata: Record<string, unknown>): string {
  try {
    const rawObj = JSON.parse(rawData || '{}');
    return JSON.stringify({ ...rawObj, ...metadata });
  } catch {
    return JSON.stringify({ _raw: rawData, ...metadata });
  }
}

function getPendingOrderPollGroup(order: PendingOrder): ProductCodeGroup | null {
  try {
    const rawObj = JSON.parse(order.raw_data || '{}');
    if (typeof rawObj._poll_group === 'string') return rawObj._poll_group as ProductCodeGroup;
  } catch { /* ignore */ }
  return resolveGroup(order.product_code || '', getSettings().custom_product_code_rules || []);
}

function parseOrderModules(order: Pick<PendingOrder, 'modules' | 'raw_data'>): string[] {
  const modules = new Set<string>();
  const addName = (item: any) => {
    const name = typeof item === 'string' ? item : item?.name;
    if (name) modules.add(String(name).trim());
  };

  try {
    const parsed = JSON.parse(order.modules || '[]');
    if (Array.isArray(parsed)) parsed.forEach(addName);
  } catch { /* ignore */ }

  try {
    const rawObj = JSON.parse(order.raw_data || '{}');
    if (Array.isArray(rawObj._add_ons)) rawObj._add_ons.forEach(addName);
  } catch { /* ignore */ }

  return Array.from(modules).filter(Boolean);
}

function buildPolledSourceId(
  source: PollSource,
  row: Record<string, string>,
  group: ProductCodeGroup | null,
  code: string,
  serial: string,
): string {
  const orderKey = row.invoice_no || row._raw?.slice(0, 40) || code || group || 'unknown';
  return `${source.id}::${group || 'uncategorized'}::${serial || 'no-serial'}::${orderKey}`;
}

function insertPendingFromPolledRow(
  source: PollSource,
  row: Record<string, string>,
  group: ProductCodeGroup | null,
  code: string,
  orderType: PendingOrder['order_type'],
  options: Partial<PendingOrderInsert> = {},
): boolean {
  const serial = (row.serial || '').trim();
  const productVal = getProductFallback(row);
  const sourceId = options.source_id || buildPolledSourceId(source, row, group, code, serial);
  if (isAlreadyFetched(sourceId)) {
    logger.info(`[Polling] already fetched order skipped: source_id=${sourceId} serial=${serial || '(empty)'}`);
    return false;
  }

  return insertPendingOrder({
    source_id: sourceId,
    source_url: source.url,
    serial_number: serial,
    customer_name: row.customer || '',
    customer_email: '',
    customer_address: '',
    customer_phone: row.phone || '',
    dealer: '',
    sales_manager: '',
    trade_number: row.invoice_no || '',
    main_product: orderType === 'new' ? productVal : '',
    modules: '[]',
    purchase_date: normalizeDate(row.purchase) || '',
    expiry_date: normalizeDate(row.expiry) || '',
    engine_build: '',
    version: productVal,
    notes: [
      `자동수집: ${source.name}`,
      row.invoice_no ? `출고번호: ${row.invoice_no}` : '',
      code ? `상품코드: ${code}` : '',
      group ? `분류: ${group}` : '',
    ].filter(Boolean).join(' / '),
    order_type: orderType,
    raw_data: withPollingMetadata(row._raw || '{}', { _poll_group: group, _product_code: code }),
    status: 'pending',
    product_code: code,
    flag_duplicate: serial && serialService.getBySerialNumber(serial) ? 1 : 0,
    ...options,
  });
}

// ────────────────────────────────────────────────────────────
// Playwright 크롤링 공유 헬퍼
// ────────────────────────────────────────────────────────────

async function loginToSource(page: Page, source: PollSource): Promise<void> {
  if (!source.login_url || !source.login_id) return;
  await page.goto(source.login_url, { waitUntil: 'domcontentloaded', timeout: 30000 });

  if (source.login_url.includes('geomedi.online')) {
    const idField = page.locator('input[name="admin_id"]');
    const pwField = page.locator('input[name="admin_pw"]');
    const currentId = await idField.inputValue().catch(() => '');
    const currentPw = await pwField.inputValue().catch(() => '');
    if (!currentId) await idField.fill(source.login_id);
    if (!currentPw) await pwField.fill(source.login_pw);
    await page.locator('button.btn_login, input[src*="btn_login"], button.btn_black').first().click();
  } else {
    const idSelectors = ['input[type="email"]', 'input[name="id"]', 'input[name="username"]', 'input[name="user_id"]', '#id', '#username'];
    const pwSelectors = ['input[type="password"]', 'input[name="password"]', 'input[name="pw"]', '#pw', '#password'];
    const btnSelectors = ['button[type="submit"]', 'input[type="submit"]', '.btn-login', '#loginBtn', 'button:has-text("로그인")', 'button:has-text("Login")'];
    for (const sel of idSelectors) {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 2000 }).catch(() => false)) { await el.fill(source.login_id); break; }
    }
    for (const sel of pwSelectors) {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 2000 }).catch(() => false)) { await el.fill(source.login_pw); break; }
    }
    for (const sel of btnSelectors) {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 2000 }).catch(() => false)) { await el.click(); break; }
    }
  }
  await page.waitForLoadState('domcontentloaded').catch(() => { });
  await page.waitForTimeout(2000);
}

async function setupOrderPage(page: Page, source: PollSource, logPrefix: string): Promise<void> {
  await page.goto(source.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);

  if (!source.url.includes('stock_serial.html')) return;

  const categorySelected = await page.evaluate(() => {
    const sel = document.querySelector('select[name="s_h_code_fk"]') as HTMLSelectElement | null;
    if (!sel) return false;
    sel.value = '0013';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    if (typeof (window as any).sub_dir10 === 'function') (window as any).sub_dir10();
    return true;
  });
  if (categorySelected) {
    logger.info(`${logPrefix} ${source.name}: selected item category CAD(0013)`);
    await page.waitForTimeout(2000);
  } else {
    logger.warn(`${logPrefix} ${source.name}: s_h_code_fk dropdown not found.`);
  }

  const today = getTodayDateString();
  await page.evaluate((date) => {
    const dateInput = document.getElementById('s_date1') as HTMLInputElement;
    if (dateInput) {
      dateInput.readOnly = false;
      dateInput.value = date;
      dateInput.dispatchEvent(new Event('input', { bubbles: true }));
      dateInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, today);

  const searchBtn = page.locator('button:has-text("検索"), button.btn_black, input[type="button"][value*="検索"]').first();
  if (await searchBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await searchBtn.click();
  }
  await page.waitForTimeout(2500);
}

function buildFieldMap(source: PollSource): Record<string, string> {
  return {
    serial: source.field_serial || 'LOT',
    serial_alt: 'シリアル番号',
    customer: source.field_customer || '注文先',
    phone: source.field_phone || '',
    purchase: source.field_purchase || '入荷日',
    expiry: source.field_expiry || '出荷日',
    product: source.field_product || '品名',
    delivery_to: '納品先',
    invoice_no: '出荷伝票',
    item_code: '商品コード',
  };
}

async function parseTablePage(page: Page, fieldMap: Record<string, string>): Promise<Record<string, string>[]> {
  const MIN_DATA_COLS = 5;
  const rows = await page.evaluate((args: { fieldMap: Record<string, string>; minCols: number }) => {
    const { fieldMap, minCols } = args;
    const results: Record<string, string>[] = [];
    for (const table of Array.from(document.querySelectorAll('table'))) {
      const headerRow = table.querySelector('thead tr, tr:first-child');
      if (!headerRow) continue;
      const headers = Array.from(headerRow.querySelectorAll('th, td'))
        .map((c: Element) => (c.textContent || '').replace(/\s+/g, ' ').trim());
      if (headers.length < minCols) continue;
      for (const row of Array.from(table.querySelectorAll('tbody tr, tr:not(:first-child)'))) {
        const cells = Array.from(row.querySelectorAll('td'));
        if (cells.length < minCols) continue;
        const record: Record<string, string> = {};
        cells.forEach((c: Element, i: number) => {
          if (i < headers.length) record[headers[i]] = (c.textContent || '').replace(/\s+/g, ' ').trim();
        });
        const mapped: Record<string, string> = { _raw: JSON.stringify(record) };
        for (const [key, hdr] of Object.entries(fieldMap)) {
          if (!hdr) continue;
          const h = headers.find(h => h.toLowerCase().includes(hdr.toLowerCase()) || hdr.toLowerCase().includes(h.toLowerCase()));
          if (h) mapped[key] = record[h] || '';
        }
        if (Object.keys(mapped).length > 1) results.push(mapped);
      }
    }
    return results;
  }, { fieldMap, minCols: MIN_DATA_COLS });
  for (const r of rows) { if (!r.serial && r.serial_alt) r.serial = r.serial_alt; }
  return rows;
}

function createPageNavigator(page: Page, source: PollSource, logPrefix: string) {
  let pageUrlTemplate: string | null = null;
  const URL_PATTERNS = [
    /(.*[?&]page_num=)\d+(&.*|$)/i,
    /(.*[?&]page=)\d+(&.*|$)/i,
    /(.*[?&]p=)\d+(&.*|$)/i,
    /(.*[?&]pg=)\d+(&.*|$)/i,
    /(.*[?&]current_page=)\d+(&.*|$)/i,
  ];

  return async (targetNum: number): Promise<boolean> => {
    if (pageUrlTemplate) {
      const targetUrl = pageUrlTemplate.replace('__PAGE__', String(targetNum));
      logger.info(`${logPrefix} ${source.name}: page ${targetNum} URL pattern navigation -> ${targetUrl.slice(0, 80)}`);
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(1500);
      return true;
    }

    const href = await page.evaluate((n) => {
      const all = Array.from(document.querySelectorAll('a'));
      const target = all.find(l =>
        l.textContent?.trim() === String(n) &&
        (l as HTMLAnchorElement).href &&
        !(l.getAttribute('onclick') || '').includes('pop_up')
      );
      return target ? (target as HTMLAnchorElement).href : null;
    }, targetNum);

    if (href) {
      if (!pageUrlTemplate) {
        for (const pat of URL_PATTERNS) {
          const m = href.match(pat);
          if (m) {
            pageUrlTemplate = m[1] + '__PAGE__' + m[2];
            logger.info(`${logPrefix} page URL pattern found: ${pageUrlTemplate.slice(0, 80)}`);
            break;
          }
        }
      }
      logger.info(`${logPrefix} ${source.name}: page ${targetNum} navigation -> ${href.slice(0, 80)}`);
      await page.goto(href, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(1500);
      return true;
    }

    logger.info(`${logPrefix} ${source.name}: no page ${targetNum} link; collection finished`);
    return false;
  };
}

async function collectAllPages(
  page: Page,
  source: PollSource,
  fieldMap: Record<string, string>,
  logPrefix: string,
): Promise<Record<string, string>[]> {
  const tableData: Record<string, string>[] = [];
  const MAX_PAGES = 200;
  const navigateToPage = createPageNavigator(page, source, logPrefix);

  const firstRows = await parseTablePage(page, fieldMap);
  if (firstRows.length > 0) tableData.push(...firstRows);
  logger.info(`${logPrefix} ${source.name}: page 1 -> ${firstRows.length} rows`);

  for (let pg = 2; pg <= MAX_PAGES; pg++) {
    const ok = await navigateToPage(pg);
    if (!ok) break;
    const pgRows = await parseTablePage(page, fieldMap);
    if (pgRows.length === 0) break;
    tableData.push(...pgRows);
    logger.info(`${logPrefix} ${source.name}: page ${pg} -> ${pgRows.length} rows`);
  }

  return tableData;
}

// ────────────────────────────────────────────────────────────
// Playwright 크롤링 핵심 로직
// ────────────────────────────────────────────────────────────
async function crawlSource(source: PollSource): Promise<{ found: number; errors: string[] }> {
  const errors: string[] = [];
  let found = 0;
  let browser: Browser | null = null;

  try {
    logger.info(`[Crawling] started: ${source.name} (${source.url})`);
    browser = await chromium.launch({ headless: true });
    const context: BrowserContext = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    });
    const page = await context.newPage();

    await loginToSource(page, source);
    await setupOrderPage(page, source, '[Crawling]');

    const fieldMap = buildFieldMap(source);
    const tableData = await collectAllPages(page, source, fieldMap, '[폴링]');
    logger.info(`[Crawling] ${source.name}: collected ${tableData.length} total rows`);


    // ── 결과를 대기 주문으로 저장 ─────────────────
    const settings = getSettings();
    const customRules: ProductCodeRule[] = settings.custom_product_code_rules || [];
    const today = getTodayDateString();

    // serial 기준으로 행 그룹키록
    const serialGroups = new Map<string, Array<{ row: Record<string, string>; group: ProductCodeGroup; code: string }>>();
    const standaloneRows: Array<{ row: Record<string, string>; group: ProductCodeGroup; code: string }> = [];

    const filterKeyword = (source.product_filter || '').trim().toLowerCase();

    for (const row of tableData) {
      const code = (row.item_code || '').trim();
      const group = resolveGroup(code, customRules);

      // GROUP F: 완전 무시
      if (group === 'ignore') continue;

      // group === null: 상품코드 없거나 미등록 코드 → product_filter 적용 후 기존 방식으로 pending 저장 (폴백)
      if (group === null) {
        const productVal = getProductFallback(row);
        if (!matchesProductFilter(productVal, filterKeyword)) continue;
        const serial = (row.serial || '').trim();
        try {
          if (insertPendingFromPolledRow(source, row, null, code, 'new', {
            source_id: buildPolledSourceId(source, row, null, code, serial),
            version: productVal,
            main_product: productVal,
            flag_duplicate: 0,
          })) found++;
        } catch (insertErr: any) {
          logger.error(`[Polling] DB save failed (null group) serial=${serial}: ${insertErr.message}`);
          errors.push(`DB 저장 실패: ${insertErr.message}`);
        }
        continue;
      }

      const serial = (row.serial || '').trim();

      // GROUP A: Renewal — 대기 주문으로 저장 후 사용자 승인 시 처리
      if (group === 'renewal') {
        if (!serial) continue;
        if (insertPendingFromPolledRow(source, row, group, code, 'renewal')) found++;
        continue;
      }

      // GROUP D: Memo — 대기 주문으로 저장 후 사용자 승인 시 처리
      if (group === 'memo') {
        if (!serial) continue;
        if (insertPendingFromPolledRow(source, row, group, code, 'new', {
          notes: `[${today}] ${row.product || code}`,
        })) found++;
        continue;
      }

      // GROUP E: Version Update — 대기 주문으로 저장 후 사용자 승인 시 처리
      if (group === 'version_update') {
        if (!serial) continue;
        if (insertPendingFromPolledRow(source, row, group, code, 'new')) found++;
        continue;
      }

      // GROUP B + C (main / addon): serial로 그룹키록
      if (serial) {
        if (!serialGroups.has(serial)) serialGroups.set(serial, []);
        serialGroups.get(serial)!.push({ row, group, code });
      } else {
        standaloneRows.push({ row, group, code });
      }
    }

    // ── GROUP B + C: serial 그룹별 처리
    for (const [serial, entries] of serialGroups) {
      const sourceId = `${source.id}::${serial}`;
      if (isAlreadyFetched(sourceId)) continue;

      // Product filter 체크 (코마 구분 다중 키워드)
      if (filterKeyword) {
        const anyMatch = entries.some(e => matchesProductFilter(getProductFallback(e.row), filterKeyword));
        if (!anyMatch) continue;
      }

      const mainEntry = entries.find(e => e.group === 'main');
      const addonEntries = entries.filter(e => e.group === 'addon');

      // main row 또는 첫 번째 항목
      const baseRow = mainEntry ? mainEntry.row : entries[0].row;
      const mainCode = mainEntry ? mainEntry.code : entries[0].code;
      const mainProduct = mainEntry ? (mainEntry.row.product || '') : '';

      // add_ons 리스트
      const addOns = addonEntries.map(e => ({
        name: e.row.product || e.code,
        added_date: today,
      }));

      const existingSerial = serialService.getBySerialNumber(serial);
      const isDuplicate = existingSerial ? 1 : 0;

      if (isDuplicate) {
        logger.info(`[Polling] duplicate serial detected (flag): ${serial}`);
      }

      const pendingData: PendingOrderInsert = {
        source_id: sourceId,
        source_url: source.url,
        serial_number: serial,
        customer_name: baseRow.customer || '',
        customer_email: '',
        customer_address: '',
        customer_phone: baseRow.phone || '',
        dealer: '',
        sales_manager: '',
        trade_number: baseRow.invoice_no || '',
        main_product: mainProduct,
        modules: JSON.stringify(addOns),
        purchase_date: normalizeDate(baseRow.purchase) || '',
        expiry_date: normalizeDate(baseRow.expiry) || '',
        engine_build: '',
        version: mainProduct,
        notes: [
          `자동수집: ${source.name}`,
          baseRow.invoice_no ? `출고번호: ${baseRow.invoice_no}` : '',
          addonEntries.length > 0
            ? `Add-ons: ${addonEntries.map(e => e.row.product || e.code).join(', ')}`
            : '',
        ].filter(Boolean).join(' / '),
        order_type: mainEntry ? 'new' : 'addon',
        raw_data: withPollingMetadata(baseRow._raw || '{}', { _poll_group: mainEntry ? 'main' : 'addon', _product_code: mainCode }),
        status: 'pending',
        product_code: mainCode,
        flag_duplicate: isDuplicate,
      };

      // add_ons를 pending_orders의 raw_data에도 포함 (승인 시 사용)
      try {
        const rawObj = JSON.parse(pendingData.raw_data);
        rawObj._add_ons = addOns;
        pendingData.raw_data = JSON.stringify(rawObj);
      } catch { /* ignore */ }

      try {
        if (insertPendingOrder(pendingData)) found++;
      } catch (insertErr: any) {
        logger.error(`[Polling] DB save failed (group B/C) serial=${serial} source_id=${sourceId}: ${insertErr.message}`);
        errors.push(`DB 저장 실패 (${serial}): ${insertErr.message}`);
      }
    }

    // standalone (serial 없는 경우) — 상품코드만 pending으로 남김
    for (const { row, group, code } of standaloneRows) {
      const sourceId = `${source.id}::${row._raw?.slice(0, 40) || code}`;
      if (isAlreadyFetched(sourceId)) continue;

      const standaloneFilterKeyword = (source.product_filter || '').trim().toLowerCase();
      if (!matchesProductFilter(row.product || '', standaloneFilterKeyword)) continue;

      try {
        if (insertPendingOrder({
          source_id: sourceId,
          source_url: source.url,
          serial_number: '',
          customer_name: row.customer || '',
          customer_email: '',
          customer_address: '',
          customer_phone: row.phone || '',
          sales_manager: '',
          trade_number: row.invoice_no || '',
          purchase_date: normalizeDate(row.purchase) || '',
          expiry_date: normalizeDate(row.expiry) || '',
          engine_build: '',
          version: row.product || '',
          notes: `자동수집: ${source.name}`,
          order_type: group === 'main' ? 'new' : 'addon',
          raw_data: withPollingMetadata(row._raw || '{}', { _poll_group: group, _product_code: code }),
          status: 'pending',
          product_code: code,
          flag_duplicate: 0,
        })) found++;
      } catch (insertErr: any) {
        logger.error(`[Polling] DB save failed (standalone) code=${code} source_id=${sourceId}: ${insertErr.message}`);
        errors.push(`DB 저장 실패 (standalone): ${insertErr.message}`);
      }
    }

    logger.info(`[Crawling] finished: ${source.name} (collected=${found}, errors=${errors.length})`);
  } catch (err: any) {
    const msg = `[Crawling] ${source.name} error: ${err.message}`;
    logger.error(msg);
    errors.push(msg);
  } finally {
    if (browser) await browser.close().catch(() => { });
  }

  return { found, errors };
}

// ────────────────────────────────────────────────────────────
// 날짜 정규화
// ────────────────────────────────────────────────────────────
function normalizeDate(value: string | undefined): string {
  if (!value) return '';
  const s = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // YYYY.MM.DD or YYYY/MM/DD
  const m1 = s.match(/^(\d{4})[./](\d{1,2})[./](\d{1,2})$/);
  if (m1) return `${m1[1]}-${m1[2].padStart(2, '0')}-${m1[3].padStart(2, '0')}`;
  // YY.MM.DD (geomedi 형식: 예 26.02.20 → 2026-02-20)
  const m2 = s.match(/^(\d{2})[./](\d{1,2})[./](\d{1,2})$/);
  if (m2) return `20${m2[1]}-${m2[2].padStart(2, '0')}-${m2[3].padStart(2, '0')}`;
  // MM/DD/YYYY
  const m3 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m3) return `${m3[3]}-${m3[1].padStart(2, '0')}-${m3[2].padStart(2, '0')}`;
  try {
    const d = new Date(s);
    if (!isNaN(d.getTime())) return getDateString(d);
  } catch { /* ignore */ }
  return '';
}

// ────────────────────────────────────────────────────────────
// 폴링 스케줄러
// ────────────────────────────────────────────────────────────
export async function pollNow(sourceId?: string): Promise<{ found: number; errors: string[] }> {
  logger.info(`[Polling] polling job started (Source: ${sourceId || 'all'})`);
  const settings = getSettings();
  const sources = (settings.poll_sources || []).filter(s =>
    s.enabled && (sourceId ? s.id === sourceId : true)
  );

  if (sources.length === 0) return { found: 0, errors: ['활성화된 폴링 소스가 없습니다.'] };

  pollStatus.running = true;
  pollStatus.message = '폴링 중...';

  let totalFound = 0;
  const allErrors: string[] = [];

  for (const source of sources) {
    const { found, errors } = await crawlSource(source);
    totalFound += found;
    allErrors.push(...errors);

    // last_polled 업데이트
    const updatedSources = settings.poll_sources.map(s =>
      s.id === source.id ? { ...s, last_polled: getNowTimestampString() } : s
    );
    saveSettings({ poll_sources: updatedSources });
  }

  pollStatus.running = false;
  pollStatus.lastRun = getNowTimestampString();
  pollStatus.message = `마지막 폴링: ${totalFound}건 수집`;
  logger.info(`[Polling] polling job completed (sources=${sources.length}, total_collected=${totalFound})`);
  return { found: totalFound, errors: allErrors };
}

// ────────────────────────────────────────────────────────────
// Dry-run 크롤링: DB에 저장하지 않고 수집될 행 미리보기
// ────────────────────────────────────────────────────────────
async function crawlSourceDryRun(source: PollSource): Promise<PollDryRunSourceResult> {
  const result: PollDryRunSourceResult = {
    source_name: source.name,
    source_id: source.id,
    rows: [],
    already_fetched: 0,
    would_insert: 0,
    error: undefined,
  };

  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({ headless: true });
    const context: BrowserContext = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    });
    const page = await context.newPage();

    await loginToSource(page, source);
    await setupOrderPage(page, source, '[Dry-Run]');

    const fieldMap = buildFieldMap(source);
    const tableData = await collectAllPages(page, source, fieldMap, '[Dry-Run]');


    // 결과 분류 (저장하지 않고 미리보기만)
    const filterKeyword = (source.product_filter || '').trim();
    logger.info(`[Dry-Run] ${source.name}: product_filter="${source.product_filter}" -> filterKeyword="${filterKeyword}"`);

    for (const row of tableData) {
      const sourceId = `${source.id}::${row.serial || row._raw.slice(0, 40)}`;
      const alreadyExists = isAlreadyFetched(sourceId);

      const productVal = getProductFallback(row);
      const filteredOut = !matchesProductFilter(productVal, filterKeyword);

      // 쳋 5행에 대해 상세 로그 출력 (디버그용)
      if (result.rows.length < 5) {
        logger.info(`[Dry-Run] row[${result.rows.length}] serial="${row.serial}" product="${row.product}" productResolved="${productVal}" item_code="${row.item_code}" -> filteredOut=${filteredOut}`);
      }

      const previewRow: PreviewRow = {
        serial_number: row.serial || '',
        customer_name: row.customer || '',
        phone: row.phone || '',
        purchase_date: normalizeDate(row.purchase) || '',
        expiry_date: normalizeDate(row.expiry) || '',
        product: row.product || '',
        already_exists: alreadyExists,
        filtered_out: filteredOut,
      };

      result.rows.push(previewRow);

      if (alreadyExists) {
        result.already_fetched++;
      } else if (filteredOut) {
        // counted in rows but not would_insert
      } else {
        result.would_insert++;
      }
    }

    logger.info(`[Dry-Run Poll] ${source.name}: rows_found=${result.rows.length}, new=${result.would_insert}, duplicates=${result.already_fetched}`);

  } catch (err: any) {
    const msg = `[Dry-Run Poll] ${source.name} error: ${err.message}`;
    logger.error(msg);
    result.error = msg;
  } finally {
    if (browser) await browser.close().catch(() => { });
  }

  return result;
}

export async function pollDryRun(sourceId?: string, sourceOverrides?: Partial<PollSource>): Promise<PollDryRunResult> {
  const settings = getSettings();
  const sources = (settings.poll_sources || []).filter(s =>
    s.enabled && (sourceId ? s.id === sourceId : true)
  );

  const dryResult: PollDryRunResult = { sources: [] };

  if (sources.length === 0) {
    dryResult.sources.push({
      source_name: 'N/A',
      source_id: '',
      rows: [],
      already_fetched: 0,
      would_insert: 0,
      error: '활성화된 폴링 소스가 없습니다.',
    });
    return dryResult;
  }

  for (const source of sources) {
    // sourceOverrides 적용 (저장 전 form 값 반영)
    const effectiveSource = sourceOverrides ? { ...source, ...sourceOverrides } : source;
    const sourceResult = await crawlSourceDryRun(effectiveSource);
    dryResult.sources.push(sourceResult);
  }

  return dryResult;
}

export function startPollingScheduler(): void {
  stopPollingScheduler();
  const settings = getSettings();
  const enabledSources = (settings.poll_sources || []).filter(s => s.enabled);
  
  logger.info(`[Scheduler] order polling schedule registration started (enabled_sources=${enabledSources.length})`);
  
  for (const source of enabledSources) {
    if (source.schedule_times && source.schedule_times.length > 0) {
      const tasks: cron.ScheduledTask[] = [];
      for (const time of source.schedule_times) {
        try {
          const [hourStr, minuteStr] = time.split(':');
          if (!hourStr || !minuteStr) continue;
          
          const hour = parseInt(hourStr, 10);
          const minute = parseInt(minuteStr, 10);
          const cronExpr = `${minute} ${hour} * * *`;
          
          const task = cron.schedule(cronExpr, async () => {
            logger.info(`[Scheduler] scheduled polling started: ${source.name} (${time})`);
            await pollNow(source.id).catch(err => {
              logger.error(`[Scheduler] scheduled polling failed (${source.name}): ${err.message}`);
            });
          }, { timezone: 'Asia/Tokyo' });
          
          tasks.push(task);
          logger.info(`[Scheduler] schedule registered: ${source.name} -> ${cronExpr} (KST)`);
        } catch (err: any) {
          logger.error(`[Scheduler] schedule registration error (${source.name}, ${time}): ${err.message}`);
        }
      }
      cronTasks.set(source.id, tasks);
    } else {
      logger.info(`[Scheduler] ${source.name} - no scheduled times.`);
    }
  }
}

export function stopPollingScheduler(): void {
  for (const tasks of cronTasks.values()) {
    for (const task of tasks) task.stop();
  }
  cronTasks.clear();
}

export function getPollStatus(): PollStatus {
  return { ...pollStatus };
}
