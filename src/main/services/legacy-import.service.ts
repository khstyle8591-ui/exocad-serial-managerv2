/**
 * legacy-import.service.ts
 *
 * 구 exocad-legacy.db 에 대한 읽기 전용 접근 + 선택적 이관 로직.
 * Phase 1: 감지 / 열기 / 목록 조회 기반 구현.
 * Phase 4: LegacyImportWizard UI 연동 및 importSerial() 완성.
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import { getDb, getLegacyDbPath } from '../database';
import { findMergeCandidates, createCustomer, getCustomerById } from './customer.service';
import { logActivity } from './activity-log.service';
import { getNowTimestampString } from '../utils/date-utils';
import type { MergeCandidate, LegacyImportInput, LegacyImportResult } from '../../shared/types';

// ── 타입 ──────────────────────────────────────────────────────────────────────

export interface LegacyDetectResult {
  available: boolean;
  path: string;
  serial_count: number;
  last_modified: string | null;
}

export interface LegacySerialRow {
  id: number;
  serial_number: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  customer_address: string;
  customer_manager: string;   // → customers.sales_manager
  purchase_date: string | null;
  expiry_date: string | null;
  status: string;
  engine_build: string;
  version: string;
  add_ons: string;            // JSON string[] → modules
  notes: string;
  created_at: string;
  updated_at: string;
  /** 구 renewal_requests 테이블에 이 serial_id로 미처리 요청이 있는지 */
  has_unprocessed_stop_request: boolean;
}

// ── 내부 헬퍼 ─────────────────────────────────────────────────────────────────

let legacyDb: Database.Database | null = null;

function openLegacy(): Database.Database {
  const p = getLegacyDbPath();
  if (!fs.existsSync(p)) {
    throw new Error(`Legacy DB not found: ${p}`);
  }
  if (!legacyDb || !legacyDb.open) {
    legacyDb = new Database(p, { readonly: true, fileMustExist: true });
  }
  return legacyDb;
}

export function closeLegacy(): void {
  if (legacyDb && legacyDb.open) {
    legacyDb.close();
    legacyDb = null;
  }
}

// ── 공개 API ──────────────────────────────────────────────────────────────────

/**
 * 레거시 DB 존재 여부와 기본 통계 반환.
 */
export function detectLegacy(): LegacyDetectResult {
  const p = getLegacyDbPath();
  if (!fs.existsSync(p)) {
    return { available: false, path: p, serial_count: 0, last_modified: null };
  }

  try {
    const ldb = openLegacy();
    const countRow = ldb
      .prepare('SELECT COUNT(*) as cnt FROM serials')
      .get() as { cnt: number };
    const stat = fs.statSync(p);
    return {
      available: true,
      path: p,
      serial_count: countRow.cnt,
      last_modified: stat.mtime.toISOString(),
    };
  } catch (e) {
    return { available: false, path: p, serial_count: 0, last_modified: null };
  }
}

/**
 * 레거시 serial 행 전체 목록 반환 (readonly).
 * filter.status 배열 지정 시 해당 상태만 반환.
 */
export function listLegacySerials(filter?: {
  status?: string[];
  limit?: number;
  offset?: number;
}): LegacySerialRow[] {
  const ldb = openLegacy();

  // renewal_requests 테이블 존재 여부 확인
  const hasRenewalTable = !!(
    ldb
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type='table' AND name='renewal_requests'"
      )
      .get()
  );

  let sql = `
    SELECT
      s.id, s.serial_number,
      s.customer_name, s.customer_email, s.customer_phone,
      s.customer_address, s.customer_manager,
      s.purchase_date, s.expiry_date, s.status,
      s.engine_build, s.version, s.add_ons, s.notes,
      s.created_at, s.updated_at
      ${
        hasRenewalTable
          ? `,
      CASE WHEN EXISTS(
        SELECT 1 FROM renewal_requests rr
        WHERE rr.serial_id = s.id AND rr.processed = 0
      ) THEN 1 ELSE 0 END AS has_unprocessed_stop_request`
          : ', 0 AS has_unprocessed_stop_request'
      }
    FROM serials s
  `;

  const params: (string | number)[] = [];
  if (filter?.status && filter.status.length > 0) {
    sql += ` WHERE s.status IN (${filter.status.map(() => '?').join(',')})`;
    params.push(...filter.status);
  }
  sql += ' ORDER BY s.id ASC';
  if (filter?.limit != null) {
    sql += ' LIMIT ?';
    params.push(filter.limit);
    if (filter.offset != null) {
      sql += ' OFFSET ?';
      params.push(filter.offset);
    }
  }

  const rows = ldb.prepare(sql).all(...params) as Array<
    Omit<LegacySerialRow, 'has_unprocessed_stop_request'> & {
      has_unprocessed_stop_request: 0 | 1;
    }
  >;

  return rows.map((r) => ({
    ...r,
    has_unprocessed_stop_request: r.has_unprocessed_stop_request === 1,
  }));
}

