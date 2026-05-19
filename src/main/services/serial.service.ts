import { getDb } from '../database';
import { getTodayDateString, getNowTimestampString } from '../utils/date-utils';
import { findOrCreateCustomer, getCustomerById, updateCustomer } from './customer.service';
import { logActivity as _logActivity, listLogs, getFailureLogs, getTodayLogs } from './activity-log.service';
import type {
  Serial, SerialWithCustomer, SerialInput, AddOn, ActivityLog,
  LogFilter, StatsCountsResult, StatsSeries,
} from '../../shared/types';

// ── Internal helpers ───────────────────────────────────────────────────────────

const SERIAL_WITH_CUSTOMER_SQL = `
  SELECT s.*,
    json_object(
      'id', c.id, 'name', c.name, 'email', c.email, 'phone', c.phone,
      'address', c.address, 'dealer', c.dealer, 'sales_manager', c.sales_manager,
      'notes', c.notes, 'created_at', c.created_at, 'updated_at', c.updated_at
    ) AS customer_json
  FROM serials s
  JOIN customers c ON c.id = s.customer_id
`;

function parseSerialRow(row: any): SerialWithCustomer {
  const { customer_json, ...rest } = row;
  return { ...rest, customer: JSON.parse(customer_json) };
}

function syncExpiredStatus(): void {
  const db = getDb();
  const today = getTodayDateString();
  const now = getNowTimestampString();
  db.prepare(
    "UPDATE serials SET status = 'expired', updated_at = ? WHERE expiry_date IS NOT NULL AND expiry_date != '' AND expiry_date < ? AND status = 'active'"
  ).run(now, today);
}

/**
 * Resolve customer_id from SerialInput.
 * - If customer_id provided: use directly.
 * - Else: auto-find-or-create from flat fields.
 */
function resolveCustomerId(input: SerialInput): number {
  if (input.customer_id != null) return input.customer_id;

  return findOrCreateCustomer({
    name: input.customer_name || '(Unknown)',
    email: input.customer_email,
    phone: input.customer_phone,
    address: input.customer_address,
    dealer: input.dealer,
    sales_manager: input.customer_manager,
  }).id;
}

/** Modules JSON serialization (accepts string[] or AddOn[] for compat). */
function toModulesJson(input: SerialInput): string {
  if (input.modules != null) return JSON.stringify(input.modules);
  if (input.add_ons != null) return JSON.stringify(input.add_ons.map((a: AddOn) => a.name));
  return '[]';
}

function toSqliteBoolean(value: boolean | number | undefined): number {
  return value === true || value === 1 ? 1 : 0;
}

// ── Read ───────────────────────────────────────────────────────────────────────

export class SerialService {
  /** 만료일 지난 active 시리얼을 일괄 expired로 변경. 스케줄러에서 호출. */
  syncExpired(): void {
    syncExpiredStatus();
  }

  getAll(): SerialWithCustomer[] {
    syncExpiredStatus();
    const rows = getDb()
      .prepare(`${SERIAL_WITH_CUSTOMER_SQL} ORDER BY s.expiry_date ASC`)
      .all() as any[];
    return rows.map(parseSerialRow);
  }

  getById(id: number): SerialWithCustomer | undefined {
    const row = getDb()
      .prepare(`${SERIAL_WITH_CUSTOMER_SQL} WHERE s.id = ?`)
      .get(id) as any | undefined;
    return row ? parseSerialRow(row) : undefined;
  }

  getBySerialNumber(serialNumber: string): SerialWithCustomer | undefined {
    const row = getDb()
      .prepare(`${SERIAL_WITH_CUSTOMER_SQL} WHERE LOWER(s.serial_number) = LOWER(?)`)
      .get(serialNumber) as any | undefined;
    return row ? parseSerialRow(row) : undefined;
  }

