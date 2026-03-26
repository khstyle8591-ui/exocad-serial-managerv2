import { getDb } from '../database';
import type { Serial, SerialInput, AddOn, ActivityLog } from '../../shared/types';

export class SerialService {
  getAll(): Serial[] {
    this.syncExpiredStatus();
    const db = getDb();
    return db.prepare('SELECT * FROM serials ORDER BY expiry_date ASC').all() as Serial[];
  }

  private syncExpiredStatus(): void {
    const db = getDb();
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
    const now = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' });
    db.prepare(
      "UPDATE serials SET status = 'expired', updated_at = ? " +
      "WHERE expiry_date < ? AND status = 'active'"
    ).run(now, today);
  }

  getById(id: number): Serial | undefined {
    this.syncExpiredStatus();
    const db = getDb();
    return db.prepare('SELECT * FROM serials WHERE id = ?').get(id) as Serial | undefined;
  }

  getBySerialNumber(serialNumber: string): Serial | undefined {
    const db = getDb();
    return db.prepare('SELECT * FROM serials WHERE serial_number = ?').get(serialNumber) as Serial | undefined;
  }

  search(query: string): Serial[] {
    this.syncExpiredStatus();
    const db = getDb();
    const like = `%${query}%`;
    return db.prepare(
      `SELECT * FROM serials
       WHERE serial_number LIKE ? OR customer_name LIKE ? OR customer_email LIKE ?
          OR customer_phone LIKE ? OR customer_manager LIKE ? OR notes LIKE ?
       ORDER BY expiry_date ASC`
    ).all(like, like, like, like, like, like) as Serial[];
  }