/**
 * 레거시 행에서 현재 DB 고객 병합 후보 제안.
 * ipc-handlers.ts에서 LEGACY_SUGGEST_MERGE에 사용.
 */
export function findMergeCandidatesForLegacy(legacyRow: {
  customer_name?: string;
  customer_email?: string;
  customer_phone?: string;
  dealer?: string;
}): MergeCandidate[] {
  return findMergeCandidates({
    name: legacyRow.customer_name,
    email: legacyRow.customer_email,
    phone: legacyRow.customer_phone,
    dealer: legacyRow.dealer,
  });
}

/**
 * 레거시 행을 현재 DB로 이관.
 * - customer 결정(기존 병합 or 신규 생성)
 * - serials 테이블 INSERT (이미 같은 serial_number 존재 시 에러 반환)
 * - activity_logs에 legacy_imported 기록
 */
export function importSerial(input: LegacyImportInput): LegacyImportResult {
  try {
    // 1. Read legacy row
    const ldb = openLegacy();
    const legacyRow = ldb
      .prepare('SELECT * FROM serials WHERE id = ?')
      .get(input.legacy_id) as LegacySerialRow | undefined;

    if (!legacyRow) {
      return { success: false, error: `레거시 행 id=${input.legacy_id} 를 찾을 수 없습니다.` };
    }

    // 2. Resolve customer_id
    let customerId: number;
    if (input.target_customer.kind === 'existing') {
      const existing = getCustomerById(input.target_customer.customer_id);
      if (!existing) {
        return { success: false, error: `고객 id=${input.target_customer.customer_id} 를 찾을 수 없습니다.` };
      }
      customerId = existing.id;
    } else {
      const newCustomer = createCustomer(input.target_customer.data);
      customerId = newCustomer.id;
    }

    // 3. Build serial fields (legacy → new schema mapping)
    const overrides = input.field_overrides ?? {};
    const modules: string[] = (() => {
      try {
        const raw = JSON.parse(legacyRow.add_ons || '[]');
        // Legacy add_ons may be string[] or {name,added_date}[]
        if (Array.isArray(raw)) {
          return raw.map((a: any) => (typeof a === 'string' ? a : a.name || String(a)));
        }
      } catch { /* ignore */ }
      return [];
    })();

    const status = input.status_override ?? (legacyRow.status as any) ?? 'not-activated';
    const now = getNowTimestampString();

    // 4. INSERT into new serials table (inside transaction)
    const db = getDb();
    const insertSerial = db.prepare(`
      INSERT INTO serials
        (serial_number, customer_id, purchase_date, expiry_date, status,
         engine_build, version, main_product, modules, notes,
         renewal_stop_requested, stop_requested_at, activated_at,
         created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);

    let serialId: number;

    db.transaction(() => {
      const result = insertSerial.run(
        overrides.serial_number ?? legacyRow.serial_number,
        customerId,
        overrides.purchase_date ?? legacyRow.purchase_date ?? null,
        overrides.expiry_date ?? legacyRow.expiry_date ?? null,
        status,
        overrides.engine_build ?? legacyRow.engine_build ?? '',
        overrides.version ?? legacyRow.version ?? '',
        overrides.main_product ?? '',
        JSON.stringify(overrides.modules ?? modules),
        overrides.notes ?? legacyRow.notes ?? '',
        input.set_stop_requested ? 1 : 0,
        input.set_stop_requested ? now : null,
        // activated_at: set if status is active/expired/cancelled
        ['active', 'expired', 'cancelled'].includes(status) ? (legacyRow.purchase_date ?? now) : null,
        legacyRow.created_at ?? now,
        now,
      );
      serialId = result.lastInsertRowid as number;
    })();

    // 5. Log
    logActivity({
      serial_id: serialId!,
      action: 'legacy_imported',
      actor: 'manual',
      diff: { legacy_id: [null, input.legacy_id] },
      details: `레거시 이관: serial=${legacyRow.serial_number}, legacy_id=${input.legacy_id}`,
      trigger_id: `legacy:${input.legacy_id}`,
      severity: 'info',
    });

    return { success: true, serial_id: serialId! };
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    // serial_number UNIQUE constraint
    if (msg.includes('UNIQUE constraint')) {
      return { success: false, error: '이미 동일한 시리얼 번호가 존재합니다.' };
    }
    return { success: false, error: msg };
  }
}