  search(query: string): SerialWithCustomer[] {
    const like = `%${query}%`;
    const rows = getDb()
      .prepare(
        `${SERIAL_WITH_CUSTOMER_SQL}
         WHERE s.serial_number LIKE ?
            OR c.name LIKE ?
            OR c.email LIKE ?
            OR c.phone LIKE ?
            OR c.sales_manager LIKE ?
            OR s.notes LIKE ?
         ORDER BY s.expiry_date ASC`
      )
      .all(like, like, like, like, like, like) as any[];
    return rows.map(parseSerialRow);
  }

  // ── Write ──────────────────────────────────────────────────────────────────

  create(input: SerialInput): SerialWithCustomer {
    const db = getDb();
    const customer_id = resolveCustomerId(input);
    const now = getNowTimestampString();
    const modulesJson = toModulesJson(input);
    const stopRequested = toSqliteBoolean(input.renewal_stop_requested);

    const result = db
      .prepare(
        `INSERT INTO serials
          (serial_number, customer_id, purchase_date, expiry_date, status,
           engine_build, version, main_product, modules, notes, renewal_stop_requested,
           stop_requested_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.serial_number,
        customer_id,
        input.purchase_date || null,
        input.expiry_date || null,
        input.status || 'not-activated',
        input.engine_build || '',
        input.version || '',
        input.main_product || '',
        modulesJson,
        input.notes || '',
        stopRequested,
        stopRequested ? now : null,
        now,
        now
      );

    this.logActivity(result.lastInsertRowid as number, 'registered', 'manual',
      {}, `Serial registered: ${input.serial_number}`);
    return this.getById(result.lastInsertRowid as number)!;
  }

  update(id: number, input: Partial<SerialInput>): SerialWithCustomer | undefined {
    const db = getDb();
    const existing = this.getById(id);
    if (!existing) return undefined;

    let currentCustomerId = existing.customer_id;

    // Update customer flat fields if provided (backward compat with order.service).
    // If the incoming customer name differs, move only this serial to the resolved
    // customer instead of overwriting the previously linked customer record.
    if (
      input.customer_name !== undefined ||
      input.customer_email !== undefined ||
      input.customer_phone !== undefined ||
      input.customer_address !== undefined ||
      input.customer_manager !== undefined ||
      input.dealer !== undefined
    ) {
      const incomingName = input.customer_name?.trim();
      const existingName = existing.customer.name?.trim() ?? '';
      const shouldResolveDifferentCustomer = !!incomingName && incomingName !== existingName;

      if (input.customer_id != null) {
        currentCustomerId = input.customer_id;
      } else if (shouldResolveDifferentCustomer) {
        currentCustomerId = findOrCreateCustomer({
          name: incomingName,
          email: input.customer_email,
          phone: input.customer_phone,
          address: input.customer_address,
          sales_manager: input.customer_manager,
          dealer: input.dealer,
        }).id;
      }

      if (currentCustomerId !== existing.customer_id) {
        db.prepare('UPDATE serials SET customer_id = ?, updated_at = ? WHERE id = ?')
          .run(currentCustomerId, getNowTimestampString(), id);
      }

      updateCustomer(currentCustomerId, {
        name: input.customer_name,
        email: input.customer_email,
        phone: input.customer_phone,
        address: input.customer_address,
        sales_manager: input.customer_manager,
        dealer: input.dealer,
      });
    }

    // Update serial FK to a different customer if customer_id provided
    if (input.customer_id != null && input.customer_id !== currentCustomerId) {
      db.prepare('UPDATE serials SET customer_id = ?, updated_at = ? WHERE id = ?')
        .run(input.customer_id, getNowTimestampString(), id);
    }

    const fields: string[] = [];
    const values: unknown[] = [];

    if (input.serial_number !== undefined && input.serial_number !== existing.serial_number) {
      const conflict = db.prepare('SELECT id FROM serials WHERE LOWER(serial_number) = LOWER(?) AND id != ?')
        .get(input.serial_number, id);
      if (conflict) throw new Error(`시리얼 번호 '${input.serial_number}'는 이미 사용 중입니다.`);
      fields.push('serial_number = ?'); values.push(input.serial_number);
    }
    if (input.purchase_date !== undefined) { fields.push('purchase_date = ?'); values.push(input.purchase_date || null); }
    if (input.expiry_date !== undefined) { fields.push('expiry_date = ?'); values.push(input.expiry_date || null); }
    if (input.engine_build !== undefined) { fields.push('engine_build = ?'); values.push(input.engine_build); }
    if (input.version !== undefined) { fields.push('version = ?'); values.push(input.version); }
    if (input.main_product !== undefined) { fields.push('main_product = ?'); values.push(input.main_product); }
    if (input.modules !== undefined) { fields.push('modules = ?'); values.push(JSON.stringify(input.modules)); }
    else if (input.add_ons !== undefined) { fields.push('modules = ?'); values.push(JSON.stringify(input.add_ons.map((a: AddOn) => a.name))); }
    if (input.notes !== undefined) { fields.push('notes = ?'); values.push(input.notes); }
    if (input.status !== undefined) { fields.push('status = ?'); values.push(input.status); }
    if (input.renewal_stop_requested !== undefined) {
      const nextStop = toSqliteBoolean(input.renewal_stop_requested);
      fields.push('renewal_stop_requested = ?'); values.push(nextStop);
      fields.push('stop_requested_at = ?'); values.push(nextStop ? getNowTimestampString() : null);
    }

    if (fields.length > 0) {
      fields.push('updated_at = ?');
      values.push(getNowTimestampString());
      values.push(id);
      db.prepare(`UPDATE serials SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    }

    return this.getById(id);
  }

