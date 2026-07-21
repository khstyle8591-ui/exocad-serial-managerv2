/**
 * serial-bulk-update.service.ts
 *
 * 엑셀 벌크 upsert (다운로드→편집→업로드).
 *
 * 안전 원리:
 *  - 매칭: 숨김 id → serial_number(대소문자 무시). 기존 시리얼의 serial_number 자체는 불변(에러).
 *  - 기존 행: 그 외 전체 필드 수정. 삭제는 절대 없음(엑셀에서 빠진 행은 그대로 둠).
 *  - 신규 행(빈 id): INSERT.
 *  - 포탈 연결 보존: 기존 시리얼의 customer_id·serial_number를 절대 바꾸지 않음.
 *    고객정보 수정 = 연결된 기존 customers 행을 제자리 UPDATE(updateCustomer, 재할당·신규생성 없음).
 *  - 변경 감지: export 시 심어둔 스냅샷과 비교해 "관리자가 실제로 고친 칸"만 반영.
 *    편집 창 동안 시스템이 같은 칸을 바꿨으면(스냅샷≠현재값) 충돌 → 건너뛰고 리포트.
 *  - 적용: 자동 백업 → 단일 트랜잭션(실패 시 전량 롤백).
 */

import path from 'path';
import { getDb, getDbPath } from '../database';
import { serialService } from './serial.service';
import { updateCustomer } from './customer.service';
import { normalizeExcelDate } from './excel.service';
import { logActivity } from './activity-log.service';
import { getNowTimestampString } from '../utils/date-utils';
import type {
  SerialInput, SerialWithCustomer, CustomerInput,
  ParsedBulkUpdate, BulkUpdatePreview, BulkRowResult, BulkFieldChange,
} from '../../shared/types';

// ── 필드 정의 ────────────────────────────────────────────────────────────────
// 엑셀 header → customers 테이블 컬럼(= CustomerInput 키와 동일)
const CUSTOMER_FIELD_TO_COLUMN = {
  customer_name: 'name',
  customer_email: 'email',
  customer_phone: 'phone',
  customer_address: 'address',
  dealer: 'dealer',
  customer_manager: 'sales_manager',
} as const;
type CustomerHeader = keyof typeof CUSTOMER_FIELD_TO_COLUMN;

// serials 테이블에서 수정 가능한 필드(header = 컬럼명). serial_number는 키(불변)라 제외.
const SERIAL_FIELD_HEADERS = [
  'purchase_date', 'expiry_date', 'status', 'engine_build', 'version',
  'main_product', 'modules', 'renewal_stop_requested', 'notes',
] as const;

const EDITABLE_HEADERS: string[] = [...Object.keys(CUSTOMER_FIELD_TO_COLUMN), ...SERIAL_FIELD_HEADERS];

// ── 정규화(canonical) — 업로드/스냅샷/현재값을 같은 기준으로 비교하기 위함 ─────────
const VALID_STATUSES = new Set(['active', 'cancelled', 'expired', 'not-activated', 'broken']);
const STATUS_ALIASES: Record<string, string> = {
  active: 'active', activated: 'active', valid: 'active',
  cancelled: 'cancelled', canceled: 'cancelled', cancel: 'cancelled',
  'opted out': 'cancelled', 'opt out': 'cancelled', optedout: 'cancelled', optout: 'cancelled',
  expired: 'expired', expire: 'expired',
  'not active': 'not-activated', notactive: 'not-activated', 'not activated': 'not-activated',
  'not-activated': 'not-activated', notactivated: 'not-activated', inactive: 'not-activated',
  broken: 'broken',
};
const STOP_TRUE = new Set(['1', 'true', 'y', 'yes', '예', '네', '중단', 'stop']);

