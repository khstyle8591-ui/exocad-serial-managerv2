import { chromium, Browser, BrowserContext } from 'playwright';
import cron from 'node-cron';
import { getDb } from '../database';
import { getSettings, saveSettings } from '../settings';
import { serialService } from './serial.service';
import { logger } from '../utils/logger';
import type { PendingOrder, PollSource, SerialInput, PollDryRunResult, PollDryRunSourceResult, PreviewRow, ProductCodeGroup, ProductCodeRule } from '../../shared/types';

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
// ────────────────────────────────────────────────────────────
// 품목 코드 → 카테고리 매핑
//   카테고리 A : 신규 (new) — order_type='new'
//   카테고리 B : Add-on — 기존 시리얼에 add-ons 추가
//   카테고리 C : 갱신 (renewal) — expiry +1년
//   카테고리 D : 메모만 — memo 기입 후 변경 없음
// ────────────────────────────────────────────────────────────
const BUILT_IN_CODES: Record<ProductCodeGroup, string[]> = {
  // 카테고리 A — 신규 등록 (新規)
  main: [
    '006-001001', '006-001010', '006-001032', '006-001034', '006-001020',
    '006-005080', '006-005082', '006-005083', '006-005098', '006-005099',
    '006-006100', '006-006101', '006-006102',
  ],
  // 카테고리 B — Add-on 추가
  addon: [
    '006-001002', '006-001003', '006-001004', '006-001005', '006-001006', '006-001007',
    '006-001008', '006-001009', '006-001012', '006-001013',
    '006-001014', '006-001015', '006-001016', '006-001037', '006-001036', '006-001039',
    '006-005100', '006-005101', '006-005102', '006-005103', '006-005104', '006-005105',
    '006-005106', '006-005107', '006-005108', '006-005109', '006-005110',
    '006-006103',
  ],
  // 카테고리 C — 갱신 (Renewal, expiry +1년)
  renewal: [
    '006-001017', '006-001035',
    '006-005200', '006-005201', '006-005212', '006-005213', '006-005214', '006-005215',
    '006-006104', '006-006105', '006-006106',
  ],
  // 카테고리 D — 메모 기입만
  memo: [
    '006-001011', '006-001033', '006-001040', '006-001041',
    '006-001018', '006-001019', '006-001021', '006-001022', '006-001023', '006-001024',
    '006-001025', '006-001026', '006-001027', '006-001028', '006-001029', '006-001030',
    '006-001038', '006-001031',
    '006-005081',
    '006-005198', '006-005199', '006-005202', '006-005203', '006-005204', '006-005205',
    '006-005206', '006-005207', '006-005208', '006-005209', '006-005210', '006-005211',
    '006-006107',
  ],
  // 하위 호환 (직접 사용하지 않음 — 커스텀 룰에서만 사용 가능)
  version_update: [],
  ignore: [],
};

// 품목코드 → 품명 매핑 테이블
const CODE_TO_PRODUCT_NAME: Record<string, string> = {
  // ── 카테고리 A ──
  '006-001001': 'exocad DentalCAD Core',
  '006-001010': 'exocad DentalCAD (Standard)',
  '006-001032': 'exocad DentalCAD (Version Update)',
  '006-001034': 'exocad DentalCAD Core Version',
  '006-001020': 'exocad DentalCAD 2in1',
  '006-005080': 'exocad ChairsideCAD',
  '006-005082': 'exocad ChairsideCAD SE',
  '006-005083': 'exocad ChairsideCAD Standard',
  '006-005098': 'exocad ChairsideCAD Pro',
  '006-005099': 'exocad ChairsideCAD Premium',
  '006-006100': 'exocad exoplan Core',
  '006-006101': 'exocad exoplan Standard',
  '006-006102': 'exocad exoplan Pro',
  // ── 카테고리 B ──
  '006-001002': 'Model Creator',
  '006-001003': 'Virtual Articulator',
  '006-001004': 'TruSmile',
  '006-001005': 'Smile Creator',
  '006-001006': 'Implant Module',
  '006-001007': 'CAD-CAM Module',
  '006-001008': 'Surgical Guide Module',
  '006-001009': 'Partial Framework Module',
  '006-001012': 'Full Denture Module',
  '006-001013': 'Orthodontics Module',
  '006-001014': 'Quick Model Creator',
  '006-001015': 'Model Creator Pro',
  '006-001016': 'Digital Bite Registration',
  '006-001037': 'Flexible Partial Denture',
  '006-001036': 'Smile Composer',
  '006-001039': 'Partner Cloud Module',
  '006-005100': 'ChairsideCAD Add-on 1',
  '006-005101': 'ChairsideCAD Add-on 2',
  '006-005102': 'ChairsideCAD Add-on 3',
  '006-005103': 'ChairsideCAD Add-on 4',
  '006-005104': 'ChairsideCAD Add-on 5',
  '006-005105': 'ChairsideCAD Add-on 6',
  '006-005106': 'ChairsideCAD Add-on 7',
  '006-005107': 'ChairsideCAD Add-on 8',
  '006-005108': 'ChairsideCAD Add-on 9',
  '006-005109': 'ChairsideCAD Add-on 10',
  '006-005110': 'ChairsideCAD Add-on 11',
  '006-006103': 'exoplan Add-on',
  // ── 카테고리 C ──
  '006-001017': 'Maintenance/Renewal',
  '006-001035': 'DentalCAD Renewal',
  '006-005200': 'ChairsideCAD Renewal',
  '006-005201': 'ChairsideCAD SE Renewal',
  '006-005212': 'ChairsideCAD Renewal (2yr)',
  '006-005213': 'ChairsideCAD Renewal (3yr)',
  '006-005214': 'ChairsideCAD Renewal (4yr)',
  '006-005215': 'ChairsideCAD Renewal (5yr)',
  '006-006104': 'exoplan Renewal',
  '006-006105': 'exoplan Renewal (2yr)',
  '006-006106': 'exoplan Renewal (3yr)',
};