  delete(id: number): boolean {
    const result = getDb().prepare('DELETE FROM serials WHERE id = ?').run(id);
    return result.changes > 0;
  }

  // ── Domain operations ──────────────────────────────────────────────────────

  /** Not Activated → Active. purchase_date 유지, expiry_date = today + 1년. */
  activate(id: number): SerialWithCustomer | undefined {
    const db = getDb();
    const existing = this.getById(id);
    if (!existing || existing.status !== 'not-activated') return existing;

    const today = getTodayDateString();
    const expiry = new Date(today);
    expiry.setFullYear(expiry.getFullYear() + 1);
    const expiryStr = expiry.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
    const now = getNowTimestampString();

    // purchase_date 미래 날짜 보정
    let purchaseDate = existing.purchase_date;
    if (purchaseDate && purchaseDate > today) purchaseDate = today;

    db.prepare(
      "UPDATE serials SET status = 'active', expiry_date = ?, activated_at = ?, purchase_date = COALESCE(?, purchase_date), updated_at = ? WHERE id = ?"
    ).run(expiryStr, now, purchaseDate !== existing.purchase_date ? purchaseDate : null, now, id);

    this.logActivity(id, 'activated', 'manual',
      { status: ['not-activated', 'active'], expiry_date: [existing.expiry_date, expiryStr] },
      `Manual activation: expiry -> ${expiryStr}`);
    return this.getById(id);
  }

  /** renewal_stop_requested 플래그 설정/해제. 이미 같은 값이면 no-op. */
  setStopRequested(id: number, flag: boolean, trigger_id?: string): SerialWithCustomer | undefined {
    const db = getDb();
    const existing = this.getById(id);
    if (!existing) return undefined;

    const currentFlag = existing.renewal_stop_requested === 1;
    if (currentFlag === flag) return existing;   // idempotent

    const now = getNowTimestampString();
    if (flag) {
      db.prepare(
        'UPDATE serials SET renewal_stop_requested = 1, stop_requested_at = ?, updated_at = ? WHERE id = ?'
      ).run(now, now, id);
      this.logActivity(id, 'stop_requested', 'manual',
        { renewal_stop_requested: [0, 1] }, 'Renewal stop requested',
        trigger_id);
    } else {
      db.prepare(
        'UPDATE serials SET renewal_stop_requested = 0, stop_requested_at = NULL, updated_at = ? WHERE id = ?'
      ).run(now, id);
      this.logActivity(id, 'stop_cleared', 'manual',
        { renewal_stop_requested: [1, 0] }, 'Renewal stop request cleared');
    }
    return this.getById(id);
  }