function canonText(value: unknown): string {
  return String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
}
function canonDate(value: unknown): string {
  return normalizeExcelDate(value) ?? '';
}
function persistDate(value: unknown): string | null {
  return normalizeExcelDate(value);
}
function canonBool(value: unknown): string {
  return STOP_TRUE.has(String(value ?? '').trim().toLowerCase()) ? '1' : '0';
}
function canonStatus(value: unknown): string {
  const raw = String(value ?? '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!raw) return '';
  const compact = raw.replace(/[\s_-]+/g, '');
  return STATUS_ALIASES[raw] || STATUS_ALIASES[compact] || raw;
}
/** 유효한 표준 status 또는 null(인식 실패). */
function resolveStatus(value: unknown): string | null {
  const c = canonStatus(value);
  return VALID_STATUSES.has(c) ? c : null;
}
function parseModuleList(value: unknown): string[] {
  const raw = String(value ?? '').trim();
  if (!raw) return [];
  try {
    if (raw.startsWith('[')) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed
          .map((x: unknown) => (typeof x === 'string' ? x : (x as { name?: unknown })?.name))
          .filter(Boolean)
          .map(String);
      }
      return [];
    }
  } catch { /* fall through to CSV split */ }
  return raw.split(/[,/]/).map(s => s.trim()).filter(Boolean);
}
function canonModules(value: unknown): string {
  return parseModuleList(value).map(s => s.trim()).sort().join(',');
}
function modulesToJson(value: unknown): string {
  return JSON.stringify(parseModuleList(value));
}

function canonOf(header: string, value: unknown): string {
  if (header === 'purchase_date' || header === 'expiry_date') return canonDate(value);
  if (header === 'renewal_stop_requested') return canonBool(value);
  if (header === 'status') return canonStatus(value);
  if (header === 'modules') return canonModules(value);
  return canonText(value);
}

/** 현재 DB의 해당 필드 원본값. */
function liveRaw(serial: SerialWithCustomer, header: string): unknown {
  if (header in CUSTOMER_FIELD_TO_COLUMN) {
    const col = CUSTOMER_FIELD_TO_COLUMN[header as CustomerHeader];
    return (serial.customer as unknown as Record<string, unknown>)[col];
  }
  return (serial as unknown as Record<string, unknown>)[header];
}

/** serials 테이블에 저장할 실제 값. */
function persistSerialValue(header: string, value: unknown): unknown {
  if (header === 'purchase_date' || header === 'expiry_date') return persistDate(value);
  if (header === 'status') return resolveStatus(value);
  if (header === 'modules') return modulesToJson(value);
  if (header === 'renewal_stop_requested') return canonBool(value) === '1' ? 1 : 0;
  return canonText(value);
}

// ── 분류(classification) ────────────────────────────────────────────────────────
interface RowPlan {
  result: BulkRowResult;
  serialId?: number;
  serialUpdates: Record<string, unknown>;   // serials 컬럼 → 값
  customerId?: number;
  customerUpdates: Partial<CustomerInput>;   // customers 제자리 UPDATE 입력
  insertInput?: SerialInput;
}