// 품목코드로 품명 조회 (없으면 빈 문자열)
function getProductNameByCode(code: string): string {
  return CODE_TO_PRODUCT_NAME[code.trim()] || '';
}

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

// 폴링 행의 LOT + 納品先(납품처) 정보를 memo 형식으로 구성
function buildDeliveryMemo(row: Record<string, string>): string {
  const parts: string[] = [];
  if (row.lot) parts.push(`LOT: ${row.lot}`);
  if (row.delivery_to) parts.push(`納品先: ${row.delivery_to}`);
  return parts.length > 0 ? ` (${parts.join(', ')})` : '';
}

// 폴링 행에서 메모 문자열 생성 (납품처 + LOT 포함)
function buildRowMemo(
  row: Record<string, string>,
  sourceName: string,
  code: string,
  today: string,
): string {
  const parts: string[] = [`자동수집: ${sourceName}`];
  if (code) parts.push(`상품코드: ${code}`);
  if (row.invoice_no) parts.push(`출고번호: ${row.invoice_no}`);
  if (row.lot) parts.push(`LOT: ${row.lot}`);
  if (row.delivery_to) parts.push(`納品先: ${row.delivery_to}`);
  return parts.join(' / ');
}

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

export function updatePendingOrder(id: number, data: Partial<PendingOrder>): PendingOrder | undefined {
  const db = getDb();
  const fields: string[] = [];
  const values: any[] = [];

  const allowed = [
    'serial_number', 'customer_name', 'customer_email', 'customer_address',
    'customer_phone', 'customer_manager', 'purchase_date', 'expiry_date',
    'engine_build', 'version', 'notes', 'order_type',
  ] as const;

  for (const key of allowed) {
    if (data[key] !== undefined) {
      fields.push(`${key} = ?`);
      values.push(data[key]);
    }
  }
  if (fields.length === 0) return db.prepare('SELECT * FROM pending_orders WHERE id = ?').get(id) as PendingOrder;

  values.push(id);
  db.prepare(`UPDATE pending_orders SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return db.prepare('SELECT * FROM pending_orders WHERE id = ?').get(id) as PendingOrder;
}

export function approvePendingOrder(id: number): { success: boolean; error?: string } {
  const db = getDb();
  const order = db.prepare('SELECT * FROM pending_orders WHERE id = ?').get(id) as PendingOrder | undefined;
  if (!order) return { success: false, error: '주문을 찾을 수 없습니다.' };

  try {
    const today = new Date().toISOString().slice(0, 10);
    const oneYearLater = new Date();
    oneYearLater.setFullYear(oneYearLater.getFullYear() + 1);

    // ── 카테고리 A: 신규 등록
    if (order.order_type === 'new') {
      const existing = serialService.getBySerialNumber(order.serial_number);
      if (existing) {
        // 이미 존재 → 품명(product)만 업데이트 (중복 플래그 코드가 있어도 신규로 인식)
        if (order.version && !existing.version) {
          serialService.update(existing.id, { version: order.version });
        }
        logger.info(`신규 승인 (중복 serial, 품명만 업데이트): ${order.serial_number}`);
      } else {
        const input: SerialInput = {
          serial_number: order.serial_number || `IMPORT-${Date.now()}`,
          customer_name: order.customer_name,
          customer_email: order.customer_email,
          customer_address: order.customer_address,
          customer_phone: order.customer_phone,
          customer_manager: order.customer_manager,
          purchase_date: order.purchase_date || today,
          expiry_date: order.expiry_date || oneYearLater.toISOString().slice(0, 10),
          engine_build: order.engine_build,
          version: order.version,
          notes: order.notes,
        };
        serialService.create(input);
      }

    // ── 카테고리 C: 갱신 — 기존 Expiry Date +1년
    } else if (order.order_type === 'renewal') {
      const serial = serialService.getBySerialNumber(order.serial_number);
      if (!serial) return { success: false, error: `시리얼 ${order.serial_number}을 찾을 수 없습니다.` };

      // Expiry Date: 이미 등록된 시리얼의 expiry_date + 1년
      const baseExpiry = serial.expiry_date ? new Date(serial.expiry_date) : new Date();
      baseExpiry.setFullYear(baseExpiry.getFullYear() + 1);
      const newExpiry = baseExpiry.toISOString().slice(0, 10);

      const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
      // note 란에 갱신 품명 + 날짜 기록
      const renewalProductName = (() => {
        try {
          const raw = JSON.parse(order.raw_data || '{}');
          return raw._renewal_product || order.product_code || '';
        } catch { return order.product_code || ''; }
      })();
      const renewNote = `[${today}] 갱신: ${renewalProductName}`;
      const updatedNotes = serial.notes ? `${serial.notes}\n${renewNote}` : renewNote;

      db.prepare("UPDATE serials SET expiry_date = ?, status = 'active', notes = ?, updated_at = ? WHERE id = ?")
        .run(newExpiry, updatedNotes, now, serial.id);
      logger.info(`갱신 승인: ${order.serial_number} expiry ${serial.expiry_date} → ${newExpiry}`);

    // ── 카테고리 B: Add-on 추가
    } else if (order.order_type === 'addon') {
      const serial = serialService.getBySerialNumber(order.serial_number);

      // add-on 품명 추출
      const addonProductName = (() => {
        try {
          const raw = JSON.parse(order.raw_data || '{}');
          return raw._addon_name || order.product_code || '';
        } catch { return order.product_code || ''; }
      })();

      if (serial) {
        // 기존 시리얼에 add-on 추가 (expiry 변경 없음)
        const existingAddOns: any[] = (() => {
          try { return JSON.parse(serial.add_ons || '[]'); } catch { return []; }
        })();
        const alreadyAdded = existingAddOns.some((a: any) => a.name === addonProductName);
        if (!alreadyAdded) {
          existingAddOns.push({ name: addonProductName, added_date: today });
          serialService.update(serial.id, { add_ons: JSON.stringify(existingAddOns) } as any);
          logger.info(`Add-on 승인: ${order.serial_number} + ${addonProductName}`);
        } else {
          logger.info(`Add-on 이미 존재 (skip): ${order.serial_number} / ${addonProductName}`);
        }
      } else {
        // 시리얼 없으면 신규 생성 + add-on
        const newAddOns = [{ name: addonProductName, added_date: today }];
        serialService.create({
          serial_number: order.serial_number,
          customer_name: order.customer_name,
          customer_email: order.customer_email || '',
          customer_phone: order.customer_phone || '',
          purchase_date: order.purchase_date || today,
          expiry_date: '',
          notes: order.notes,
          add_ons: newAddOns,
        });
        logger.info(`Add-on 신규 등록: ${order.serial_number} + ${addonProductName}`);
      }
    }

    db.prepare("UPDATE pending_orders SET status = 'approved' WHERE id = ?").run(id);
    logger.info(`주문 승인 완료: pending_order #${id} (${order.serial_number})`);
    return { success: true };
  } catch (err: any) {
    logger.error(`주문 승인 오류: ${err.message}`);
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
function isAlreadyFetched(sourceId: string): boolean {
  const db = getDb();
  const row = db.prepare(
    'SELECT COUNT(*) as cnt FROM pending_orders WHERE source_id = ?'
  ).get(sourceId) as { cnt: number };
  return row.cnt > 0;
}

function insertPendingOrder(
  data: Omit<PendingOrder, 'id' | 'created_at'>,
): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO pending_orders
      (source_id, source_url, serial_number, customer_name, customer_email,
       customer_address, customer_phone, customer_manager, purchase_date,
       expiry_date, engine_build, version, notes, order_type, raw_data, status,
       product_code, flag_duplicate)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',?,?)
  `).run(
    data.source_id, data.source_url, data.serial_number, data.customer_name,
    data.customer_email, data.customer_address, data.customer_phone,
    data.customer_manager, data.purchase_date, data.expiry_date,
    data.engine_build, data.version, data.notes, data.order_type, data.raw_data,
    data.product_code ?? '', data.flag_duplicate ?? 0,
  );
}

// ────────────────────────────────────────────────────────────
// Playwright 크롤링 핵심 로직
// ────────────────────────────────────────────────────────────
async function crawlSource(source: PollSource): Promise<{ found: number; errors: string[] }> {
  const errors: string[] = [];
  let found = 0;
  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({ headless: true });
    const context: BrowserContext = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    });
    const page = await context.newPage();

    // ── 로그인 처리 ──────────────────────────────────────
    if (source.login_url && source.login_id) {
      await page.goto(source.login_url, { waitUntil: 'domcontentloaded', timeout: 30000 });

      // geomedi.online 특정 로그인 처리
      if (source.login_url.includes('geomedi.online')) {
        const idField = page.locator('input[name="admin_id"]');
        const pwField = page.locator('input[name="admin_pw"]');

        // 현재 입력값 확인 → 값이 없는 곳에만 입력
        const currentId = await idField.inputValue().catch(() => '');
        const currentPw = await pwField.inputValue().catch(() => '');

        if (!currentId) await idField.fill(source.login_id);
        if (!currentPw) await pwField.fill(source.login_pw);

        // 로그인 버튼 클릭 (btn_login 클래스 우선, fallback: btn_black)
        await page.locator('button.btn_login, input[src*="btn_login"], button.btn_black').first().click();
      } else {
        // 공통 로그인 폼 패턴 시도 (id/email 필드 + password 필드)
        const idSelectors = ['input[type="email"]', 'input[name="id"]', 'input[name="username"]', 'input[name="user_id"]', '#id', '#username'];
        const pwSelectors = ['input[type="password"]', 'input[name="password"]', 'input[name="pw"]', '#pw', '#password'];
        const btnSelectors = ['button[type="submit"]', 'input[type="submit"]', '.btn-login', '#loginBtn', 'button:has-text("로그인")', 'button:has-text("Login")'];

        for (const sel of idSelectors) {
          const el = page.locator(sel).first();
          if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
            await el.fill(source.login_id);
            break;
          }
        }
        for (const sel of pwSelectors) {
          const el = page.locator(sel).first();
          if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
            await el.fill(source.login_pw);
            break;
          }
        }
        for (const sel of btnSelectors) {
          const el = page.locator(sel).first();
          if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
            await el.click();
            break;
          }
        }
      }
      await page.waitForLoadState('domcontentloaded').catch(() => { });
      await page.waitForTimeout(2000);
    }

    // ── 주문 페이지 접속 ──────────────────────────────────
    await page.goto(source.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    // geomedi.online 특정 페이지 처리 (품목대분류 선택 → 날짜 선택 → 검색)
    if (source.url.includes('stock_serial.html')) {
      // 1) 품목대분류 드롭다운에서 CAD(value="0013") 선택 후 onchange 트리거
      const categorySelected = await page.evaluate(() => {
        const sel = document.querySelector('select[name="s_h_code_fk"]') as HTMLSelectElement | null;
        if (!sel) return false;
        sel.value = '0013';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        // onchange 핸들러(sub_dir10)가 있으면 직접 호출
        if (typeof (window as any).sub_dir10 === 'function') {
          (window as any).sub_dir10();
        }
        return true;
      });
      if (categorySelected) {
        logger.info(`[폴링] ${source.name}: 품목대분류 CAD(0013) 선택 완료`);
        await page.waitForTimeout(2000); // 분류 변경 후 페이지 반응 대기
      } else {
        logger.warn(`[폴링] ${source.name}: s_h_code_fk 드롭다운을 찾지 못했습니다.`);
      }

      // 2) 날짜 설정
      const today = new Date().toISOString().slice(0, 10);
      await page.evaluate((date) => {
        const dateInput = document.getElementById('s_date1') as HTMLInputElement;
        if (dateInput) {
          dateInput.readOnly = false;
          dateInput.value = date;
          dateInput.dispatchEvent(new Event('input', { bubbles: true }));
          dateInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, today);

      // 3) 검색 버튼 클릭
      const searchBtn = page.locator('button:has-text("検索"), button.btn_black').first();
      if (await searchBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await searchBtn.click();
      }
      await page.waitForTimeout(2500);
    }

    // ── 전체 페이지 수집 (페이지네이션 루프) ─────────────
    const MIN_DATA_COLS = 5;
    const FIELD_MAP = {
      // 시리얼 번号 (シリアル番号) 기준
      serial: source.field_serial || 'シリアル番号',
      serial_alt: 'LOT',
      // 고객명 (注文先 = Customer Name)
      customer: source.field_customer || '注文先',
      phone: source.field_phone || '',
      // 구매일 = 出荷日 (출고일 = purchase date)
      purchase: source.field_purchase || '出荷日',
      // 입하일 (入荷日) — 보조 날짜
      incoming: '入荷日',
      // 납품처 (納品先) — memo 용도
      delivery_to: '納品先',
      // LOT — memo 용도
      lot: 'LOT',
      invoice_no: '出荷伝票',
      // 商品コード — 카테고리 분류 기준
      item_code: '商品コード',
      // 品名 — fallback 품명
      product: source.field_product || '品名',
    };

    // 현재 페이지 테이블 파싱 함수 (page.evaluate 래퍼)
    const parseCurrentPage = async (): Promise<Record<string, string>[]> => {
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
      }, { fieldMap: FIELD_MAP, minCols: MIN_DATA_COLS });

      // serial_alt fallback
      for (const r of rows) { if (!r.serial && r.serial_alt) r.serial = r.serial_alt; }
      return rows;
    };

    // 페이지 URL 패턴을 기억해 직접 URL 구성
    let pageUrlTemplate: string | null = null; // e.g. ?...&page_num=PAGE

    const navigateToPage = async (targetNum: number): Promise<boolean> => {
      // 1) 페이지 생성 URL 패턴이 이미 말혀인 경우 직접 구성
      if (pageUrlTemplate) {
        const targetUrl = pageUrlTemplate.replace('__PAGE__', String(targetNum));
        logger.info(`[폴링] ${source.name}: 페이지 ${targetNum} URL 패턴 이동 → ${targetUrl.slice(0, 80)}`);
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForTimeout(1500);
        return true;
      }

      // 2) 텍스트로 페이지 번호에 해당하는 <a href> 찾았는 경우
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
        // URL에서 페이지 번호 파라미터 패턴 추출
        if (!pageUrlTemplate) {
          const patterns = [
            /(.*[?&]page_num=)\d+(&.*|$)/i,
            /(.*[?&]page=)\d+(&.*|$)/i,
            /(.*[?&]p=)\d+(&.*|$)/i,
            /(.*[?&]pg=)\d+(&.*|$)/i,
            /(.*[?&]current_page=)\d+(&.*|$)/i,
          ];
          for (const pat of patterns) {
            const m = href.match(pat);
            if (m) {
              pageUrlTemplate = m[1] + '__PAGE__' + m[2];
              logger.info(`[폴링] 페이지 URL 패턴 발견: ${pageUrlTemplate.slice(0, 80)}`);
              break;
            }
          }
        }
        logger.info(`[폴링] ${source.name}: 페이지 ${targetNum} 이동 → ${href.slice(0, 80)}`);
        await page.goto(href, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForTimeout(1500);
        return true;
      }

      logger.info(`[폴링] ${source.name}: 페이지 ${targetNum} 링크 없음 — 수집 종료`);
      return false;
    };

    const tableData: Record<string, string>[] = [];
    const MAX_PAGES = 200;
    let currentPage = 1;

    while (currentPage <= MAX_PAGES) {
      const pgRows = await parseCurrentPage();
      if (pgRows.length > 0 || currentPage === 1) {
        if (pgRows.length > 0) tableData.push(...pgRows);
        logger.info(`[폴링] ${source.name}: 페이지 ${currentPage} → ${pgRows.length}행`);
      } else {
        break;
      }

      const ok = await navigateToPage(currentPage + 1);
      if (!ok) break;

      currentPage++;
    }

    logger.info(`[폴링] ${source.name}: 전체 ${tableData.length}행 수집`);


    // ── 결과를 대기 주문으로 저장 ─────────────────
    const settings = getSettings();
    const customRules: ProductCodeRule[] = settings.custom_product_code_rules || [];
    const today = new Date().toISOString().slice(0, 10);

    const filterKeyword = (source.product_filter || '').trim().toLowerCase();

    for (const row of tableData) {
      const code = (row.item_code || '').trim();
      const group = resolveGroup(code, customRules);

      // 미등록 코드 (group === null 및 ignore) — 기존 방식 폴백
      if (group === null || group === 'ignore') {
        if (group === 'ignore') continue;
        const productVal = getProductFallback(row);
        if (!matchesProductFilter(productVal, filterKeyword)) continue;
        const serial = (row.serial || '').trim();
        const sourceId = `${source.id}::${serial || row._raw?.slice(0, 40) || code}`;
        if (isAlreadyFetched(sourceId)) continue;
        insertPendingOrder({
          source_id: sourceId,
          source_url: source.url,
          serial_number: serial,
          customer_name: row.customer || '',
          customer_email: '',
          customer_address: '',
          customer_phone: row.phone || '',
          customer_manager: '',
          purchase_date: normalizeDate(row.purchase) || '',
          expiry_date: '',
          engine_build: '',
          version: productVal,
          notes: buildRowMemo(row, source.name, code, today),
          order_type: 'new',
          raw_data: row._raw || '',
          status: 'pending',
          product_code: code,
          flag_duplicate: 0,
        });
        found++;
        continue;
      }

      const serial = (row.serial || '').trim();
      if (!serial) continue; // 시리얼 없으면 처리 불가

      // ── 카테고리 A (main) : 신규 등록 → pending
      if (group === 'main') {
        const productName = getProductNameByCode(code) || getProductFallback(row);
        if (filterKeyword && !matchesProductFilter(productName, filterKeyword)) continue;
        const sourceId = `${source.id}::${serial}`;
        if (isAlreadyFetched(sourceId)) continue;
        const existingSerial = serialService.getBySerialNumber(serial);
        insertPendingOrder({
          source_id: sourceId,
          source_url: source.url,
          serial_number: serial,
          customer_name: row.customer || '',
          customer_email: '',
          customer_address: '',
          customer_phone: row.phone || '',
          customer_manager: '',
          purchase_date: normalizeDate(row.purchase) || '',
          expiry_date: '',
          engine_build: '',
          version: productName,
          notes: buildRowMemo(row, source.name, code, today),
          order_type: 'new',
          raw_data: row._raw || '',
          status: 'pending',
          product_code: code,
          flag_duplicate: existingSerial ? 1 : 0,
        });
        logger.info(`[폴링] 카테고리A 신규 pending: ${serial} (${productName})`);
        found++;
        continue;
      }

      // ── 카테고리 B (addon) : 기존 시리얼에 add-on 추가 → pending
      if (group === 'addon') {
        const productName = getProductNameByCode(code) || getProductFallback(row);
        const sourceId = `${source.id}::${serial}::${code}`;
        if (isAlreadyFetched(sourceId)) continue;
        insertPendingOrder({
          source_id: sourceId,
          source_url: source.url,
          serial_number: serial,
          customer_name: row.customer || '',
          customer_email: '',
          customer_address: '',
          customer_phone: row.phone || '',
          customer_manager: '',
          purchase_date: normalizeDate(row.purchase) || '',
          expiry_date: '', // add-on은 expiry 변경 없음
          engine_build: '',
          version: '',
          notes: buildRowMemo(row, source.name, code, today),
          order_type: 'addon',
          raw_data: JSON.stringify({ ...(JSON.parse(row._raw || '{}')), _addon_name: productName, _addon_code: code }),
          status: 'pending',
          product_code: code,
          flag_duplicate: 0,
        });
        logger.info(`[폴링] 카테고리B Add-on pending: ${serial} / ${productName}`);
        found++;
        continue;
      }

      // ── 카테고리 C (renewal) : 갱신 → pending (expiry +1년은 승인 시 처리)
      if (group === 'renewal') {
        const productName = getProductNameByCode(code) || getProductFallback(row);
        const sourceId = `${source.id}::${serial}::renewal::${code}`;
        if (isAlreadyFetched(sourceId)) continue;
        insertPendingOrder({
          source_id: sourceId,
          source_url: source.url,
          serial_number: serial,
          customer_name: row.customer || '',
          customer_email: '',
          customer_address: '',
          customer_phone: row.phone || '',
          customer_manager: '',
          purchase_date: normalizeDate(row.purchase) || '',
          expiry_date: '', // 승인 시 기존 expiry +1년으로 계산
          engine_build: '',
          version: '',
          notes: buildRowMemo(row, source.name, code, today),
          order_type: 'renewal',
          raw_data: JSON.stringify({ ...(JSON.parse(row._raw || '{}')), _renewal_product: productName }),
          status: 'pending',
          product_code: code,
          flag_duplicate: 0,
        });
        logger.info(`[폴링] 카테고리C 갱신 pending: ${serial} (${productName})`);
        found++;
        continue;
      }

      // ── 카테고리 D (memo) : DB 메모란에 기입만, 변경 없음 (즉시 처리)
      if (group === 'memo') {
        const productName = getProductNameByCode(code) || getProductFallback(row);
        const memoText = `[${today}] ${productName || code}${buildDeliveryMemo(row)}`;
        const existing = serialService.getBySerialNumber(serial);
        if (existing) {
          const newNotes = existing.notes ? `${existing.notes}\n${memoText}` : memoText;
          serialService.update(existing.id, { notes: newNotes });
          logger.info(`[폴링] 카테고리D 메모 추가: ${serial}`);
        } else {
          logger.info(`[폴링] 카테고리D 메모 대상 시리얼 없음 (skip): ${serial}`);
        }
        found++;
        continue;
      }
    }

    logger.info(`[폴링] ${source.name}: ${found}건 수집 완료`);
  } catch (err: any) {
    const msg = `[폴링] ${source.name} 오류: ${err.message}`;
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
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  } catch { /* ignore */ }
  return '';
}

// ────────────────────────────────────────────────────────────
// 폴링 스케줄러
// ────────────────────────────────────────────────────────────
export async function pollNow(sourceId?: string): Promise<{ found: number; errors: string[] }> {
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
      s.id === source.id ? { ...s, last_polled: new Date().toISOString() } : s
    );
    saveSettings({ poll_sources: updatedSources });
  }

  pollStatus.running = false;
  pollStatus.lastRun = new Date().toISOString();
  pollStatus.message = `마지막 폴링: ${totalFound}건 수집`;
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

    // 로그인
    if (source.login_url && source.login_id) {
      await page.goto(source.login_url, { waitUntil: 'domcontentloaded', timeout: 30000 });

      // geomedi.online 전용 로그인 처리 (값 있는 곳은 스킵, 없는 곳만 입력)
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

    // 주문 페이지 접속
    await page.goto(source.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    // geomedi.online 특정 페이지 처리 (품목대분류 선택 → 날짜 선택 → 검색) — dry-run도 동일하게 적용
    if (source.url.includes('stock_serial.html')) {
      // 1) 품목대분류 드롭다운에서 CAD(value="0013") 선택 후 onchange 트리거
      const categorySelectedDry = await page.evaluate(() => {
        const sel = document.querySelector('select[name="s_h_code_fk"]') as HTMLSelectElement | null;
        if (!sel) return false;
        sel.value = '0013';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        // onchange 핸들러(sub_dir10)가 있으면 직접 호출
        if (typeof (window as any).sub_dir10 === 'function') {
          (window as any).sub_dir10();
        }
        return true;
      });
      if (categorySelectedDry) {
        logger.info(`[Dry-Run] ${source.name}: 품목대분류 CAD(0013) 선택 완료`);
        await page.waitForTimeout(2000); // 분류 변경 후 페이지 반응 대기
      } else {
        logger.warn(`[Dry-Run] ${source.name}: s_h_code_fk 드롭다운을 찾지 못했습니다.`);
      }

      // 2) 날짜 설정
      const today = new Date().toISOString().slice(0, 10);
      await page.evaluate((date) => {
        const dateInput = document.getElementById('s_date1') as HTMLInputElement;
        if (dateInput) {
          dateInput.readOnly = false;
          dateInput.value = date;
          // React/Vue 등 프레임워크가 감지할 수 있도록 change 이벤트 발생
          dateInput.dispatchEvent(new Event('input', { bubbles: true }));
          dateInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, today);

      // 3) 검색 버튼 클릭
      const searchBtn = page.locator('button:has-text("検索"), button.btn_black, input[type="button"][value*="検索"]').first();
      if (await searchBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await searchBtn.click();
        await page.waitForTimeout(2000);
      }
    }

    // 테이블 파싱 — 전체 페이지 수집 (crawlSource와 동일한 루프)
    const MIN_COLS_DRY = 5;
    const FIELD_MAP_DRY = {
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

    const parsePageDry = async (): Promise<Record<string, string>[]> => {
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
      }, { fieldMap: FIELD_MAP_DRY, minCols: MIN_COLS_DRY });
      for (const r of rows) { if (!r.serial && r.serial_alt) r.serial = r.serial_alt; }
      return rows;
    };

    // 페이지 URL 패턴을 기억해 URL 구성 (Dry-Run 전용)
    let dryPageUrlTemplate: string | null = null;

    const navigateToPageDry = async (targetNum: number): Promise<boolean> => {
      // 1) URL 패턴 장억인 경우 직접 구성
      if (dryPageUrlTemplate) {
        const targetUrl = dryPageUrlTemplate.replace('__PAGE__', String(targetNum));
        logger.info(`[Dry-Run] ${source.name}: 페이지 ${targetNum} URL 패턴 이동 → ${targetUrl.slice(0, 80)}`);
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForTimeout(1500);
        return true;
      }

      // 2) 텍스트로 페이지 번호 <a href> 찾기
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
        // URL 패턴 추출
        if (!dryPageUrlTemplate) {
          const patterns = [
            /(.*[?&]page_num=)\d+(&.*|$)/i,
            /(.*[?&]page=)\d+(&.*|$)/i,
            /(.*[?&]p=)\d+(&.*|$)/i,
            /(.*[?&]pg=)\d+(&.*|$)/i,
            /(.*[?&]current_page=)\d+(&.*|$)/i,
          ];
          for (const pat of patterns) {
            const m = href.match(pat);
            if (m) {
              dryPageUrlTemplate = m[1] + '__PAGE__' + m[2];
              logger.info(`[Dry-Run] 페이지 URL 패턴 발견: ${dryPageUrlTemplate.slice(0, 80)}`);
              break;
            }
          }
        }
        logger.info(`[Dry-Run] ${source.name}: 페이지 ${targetNum} 이동 → ${href.slice(0, 80)}`);
        await page.goto(href, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForTimeout(1500);
        return true;
      }

      logger.info(`[Dry-Run] ${source.name}: 페이지 ${targetNum} 링크 없음 — 종료`);
      return false;
    };

    const tableData: Record<string, string>[] = [];
    const MAX_PAGES = 200;

    // 페이지 1 수집
    const firstRows = await parsePageDry();
    tableData.push(...firstRows);
    logger.info(`[Dry-Run] ${source.name}: 페이지 1 → ${firstRows.length}행`);

    // 2페이지부터 URL 이동으로 순수 탐색
    for (let pg = 2; pg <= MAX_PAGES; pg++) {
      const ok = await navigateToPageDry(pg);
      if (!ok) break;
      const pgRows = await parsePageDry();
      tableData.push(...pgRows);
      logger.info(`[Dry-Run] ${source.name}: 페이지 ${pg} → ${pgRows.length}행`);
      if (pgRows.length === 0) break;
    }


    // 결과 분류 (저장하지 않고 미리보기만)
    const filterKeyword = (source.product_filter || '').trim();
    logger.info(`[Dry-Run] ${source.name}: product_filter="${source.product_filter}" → filterKeyword="${filterKeyword}"`);

    for (const row of tableData) {
      const sourceId = `${source.id}::${row.serial || row._raw.slice(0, 40)}`;
      const alreadyExists = isAlreadyFetched(sourceId);

      const productVal = getProductFallback(row);
      const filteredOut = !matchesProductFilter(productVal, filterKeyword);

      // 쳋 5행에 대해 상세 로그 출력 (디버그용)
      if (result.rows.length < 5) {
        logger.info(`[Dry-Run] row[${result.rows.length}] serial="${row.serial}" product="${row.product}" productResolved="${productVal}" item_code="${row.item_code}" → filteredOut=${filteredOut}`);
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

    logger.info(`[Dry-Run Poll] ${source.name}: ${result.rows.length}행 발견, ${result.would_insert}건 신규, ${result.already_fetched}건 중복`);

  } catch (err: any) {
    const msg = `[Dry-Run Poll] ${source.name} 오류: ${err.message}`;
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
  const sources = (settings.poll_sources || []).filter(s => s.enabled);

  for (const source of sources) {
    // schedule_times(특정 시각) 기반 폴링만 지원 (UI의 '폴링 스케줄' 설정)
    if (source.schedule_times && source.schedule_times.length > 0) {
      const tasks: cron.ScheduledTask[] = [];
      for (const time of source.schedule_times) {
        // AM/PM 지원을 위한 파싱
        const clean = (time || '09:00').trim().toUpperCase();
        const isPM = clean.includes('PM');
        const isAM = clean.includes('AM');
        const timePart = clean.replace(/[AP]M/g, '').trim();
        const parts = timePart.split(':');
        
        let h = parseInt(parts[0], 10) || 0;
        const m = parts.length > 1 ? parseInt(parts[1], 10) || 0 : 0;
        
        if (isPM && h < 12) h += 12;
        else if (isAM && h === 12) h = 0;
        h = h % 24;

        const cronExpr = `${m} ${h} * * *`;
        const task = cron.schedule(cronExpr, async () => {
          logger.info(`[스케줄] ${source.name} 폴링 시작 (예약시간: ${time})`);
          await pollNow(source.id);
        }, { timezone: 'Asia/Seoul' });
        tasks.push(task);
        logger.info(`[스케줄] ${source.name} 등록 (예약시각: ${time})`);
      }
      cronTasks.set(source.id, tasks);
    } else {
      logger.info(`[스케줄] ${source.name} - 활성 상태이나 '폴링 스케줄'이 설정되지 않아 중단되었습니다.`);
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