  /** 수동 갱신: expiry +1년. */
  renewManual(id: number): SerialWithCustomer | undefined {
    return this._renew(id, 'manual');
  }

  /** renewSerial — backward compat alias (used by order.service.ts). */
  renewSerial(id: number, source: 'email' | 'manual' = 'manual'): SerialWithCustomer | undefined {
    return this._renew(id, source);
  }

  /**
   * 특정 만료일로 갱신 (폴링 자동 처리용).
   * clearStopFlag=true(기본) 시 renewal_stop_requested를 0으로 초기화.
   * stop_requested=1인 시리얼을 갱신할 때는 경고 로그를 남겨 운영자가 인지하도록 함.
   */
  renewSerialWithExpiry(
    id: number,
    newExpiry: string,
    source: ActivityLog['actor'] = 'polling',
    clearStopFlag = true,
  ): SerialWithCustomer | undefined {
    const db = getDb();
    const existing = this.getById(id);
    if (!existing) return undefined;
    const now = getNowTimestampString();

    if (clearStopFlag) {
      if (existing.renewal_stop_requested === 1) {
        // stop_requested=1인 시리얼을 갱신 처리함 — 운영자가 명시적으로 주문을 승인했으므로
        // stop flag를 초기화하지만, 경고 로그를 남겨 추후 감사 가능하게 함.
        console.warn(
          `[renewSerialWithExpiry] WARNING: serial_id=${id} (${existing.serial_number}) 은 ` +
          `renewal_stop_requested=1 상태였으나 ${source} 갱신으로 인해 초기화됩니다.`
        );
      }
      db.prepare("UPDATE serials SET expiry_date = ?, status = 'active', renewal_stop_requested = 0, stop_requested_at = NULL, updated_at = ? WHERE id = ?")
        .run(newExpiry, now, id);
    } else {
      db.prepare("UPDATE serials SET expiry_date = ?, status = 'active', updated_at = ? WHERE id = ?")
        .run(newExpiry, now, id);
    }

    const renewDiff: Record<string, unknown> = { expiry_date: [existing.expiry_date, newExpiry] };
    if (clearStopFlag && existing.renewal_stop_requested === 1) {
      renewDiff.renewal_stop_requested = [1, 0];
    }
    this.logActivity(id, 'renewed', source, renewDiff, `Expiry renewed: ${existing.expiry_date} -> ${newExpiry} (${source})`);
    return this.getById(id);
  }

  private _renew(id: number, actor: ActivityLog['actor']): SerialWithCustomer | undefined {
    const db = getDb();
    db.exec('BEGIN IMMEDIATE');
    try {
      const existing = this.getById(id);
      if (!existing) {
        db.exec('COMMIT');
        return undefined;
      }

      // 멱등성 보장: 오늘 이미 갱신된 기록이 있으면 skip
      const today = getTodayDateString();
      const alreadyRenewed = db
        .prepare(
          "SELECT id FROM activity_logs WHERE serial_id=? AND action='renewed' AND created_at>=? LIMIT 1"
        )
        .get(id, today);
      if (alreadyRenewed) {
        console.log(`[renew] skip — 오늘 이미 갱신됨: serial_id=${id}`);
        db.exec('COMMIT');
        return existing;
      }

      const base = existing.expiry_date ? new Date(existing.expiry_date) : new Date();
      if (isNaN(base.getTime())) {
        throw new Error(`갱신 실패: 잘못된 만료일 형식 "${existing.expiry_date}" (serial id=${id})`);
      }
      base.setFullYear(base.getFullYear() + 1);
      const newExpiry = base.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
      const now = getNowTimestampString();

      db.prepare("UPDATE serials SET expiry_date = ?, status = 'active', renewal_stop_requested = 0, stop_requested_at = NULL, updated_at = ? WHERE id = ?")
        .run(newExpiry, now, id);

      const renewDiff: Record<string, unknown> = { expiry_date: [existing.expiry_date, newExpiry] };
      if (existing.renewal_stop_requested) renewDiff.renewal_stop_requested = [1, 0];
      this.logActivity(id, 'renewed', actor, renewDiff, `Expiry renewed: ${existing.expiry_date} -> ${newExpiry}`);

      db.exec('COMMIT');
      return this.getById(id);
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch { /* ignore */ }
      throw err;
    }
  }