function classify(parsed: ParsedBulkUpdate): { preview: BulkUpdatePreview; plans: RowPlan[] } {
  const plans: RowPlan[] = [];

  for (const row of parsed.rows) {
    const snUploaded = String(row.fields['serial_number'] ?? '').trim();
    const result: BulkRowResult = { rowNum: row.rowNum, serial_number: snUploaded, action: 'skip', changes: [] };
    const plan: RowPlan = { result, serialUpdates: {}, customerUpdates: {} };

    let serial: SerialWithCustomer | undefined;
    let snapRow: Record<string, unknown> | undefined;
    let hasSnap = false;

    if (row.id != null) {
      serial = serialService.getById(row.id);
      if (!serial) {
        result.action = 'error';
        result.error = `id=${row.id} 시리얼을 찾을 수 없음 (삭제되었을 수 있음)`;
        plans.push(plan); continue;
      }
      // serial_number 불변
      if (snUploaded && snUploaded.toLowerCase() !== serial.serial_number.toLowerCase()) {
        result.action = 'error';
        result.serial_number = serial.serial_number;
        result.error = `시리얼 번호는 변경 불가 (${serial.serial_number} → ${snUploaded})`;
        plans.push(plan); continue;
      }
      result.serial_number = serial.serial_number;
      snapRow = parsed.snapshot[row.id];
      hasSnap = parsed.hasSnapshot && !!snapRow;
      if (parsed.hasSnapshot && !snapRow) result.warning = '스냅샷에 없는 id — 현재값 기준 비교';
    } else {
      if (!snUploaded) {
        result.action = 'error';
        result.error = '시리얼 번호가 비어 있음';
        plans.push(plan); continue;
      }
      serial = serialService.getBySerialNumber(snUploaded);
      if (serial) {
        result.serial_number = serial.serial_number;
        result.warning = '스냅샷 없는 행 — 현재값과 다른 칸만 반영';
      }
    }

    // ── INSERT (신규 시리얼) ──
    if (!serial) {
      const statusRaw = row.fields['status'];
      const statusResolved = statusRaw != null && String(statusRaw).trim() !== ''
        ? resolveStatus(statusRaw) : 'active';
      if (statusResolved === null) {
        result.action = 'error'; result.error = `status 인식 실패: "${String(statusRaw)}"`;
        plans.push(plan); continue;
      }
      const badDate = (['purchase_date', 'expiry_date'] as const)
        .find(h => String(row.fields[h] ?? '').trim() !== '' && persistDate(row.fields[h]) === null);
      if (badDate) {
        result.action = 'error'; result.error = `${badDate} 날짜 인식 실패`;
        plans.push(plan); continue;
      }
      plan.insertInput = {
        serial_number: snUploaded,
        customer_name: canonText(row.fields['customer_name']) || '(Unknown)',
        customer_email: canonText(row.fields['customer_email']),
        customer_phone: canonText(row.fields['customer_phone']),
        customer_address: canonText(row.fields['customer_address']),
        dealer: canonText(row.fields['dealer']),
        customer_manager: canonText(row.fields['customer_manager']),
        purchase_date: persistDate(row.fields['purchase_date']) ?? undefined,
        expiry_date: persistDate(row.fields['expiry_date']) ?? undefined,
        status: statusResolved as SerialInput['status'],
        engine_build: canonText(row.fields['engine_build']),
        version: canonText(row.fields['version']),
        main_product: canonText(row.fields['main_product']),
        modules: parseModuleList(row.fields['modules']),
        renewal_stop_requested: canonBool(row.fields['renewal_stop_requested']) === '1',
        notes: canonText(row.fields['notes']),
      };
      result.action = 'insert';
      result.changes = EDITABLE_HEADERS
        .map<BulkFieldChange>(h => ({ field: h, from: '', to: canonOf(h, row.fields[h]), status: 'apply' }))
        .filter(ch => ch.to !== '');
      plans.push(plan); continue;
    }

    // ── UPDATE (기존 시리얼, 제자리) ──
    plan.serialId = serial.id;
    plan.customerId = serial.customer_id;
    let errored = false;

    for (const h of EDITABLE_HEADERS) {
      const up = row.fields[h];
      const cUp = canonOf(h, up);
      const cLive = canonOf(h, liveRaw(serial, h));

      if (hasSnap) {
        const cSnap = canonOf(h, snapRow![h]);
        if (cUp === cSnap) continue;              // 관리자가 안 고침
        if (cLive !== cSnap) {                     // 편집 창 중 시스템도 바꿈 → 충돌
          result.changes.push({ field: h, from: cLive, to: cUp, status: 'conflict' });
          continue;
        }
      } else {
        if (cUp === cLive) continue;               // 스냅샷 없음: 현재값과 같으면 무시
      }

      // 반영 후보 — 검증
      if (h === 'purchase_date' || h === 'expiry_date') {
        if (String(up ?? '').trim() !== '' && persistDate(up) === null) {
          result.action = 'error'; result.error = `${h} 날짜 인식 실패`; errored = true; break;
        }
      }
      if (h === 'status' && resolveStatus(up) === null) {
        result.action = 'error'; result.error = `status 인식 실패: "${String(up)}"`; errored = true; break;
      }

      result.changes.push({ field: h, from: cLive, to: cUp, status: 'apply' });
      if (h in CUSTOMER_FIELD_TO_COLUMN) {
        const key = CUSTOMER_FIELD_TO_COLUMN[h as CustomerHeader] as keyof CustomerInput;
        (plan.customerUpdates as Record<string, unknown>)[key] = canonText(up);
      } else {
        plan.serialUpdates[h] = persistSerialValue(h, up);
      }
    }

    if (errored) { plan.serialUpdates = {}; plan.customerUpdates = {}; plans.push(plan); continue; }

    const hasApply = result.changes.some(c => c.status === 'apply');
    const hasConflict = result.changes.some(c => c.status === 'conflict');
    result.action = (hasApply || hasConflict) ? 'update' : 'skip';
    plans.push(plan);
  }

  detectCustomerCollisions(plans);
  return { preview: buildPreview(parsed, plans), plans };
}