  create(input: SerialInput): Serial {
    const db = getDb();
    const addOnsJson = JSON.stringify(input.add_ons || []);
    const now = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' });

    const result = db.prepare(
      `INSERT INTO serials (serial_number, customer_name, customer_email, customer_address, customer_phone, customer_manager, purchase_date, expiry_date, status, engine_build, version, add_ons, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      input.serial_number,
      input.customer_name,
      input.customer_email,
      input.customer_address || '',
      input.customer_phone || '',
      input.customer_manager || '',
      input.purchase_date || null,
      input.expiry_date || null,
      input.status || 'active',
      input.engine_build || '',
      input.version || '',
      addOnsJson,
      input.notes || '',
      now,
      now
    );

    this.logActivity(result.lastInsertRowid as number, 'registered', `시리얼 ${input.serial_number} 등록`);
    return this.getById(result.lastInsertRowid as number)!;
  }

  update(id: number, input: Partial<SerialInput>): Serial | undefined {
    const db = getDb();
    const existing = this.getById(id);
    if (!existing) return undefined;

    const updates: string[] = [];
    const values: any[] = [];

    // serial_number: 기존 값과 다를 때만 업데이트 (동일하면 UNIQUE 충돌 방지를 위해 스킵)
    if (input.serial_number !== undefined && input.serial_number !== existing.serial_number) {
      // 다른 레코드가 동일 serial_number를 이미 사용하는지 확인
      const conflict = db.prepare('SELECT id FROM serials WHERE serial_number = ? AND id != ?').get(input.serial_number, id);
      if (conflict) {
        throw new Error(`시리얼 번호 '${input.serial_number}'는 이미 다른 레코드에서 사용 중입니다.`);
      }
      updates.push('serial_number = ?');
      values.push(input.serial_number);
    }
    if (input.customer_name !== undefined) { updates.push('customer_name = ?'); values.push(input.customer_name); }
    if (input.customer_email !== undefined) { updates.push('customer_email = ?'); values.push(input.customer_email); }
    if (input.customer_address !== undefined) { updates.push('customer_address = ?'); values.push(input.customer_address); }
    if (input.customer_phone !== undefined) { updates.push('customer_phone = ?'); values.push(input.customer_phone); }
    if (input.customer_manager !== undefined) { updates.push('customer_manager = ?'); values.push(input.customer_manager); }
    if (input.purchase_date !== undefined) { updates.push('purchase_date = ?'); values.push(input.purchase_date || null); }
    if (input.expiry_date !== undefined) { updates.push('expiry_date = ?'); values.push(input.expiry_date || null); }
    if (input.engine_build !== undefined) { updates.push('engine_build = ?'); values.push(input.engine_build); }
    if (input.version !== undefined) { updates.push('version = ?'); values.push(input.version); }
    if (input.add_ons !== undefined) { updates.push('add_ons = ?'); values.push(JSON.stringify(input.add_ons)); }
    if (input.notes !== undefined) { updates.push('notes = ?'); values.push(input.notes); }
    if (input.status !== undefined) { updates.push('status = ?'); values.push(input.status); }

    if (updates.length === 0) return existing;

    const now = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' });
    updates.push('updated_at = ?');
    values.push(now);
    values.push(id);

    db.prepare(`UPDATE serials SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    return this.getById(id);
  }

  delete(id: number): boolean {
    const db = getDb();
    const result = db.prepare('DELETE FROM serials WHERE id = ?').run(id);
    return result.changes > 0;
  }

  addAddon(id: number, addon: AddOn): Serial | undefined {
    const db = getDb();
    const existing = this.getById(id);
    if (!existing) return undefined;

    const addOns: AddOn[] = JSON.parse(existing.add_ons);
    addOns.push(addon);

    const now = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' });
    db.prepare('UPDATE serials SET add_ons = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(addOns), now, id);

    this.logActivity(id, 'addon_added', `Add-on 추가: ${addon.name}`);
    return this.getById(id);
  }

  removeAddon(id: number, addonName: string): Serial | undefined {
    const db = getDb();
    const existing = this.getById(id);
    if (!existing) return undefined;

    const addOns: AddOn[] = JSON.parse(existing.add_ons);
    const filtered = addOns.filter(a => a.name !== addonName);

    const now = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' });
    db.prepare('UPDATE serials SET add_ons = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(filtered), now, id);

    return this.getById(id);
  }

  renewSerial(id: number, source: 'email' | 'manual' = 'manual'): Serial | undefined {
    const db = getDb();
    const existing = this.getById(id);
    if (!existing) return undefined;

    const currentExpiry = existing.expiry_date ? new Date(existing.expiry_date) : new Date();
    const newExpiry = new Date(currentExpiry);
    newExpiry.setFullYear(newExpiry.getFullYear() + 1);
    const newExpiryStr = new Date(newExpiry).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });

    const now = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' });
    db.prepare('UPDATE serials SET expiry_date = ?, status = ?, updated_at = ? WHERE id = ?')
      .run(newExpiryStr, 'active', now, id);

    // 기존 미처리 갱신 요청을 모두 '처리 완료'로 마킹 → 아침 레포트에서 제외
    db.prepare(
      'UPDATE renewal_requests SET processed = 1 WHERE serial_id = ? AND processed = 0'
    ).run(id);

    // 새 갱신 이력 INSERT (processed=1: 이미 처리 완료 상태로 저장)
    db.prepare(
      'INSERT INTO renewal_requests (serial_id, request_date, request_source, processed) VALUES (?, ?, ?, 1)'
    ).run(id, now, source);

    this.logActivity(id, 'renewed', `만료일 갱신: ${existing.expiry_date} → ${newExpiryStr} (${source})`);
    return this.getById(id);
  }

  cancelSubscription(id: number): Serial | undefined {
    const db = getDb();
    const existing = this.getById(id);
    if (!existing) return undefined;

    const now = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' });
    db.prepare('UPDATE serials SET status = ?, updated_at = ? WHERE id = ?')
      .run('cancelled', now, id);

    this.logActivity(id, 'cancelled', `Subscription cancel 완료`);
    return this.getById(id);
  }

  getExpiringSerials(date: string): Serial[] {
    const db = getDb();
    return db.prepare(
      "SELECT * FROM serials WHERE expiry_date <= ? AND status IN ('active', 'expired') ORDER BY expiry_date ASC"
    ).all(date) as Serial[];
  }

  // 특정 날짜에 정확히 만료되는 active 시리얼 (자동 cancel용)
  getExpiringSerialsOnDate(date: string): Serial[] {
    const db = getDb();
    return db.prepare(
      "SELECT * FROM serials WHERE expiry_date = ? AND status = 'active'"
    ).all(date) as Serial[];
  }

  getExpiringInMonth(year: number, month: number): Serial[] {
    const db = getDb();
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const endMonth = month === 12 ? 1 : month + 1;
    const endYear = month === 12 ? year + 1 : year;
    const endDate = `${endYear}-${String(endMonth).padStart(2, '0')}-01`;

    return db.prepare(
      "SELECT * FROM serials WHERE expiry_date >= ? AND expiry_date < ? AND status = 'active' ORDER BY expiry_date ASC"
    ).all(startDate, endDate) as Serial[];
  }

  hasPendingRenewal(serialId: number): boolean {
    const db = getDb();
    const row = db.prepare(
      'SELECT COUNT(*) as cnt FROM renewal_requests WHERE serial_id = ? AND processed = 0'
    ).get(serialId) as { cnt: number };
    return row.cnt > 0;
  }

  bulkImport(serials: SerialInput[]): { imported: number; errors: string[] } {
    const db = getDb();
    const errors: string[] = [];
    let imported = 0;

    const upsertStmt = db.prepare(
      `INSERT INTO serials 
       (serial_number, customer_name, customer_email, customer_address, customer_phone, customer_manager, purchase_date, expiry_date, status, engine_build, version, add_ons, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(serial_number) DO UPDATE SET
         customer_name = excluded.customer_name,
         customer_email = excluded.customer_email,
         customer_address = excluded.customer_address,
         customer_phone = excluded.customer_phone,
         customer_manager = excluded.customer_manager,
         purchase_date = excluded.purchase_date,
         expiry_date = excluded.expiry_date,
         status = excluded.status,
         engine_build = excluded.engine_build,
         version = excluded.version,
         add_ons = excluded.add_ons,
         notes = excluded.notes,
         updated_at = excluded.updated_at`
    );

    const transaction = db.transaction(() => {
      const now = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' });
      for (const s of serials) {
        try {
          upsertStmt.run(
            s.serial_number,
            s.customer_name,
            s.customer_email,
            s.customer_address || '',
            s.customer_phone || '',
            s.customer_manager || '',
            s.purchase_date || null,
            s.expiry_date || null,
            s.status || 'active',
            s.engine_build || '',
            s.version || '',
            JSON.stringify(s.add_ons || []),
            s.notes || '',
            now, // created_at
            now  // updated_at
          );

          const row = db.prepare('SELECT id FROM serials WHERE serial_number = ?').get(s.serial_number) as { id: number };
          if (row) {
            this.logActivity(row.id, 'bulk_imported', `벌크 임포트/업데이트: ${s.serial_number}`);
            imported++;
          }
        } catch (err: any) {
          errors.push(`${s.serial_number}: ${err.message}`);
        }
      }
    });

    transaction();
    return { imported, errors };
  }

  private logActivity(serialId: number, action: string, details: string): void {
    const db = getDb();
    const now = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' });
    db.prepare(
      'INSERT INTO activity_logs (serial_id, action, details, created_at) VALUES (?, ?, ?, ?)'
    ).run(serialId, action, details, now);
  }

  getLogs(limit: number = 100, offset: number = 0): ActivityLog[] {
    const db = getDb();
    return db.prepare(
      'SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT ? OFFSET ?'
    ).all(limit, offset) as ActivityLog[];
  }

  getTodayLogs(): ActivityLog[] {
    const db = getDb();
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
    return this.getLogsForDate(today);
  }

  getLogsForDate(dateStr: string): ActivityLog[] {
    const db = getDb();
    return db.prepare(
      "SELECT * FROM activity_logs WHERE date(created_at) = ? ORDER BY created_at DESC"
    ).all(dateStr) as ActivityLog[];
  }

  getStats(): { total: number; active: number; cancelled: number; expired: number; notActivated: number; expiringThisMonth: number } {
    this.syncExpiredStatus();
    const db = getDb();
    const total = (db.prepare('SELECT COUNT(*) as cnt FROM serials').get() as any).cnt;
    const active = (db.prepare("SELECT COUNT(*) as cnt FROM serials WHERE status = 'active'").get() as any).cnt;
    const cancelled = (db.prepare("SELECT COUNT(*) as cnt FROM serials WHERE status = 'cancelled'").get() as any).cnt;
    const expired = (db.prepare("SELECT COUNT(*) as cnt FROM serials WHERE status = 'expired'").get() as any).cnt;
    const notActivated = (db.prepare("SELECT COUNT(*) as cnt FROM serials WHERE status = 'not-activated'").get() as any).cnt;

    const now = new Date();
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
    const today = now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
    const expiringThisMonth = (db.prepare(
      "SELECT COUNT(*) as cnt FROM serials WHERE expiry_date >= ? AND expiry_date <= ? AND status = 'active'"
    ).get(today, endOfMonth) as any).cnt;

    return { total, active, cancelled, expired, notActivated, expiringThisMonth };
  }
}

export const serialService = new SerialService();