  /** DB-only cancel (no Playwright). */
  cancelManual(id: number): SerialWithCustomer | undefined {
    const db = getDb();
    const existing = this.getById(id);
    if (!existing) return undefined;
    const now = getNowTimestampString();
    db.prepare("UPDATE serials SET status = 'cancelled', updated_at = ? WHERE id = ?").run(now, id);
    this.logActivity(id, 'cancelled', 'manual',
      { status: [existing.status, 'cancelled'] }, 'DB-only cancellation');
    return this.getById(id);
  }

  /** Limbo fallback: mark as expired after repeated external cancel failure. */
  forceExpired(id: number, details: string, trigger_id?: string): SerialWithCustomer | undefined {
    const db = getDb();
    const existing = this.getById(id);
    if (!existing) return undefined;
    const now = getNowTimestampString();
    db.prepare("UPDATE serials SET status = 'expired', updated_at = ? WHERE id = ?").run(now, id);
    this.logActivity(
      id,
      'status_forced_expired',
      'auto',
      { status: [existing.status, 'expired'] },
      details,
      trigger_id,
      'critical'
    );
    return this.getById(id);
  }

  /** cancelSubscription — backward compat (used by cancel.service.ts callback). */
  cancelSubscription(id: number): SerialWithCustomer | undefined {
    return this.cancelManual(id);
  }

  // ── Module management ─────────────────────────────────────────────────────