/** 같은 고객을 여러 행에서 서로 다르게 고친 경우 → 해당 칸 충돌 처리(반영 제외). */
function detectCustomerCollisions(plans: RowPlan[]): void {
  const byCustomer = new Map<number, RowPlan[]>();
  for (const p of plans) {
    if (p.result.action === 'update' && p.customerId != null && Object.keys(p.customerUpdates).length) {
      const arr = byCustomer.get(p.customerId) ?? [];
      arr.push(p);
      byCustomer.set(p.customerId, arr);
    }
  }

  const headerOfColumn = (col: string): string =>
    Object.entries(CUSTOMER_FIELD_TO_COLUMN).find(([, c]) => c === col)?.[0] ?? col;

  for (const group of byCustomer.values()) {
    if (group.length < 2) continue;
    const fieldValues = new Map<string, Set<string>>();
    for (const p of group) {
      for (const [key, val] of Object.entries(p.customerUpdates)) {
        const set = fieldValues.get(key) ?? new Set<string>();
        set.add(String(val ?? ''));
        fieldValues.set(key, set);
      }
    }
    const conflictKeys = [...fieldValues.entries()].filter(([, s]) => s.size > 1).map(([k]) => k);
    if (!conflictKeys.length) continue;

    for (const p of group) {
      for (const key of conflictKeys) {
        if (key in p.customerUpdates) {
          delete (p.customerUpdates as Record<string, unknown>)[key];
          const header = headerOfColumn(key);
          const ch = p.result.changes.find(c => c.field === header && c.status === 'apply');
          if (ch) ch.status = 'conflict';
        }
      }
      if (p.result.changes.length === 0) p.result.action = 'skip';
    }
  }
}

function buildPreview(parsed: ParsedBulkUpdate, plans: RowPlan[]): BulkUpdatePreview {
  const rows = plans.map(p => p.result);
  return {
    summary: {
      insert: rows.filter(r => r.action === 'insert').length,
      update: rows.filter(r => r.action === 'update').length,
      skip: rows.filter(r => r.action === 'skip').length,
      conflict: rows.filter(r => r.changes.some(c => c.status === 'conflict')).length,
      error: rows.filter(r => r.action === 'error').length,
      total: rows.length,
    },
    hasSnapshot: parsed.hasSnapshot,
    rows,
    committed: false,
  };
}

// ── 백업 ────────────────────────────────────────────────────────────────────────
async function backupDb(): Promise<string> {
  const src = getDbPath();
  const dir = path.dirname(src);
  const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const dest = path.join(dir, `exocad.before-bulk-update-${ts}.db`);
  await getDb().backup(dest);
  return dest;
}

// ── 공개 API ─────────────────────────────────────────────────────────────────────
/** dry-run: 쓰기 없이 반영 예정 내역만 계산. */
export function previewBulkUpdate(parsed: ParsedBulkUpdate): BulkUpdatePreview {
  return classify(parsed).preview;
}

/** 실제 반영: 백업 → 단일 트랜잭션. 반영 직전 현재 DB 기준으로 재분류(충돌 재검증). */
export async function applyBulkUpdate(parsed: ParsedBulkUpdate): Promise<BulkUpdatePreview> {
  const { preview, plans } = classify(parsed);
  const backupPath = await backupDb();
  const db = getDb();

  const tx = db.transaction(() => {
    const now = getNowTimestampString();
    for (const p of plans) {
      if (p.result.action === 'update') {
        const cols = Object.keys(p.serialUpdates);
        if (cols.length) {
          const setSql = [...cols.map(c => `${c} = ?`), 'updated_at = ?'].join(', ');
          const vals = [...cols.map(c => p.serialUpdates[c]), now, p.serialId];
          db.prepare(`UPDATE serials SET ${setSql} WHERE id = ?`).run(...vals);
        }
        if (p.customerId != null && Object.keys(p.customerUpdates).length) {
          updateCustomer(p.customerId, p.customerUpdates);  // 제자리 UPDATE (customer_id 불변)
        }
        logActivity({
          serial_id: p.serialId ?? null,
          action: 'bulk_imported',
          actor: 'manual',
          details: `벌크 업데이트: ${p.result.serial_number}`,
          diff: Object.fromEntries(
            p.result.changes.filter(c => c.status === 'apply').map(c => [c.field, [c.from, c.to]])
          ),
        });
      } else if (p.result.action === 'insert' && p.insertInput) {
        serialService.create(p.insertInput);  // findOrCreate 고객 + INSERT (자체 로깅)
      }
    }
  });
  tx();

  preview.committed = true;
  preview.backupPath = backupPath;
  return preview;
}
