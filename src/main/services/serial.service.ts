import { getDb } from '../database';
import type { Serial, SerialInput, AddOn, ActivityLog } from '../../shared/types';

export class SerialService {
  getAll(): Serial[] {
    const db = getDb();
    return db.prepare('SELECT * FROM serials ORDER BY expiry_date ASC').all() as Serial[];
  }

  getById(id: number): Serial | undefined {
    const db = getDb();
    return db.prepare('SELECT * FROM serials WHERE id = ?').get(id) as Serial | undefined;
  }

  getBySerialNumber(serialNumber: string): Serial | undefined {
    const db = getDb();
    return db.prepare('SELECT * FROM serials WHERE serial_number = ?').get(serialNumber) as Serial | undefined;
  }

  search(query: string): Serial[] {
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
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

    const result = db.prepare(
      `INSERT INTO serials (serial_number, customer_name, customer_email, customer_address, customer_phone, customer_manager, purchase_date, expiry_date, status, engine_build, version, add_ons, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)`
    ).run(
      input.serial_number,
      input.customer_name,
      input.customer_email,
      input.customer_address || '',
      input.customer_phone || '',
      input.customer_manager || '',
      input.purchase_date,
      input.expiry_date,
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

    if (input.serial_number !== undefined) { updates.push('serial_number = ?'); values.push(input.serial_number); }
    if (input.customer_name !== undefined) { updates.push('customer_name = ?'); values.push(input.customer_name); }
    if (input.customer_email !== undefined) { updates.push('customer_email = ?'); values.push(input.customer_email); }
    if (input.customer_address !== undefined) { updates.push('customer_address = ?'); values.push(input.customer_address); }
    if (input.customer_phone !== undefined) { updates.push('customer_phone = ?'); values.push(input.customer_phone); }
    if (input.customer_manager !== undefined) { updates.push('customer_manager = ?'); values.push(input.customer_manager); }
    if (input.purchase_date !== undefined) { updates.push('purchase_date = ?'); values.push(input.purchase_date); }
    if (input.expiry_date !== undefined) { updates.push('expiry_date = ?'); values.push(input.expiry_date); }
    if (input.engine_build !== undefined) { updates.push('engine_build = ?'); values.push(input.engine_build); }
    if (input.version !== undefined) { updates.push('version = ?'); values.push(input.version); }
    if (input.add_ons !== undefined) { updates.push('add_ons = ?'); values.push(JSON.stringify(input.add_ons)); }
    if (input.notes !== undefined) { updates.push('notes = ?'); values.push(input.notes); }

    if (updates.length === 0) return existing;

    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
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

    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
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

    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    db.prepare('UPDATE serials SET add_ons = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(filtered), now, id);

    return this.getById(id);
  }

  renewSerial(id: number, source: 'email' | 'manual' = 'manual'): Serial | undefined {
    const db = getDb();
    const existing = this.getById(id);
    if (!existing) return undefined;

    const currentExpiry = new Date(existing.expiry_date);
    const newExpiry = new Date(currentExpiry);
    newExpiry.setFullYear(newExpiry.getFullYear() + 1);
    const newExpiryStr = newExpiry.toISOString().slice(0, 10);

    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    db.prepare('UPDATE serials SET expiry_date = ?, status = ?, updated_at = ? WHERE id = ?')
      .run(newExpiryStr, 'active', now, id);

    db.prepare(
      'INSERT INTO renewal_requests (serial_id, request_date, request_source) VALUES (?, ?, ?)'
    ).run(id, now, source);

    this.logActivity(id, 'renewed', `만료일 갱신: ${existing.expiry_date} → ${newExpiryStr} (${source})`);
    return this.getById(id);
  }

  cancelSubscription(id: number): Serial | undefined {
    const db = getDb();
    const existing = this.getById(id);
    if (!existing) return undefined;

    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    db.prepare('UPDATE serials SET status = ?, updated_at = ? WHERE id = ?')
      .run('cancelled', now, id);

    this.logActivity(id, 'cancelled', `Subscription cancel 완료`);
    return this.getById(id);
  }

  getExpiringSerials(date: string): Serial[] {
    const db = getDb();
    return db.prepare(
      "SELECT * FROM serials WHERE expiry_date <= ? AND status = 'active' ORDER BY expiry_date ASC"
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

    // ON CONFLICT(serial_number) DO UPDATE SET ... 을 사용하여 덮어쓰기 구현
    const upsertStmt = db.prepare(
      `INSERT INTO serials 
       (serial_number, customer_name, customer_email, customer_address, customer_phone, customer_manager, purchase_date, expiry_date, status, engine_build, version, add_ons, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, datetime('now', 'localtime'), datetime('now', 'localtime'))
       ON CONFLICT(serial_number) DO UPDATE SET
         customer_name = excluded.customer_name,
         customer_email = excluded.customer_email,
         customer_address = excluded.customer_address,
         customer_phone = excluded.customer_phone,
         customer_manager = excluded.customer_manager,
         purchase_date = excluded.purchase_date,
         expiry_date = excluded.expiry_date,
         engine_build = excluded.engine_build,
         version = excluded.version,
         add_ons = excluded.add_ons,
         notes = excluded.notes,
         updated_at = datetime('now', 'localtime')`
    );

    const transaction = db.transaction(() => {
      for (const s of serials) {
        try {
          upsertStmt.run(
            s.serial_number,
            s.customer_name,
            s.customer_email,
            s.customer_address || '',
            s.customer_phone || '',
            s.customer_manager || '',
            s.purchase_date,
            s.expiry_date,
            s.engine_build || '',
            s.version || '',
            JSON.stringify(s.add_ons || []),
            s.notes || ''
          );

          // 실제 저장된 시리얼의 ID를 찾아 로그에 기록 (외래키 제약조건 위반 방지)
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
    db.prepare(
      'INSERT INTO activity_logs (serial_id, action, details) VALUES (?, ?, ?)'
    ).run(serialId, action, details);
  }

  getLogs(limit: number = 100, offset: number = 0): ActivityLog[] {
    const db = getDb();
    return db.prepare(
      'SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT ? OFFSET ?'
    ).all(limit, offset) as ActivityLog[];
  }

  getTodayLogs(): ActivityLog[] {
    const db = getDb();
    const today = new Date().toISOString().slice(0, 10);
    return db.prepare(
      "SELECT * FROM activity_logs WHERE date(created_at) = ? ORDER BY created_at DESC"
    ).all(today) as ActivityLog[];
  }

  getStats(): { total: number; active: number; cancelled: number; expired: number; expiringThisMonth: number } {
    const db = getDb();
    const total = (db.prepare('SELECT COUNT(*) as cnt FROM serials').get() as any).cnt;
    const active = (db.prepare("SELECT COUNT(*) as cnt FROM serials WHERE status = 'active'").get() as any).cnt;
    const cancelled = (db.prepare("SELECT COUNT(*) as cnt FROM serials WHERE status = 'cancelled'").get() as any).cnt;
    const expired = (db.prepare("SELECT COUNT(*) as cnt FROM serials WHERE status = 'expired'").get() as any).cnt;

    const now = new Date();
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
    const today = now.toISOString().slice(0, 10);
    const expiringThisMonth = (db.prepare(
      "SELECT COUNT(*) as cnt FROM serials WHERE expiry_date >= ? AND expiry_date <= ? AND status = 'active'"
    ).get(today, endOfMonth) as any).cnt;

    return { total, active, cancelled, expired, expiringThisMonth };
  }
}

export const serialService = new SerialService();