  addAddon(id: number, addon: AddOn): SerialWithCustomer | undefined {
    const db = getDb();
    const existing = this.getById(id);
    if (!existing) return undefined;
    const modules: string[] = JSON.parse(existing.modules);
    if (!modules.includes(addon.name)) modules.push(addon.name);
    const now = getNowTimestampString();
    db.prepare('UPDATE serials SET modules = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(modules), now, id);
    this.logActivity(id, 'addon_added', 'manual', {}, `Module added: ${addon.name}`);
    return this.getById(id);
  }

  addModule(id: number, moduleName: string): SerialWithCustomer | undefined {
    return this.addAddon(id, { name: moduleName, added_date: getTodayDateString() });
  }

  removeModule(id: number, moduleName: string): SerialWithCustomer | undefined {
    const db = getDb();
    const existing = this.getById(id);
    if (!existing) return undefined;
    const modules: string[] = JSON.parse(existing.modules).filter((m: string) => m !== moduleName);
    const now = getNowTimestampString();
    db.prepare('UPDATE serials SET modules = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(modules), now, id);
    return this.getById(id);
  }

  // ── Expiry helpers (used by cancel.service, scheduler) ────────────────────

  getExpiringSerials(date: string): SerialWithCustomer[] {
    const rows = getDb()
      .prepare(`${SERIAL_WITH_CUSTOMER_SQL} WHERE s.expiry_date IS NOT NULL AND s.expiry_date != '' AND s.expiry_date <= ? AND s.status IN ('active','expired') ORDER BY s.expiry_date ASC`)
      .all(date) as any[];
    return rows.map(parseSerialRow);
  }

  getExpiringSerialsOnDate(date: string): SerialWithCustomer[] {
    const rows = getDb()
      .prepare(`${SERIAL_WITH_CUSTOMER_SQL} WHERE s.expiry_date = ? AND s.status = 'active'`)
      .all(date) as any[];
    return rows.map(parseSerialRow);
  }

  getExpiringInMonth(year: number, month: number): SerialWithCustomer[] {
    const start = `${year}-${String(month).padStart(2, '0')}-01`;
    const em = month === 12 ? 1 : month + 1;
    const ey = month === 12 ? year + 1 : year;
    const end = `${ey}-${String(em).padStart(2, '0')}-01`;
    const rows = getDb()
      .prepare(`${SERIAL_WITH_CUSTOMER_SQL} WHERE s.expiry_date IS NOT NULL AND s.expiry_date != '' AND s.expiry_date >= ? AND s.expiry_date < ? AND s.status = 'active' ORDER BY s.expiry_date ASC`)
      .all(start, end) as any[];
    return rows.map(parseSerialRow);
  }

  /** Returns true if the serial has renewal_stop_requested=1 (customer wants to CANCEL, not renew). */
  hasStopRequested(serialId: number): boolean {
    const row = getDb()
      .prepare('SELECT renewal_stop_requested FROM serials WHERE id = ?')
      .get(serialId) as { renewal_stop_requested: number } | undefined;
    return !!(row?.renewal_stop_requested);
  }

  /** @deprecated Use hasStopRequested(). Name was misleading — returns true when customer wants to CANCEL. */
  hasPendingRenewal(serialId: number): boolean {
    return this.hasStopRequested(serialId);
  }

  // ── Bulk import ────────────────────────────────────────────────────────────

  bulkImport(serials: SerialInput[]): { imported: number; errors: string[] } {
    const db = getDb();
    const errors: string[] = [];
    const importedIds: Array<{ id: number; serial_number: string }> = [];

    const transaction = db.transaction(() => {
      const now = getNowTimestampString();
      for (const s of serials) {
        try {
          const customerId = resolveCustomerId(s);
          const modulesJson = toModulesJson(s);
          const existing = db.prepare('SELECT id FROM serials WHERE serial_number = ?')
            .get(s.serial_number) as { id: number } | undefined;

          if (existing) {
            const fields = [
              'customer_id = ?', 'purchase_date = ?', 'expiry_date = ?',
              'engine_build = ?', 'version = ?', 'main_product = ?',
              'modules = ?', 'notes = ?',
            ];
            const values: unknown[] = [
              customerId, s.purchase_date || null, s.expiry_date || null,
              s.engine_build || '', s.version || '', s.main_product || '',
              modulesJson, s.notes || '',
            ];

            if (s.status !== undefined) {
              fields.push('status = ?');
              values.push(s.status);
            }

            if (s.renewal_stop_requested !== undefined) {
              const stopRequested = toSqliteBoolean(s.renewal_stop_requested);
              fields.push('renewal_stop_requested = ?', 'stop_requested_at = ?');
              values.push(stopRequested, stopRequested ? now : null);
            }

            fields.push('updated_at = ?');
            values.push(now, existing.id);
            db.prepare(`UPDATE serials SET ${fields.join(', ')} WHERE id = ?`).run(...values);
          } else {
            const stopRequested = toSqliteBoolean(s.renewal_stop_requested);
            db.prepare(
              `INSERT INTO serials
                (serial_number, customer_id, purchase_date, expiry_date, status,
                 engine_build, version, main_product, modules, notes, renewal_stop_requested,
                 stop_requested_at, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).run(
              s.serial_number, customerId,
              s.purchase_date || null, s.expiry_date || null,
              s.status || 'active',
              s.engine_build || '', s.version || '', s.main_product || '',
              modulesJson, s.notes || '', stopRequested,
              stopRequested ? now : null, now, now
            );
          }

          const row = db.prepare('SELECT id FROM serials WHERE serial_number = ?')
            .get(s.serial_number) as { id: number };
          if (row) importedIds.push({ id: row.id, serial_number: s.serial_number });
        } catch (err: any) {
          errors.push(`${s.serial_number}: ${err.message}`);
        }
      }
    });

    transaction();

    // logActivity는 트랜잭션 커밋 후 별도 실행 — upsert 성공/실패 결과와 독립
    for (const { id, serial_number } of importedIds) {
      this.logActivity(id, 'bulk_imported', 'manual', {}, `Bulk import: ${serial_number}`);
    }

    return { imported: importedIds.length, errors };
  }

  // ── Logging ────────────────────────────────────────────────────────────────

  /**
   * Delegate to activity-log.service (which also pushes logs:push to renderer).
   */
  logActivity(
    serialId: number | null,
    action: ActivityLog['action'],
    actor: ActivityLog['actor'],
    diff: Record<string, unknown> = {},
    details = '',
    trigger_id?: string,
    severity: ActivityLog['severity'] = 'info'
  ): void {
    try {
      _logActivity({ serial_id: serialId, action, actor, diff, details, trigger_id, severity });
    } catch (err: any) {
      // Log write failure must not crash the parent operation
      console.error(`[logActivity] DB write failed: ${err.message}`);
    }
  }

  // ── Log queries (delegate to activity-log.service) ─────────────────────────

  getLogs(limit = 100, offset = 0): ActivityLog[] {
    return listLogs({ limit, offset });
  }

  listLogs(filter: LogFilter = {}): ActivityLog[] {
    return listLogs(filter);
  }

  getTodayLogs(): ActivityLog[] {
    return getTodayLogs();
  }

  getLogsForDate(dateStr: string): ActivityLog[] {
    return listLogs({ date_from: dateStr, date_to: dateStr });
  }

  getFailureLogs(limit = 50): ActivityLog[] {
    return getFailureLogs(limit);
  }

  // ── Stats ──────────────────────────────────────────────────────────────────

  getStats(): StatsCountsResult & { total: number; notActivated: number; expiringThisMonth: number } {
    syncExpiredStatus();
    const db = getDb();
    const cnt = (sql: string, ...p: unknown[]): number =>
      (db.prepare(sql).get(...p) as { cnt: number }).cnt;

    const total = cnt('SELECT COUNT(*) as cnt FROM serials');
    const active = cnt("SELECT COUNT(*) as cnt FROM serials WHERE status = 'active'");
    const cancelled = cnt("SELECT COUNT(*) as cnt FROM serials WHERE status = 'cancelled'");
    const expired = cnt("SELECT COUNT(*) as cnt FROM serials WHERE status = 'expired'");
    const not_activated = cnt("SELECT COUNT(*) as cnt FROM serials WHERE status = 'not-activated'");
    const broken = cnt("SELECT COUNT(*) as cnt FROM serials WHERE status = 'broken'");

    const today = getTodayDateString();
    const endOfMonth = (() => {
      const d = new Date();
      return new Date(d.getFullYear(), d.getMonth() + 1, 0)
        .toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
    })();
    const expiringThisMonth = cnt(
      "SELECT COUNT(*) as cnt FROM serials WHERE expiry_date IS NOT NULL AND expiry_date != '' AND expiry_date >= ? AND expiry_date <= ? AND status = 'active'",
      today, endOfMonth
    );

    return { total, active, cancelled, expired, not_activated, broken, notActivated: not_activated, expiringThisMonth };
  }

  getStatsSeries(granularity: 'day' | 'month' | 'year', range: number = 30): StatsSeries {
    const db = getDb();
    const fmt = { day: '%Y-%m-%d', month: '%Y-%m', year: '%Y' }[granularity];

    const rows = db
      .prepare(
        `SELECT strftime(?, created_at) as label, action, COUNT(*) as cnt
         FROM activity_logs
         WHERE action IN ('registered','renewed','cancelled','addon_added')
           AND created_at >= date('now', 'localtime', ?)
         GROUP BY label, action
         ORDER BY label ASC`
      )
      .all(fmt, `-${range} ${granularity}s`) as Array<{ label: string; action: string; cnt: number }>;

    const map = new Map<string, { registered: number; renewed: number; cancelled: number; addon_added: number }>();
    for (const r of rows) {
      if (!map.has(r.label)) map.set(r.label, { registered: 0, renewed: 0, cancelled: 0, addon_added: 0 });
      const b = map.get(r.label)!;
      if (r.action === 'registered') b.registered += r.cnt;
      else if (r.action === 'renewed') b.renewed += r.cnt;
      else if (r.action === 'cancelled') b.cancelled += r.cnt;
      else if (r.action === 'addon_added') b.addon_added += r.cnt;
    }

    return {
      granularity,
      buckets: Array.from(map.entries()).map(([label, v]) => ({ label, ...v })),
    };
  }
}

export const serialService = new SerialService();
