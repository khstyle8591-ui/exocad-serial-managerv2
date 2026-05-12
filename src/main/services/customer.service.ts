import { getDb } from '../database';
import { getNowTimestampString } from '../utils/date-utils';
import type { Customer, CustomerInput, MergeCandidate } from '../../shared/types';

// ── CRUD ──────────────────────────────────────────────────────────────────────

export function listCustomers(): Customer[] {
  return getDb()
    .prepare('SELECT * FROM customers ORDER BY name ASC')
    .all() as Customer[];
}

export function getCustomerById(id: number): Customer | undefined {
  return getDb()
    .prepare('SELECT * FROM customers WHERE id = ?')
    .get(id) as Customer | undefined;
}

export function createCustomer(input: CustomerInput): Customer {
  const db = getDb();
  const now = getNowTimestampString();
  const result = db
    .prepare(
      `INSERT INTO customers (name, email, phone, address, dealer, sales_manager, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      (input.name || '').trim() || '(unknown)',
      input.email ?? '',
      input.phone ?? '',
      input.address ?? '',
      input.dealer ?? '',
      input.sales_manager ?? '',
      input.notes ?? '',
      now,
      now
    );
  return getCustomerById(result.lastInsertRowid as number)!;
}

export function updateCustomer(id: number, input: Partial<CustomerInput>): Customer | undefined {
  const db = getDb();
  const existing = getCustomerById(id);
  if (!existing) return undefined;

  const fields: string[] = [];
  const values: unknown[] = [];

  if (input.name !== undefined) { fields.push('name = ?'); values.push(input.name); }
  if (input.email !== undefined) { fields.push('email = ?'); values.push(input.email); }
  if (input.phone !== undefined) { fields.push('phone = ?'); values.push(input.phone); }
  if (input.address !== undefined) { fields.push('address = ?'); values.push(input.address); }
  if (input.dealer !== undefined) { fields.push('dealer = ?'); values.push(input.dealer); }
  if (input.sales_manager !== undefined) { fields.push('sales_manager = ?'); values.push(input.sales_manager); }
  if (input.notes !== undefined) { fields.push('notes = ?'); values.push(input.notes); }

  if (fields.length === 0) return existing;

  fields.push('updated_at = ?');
  values.push(getNowTimestampString());
  values.push(id);

  db.prepare(`UPDATE customers SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getCustomerById(id);
}

export function deleteCustomer(id: number): { success: boolean; error?: string } {
  const db = getDb();
  const inUse = db
    .prepare('SELECT COUNT(*) as cnt FROM serials WHERE customer_id = ?')
    .get(id) as { cnt: number };
  if (inUse.cnt > 0) {
    return { success: false, error: `이 고객에 연결된 시리얼 ${inUse.cnt}건이 있어 삭제할 수 없습니다.` };
  }
  const result = db.prepare('DELETE FROM customers WHERE id = ?').run(id);
  return { success: result.changes > 0 };
}

export function searchCustomers(query: string): Customer[] {
  const like = `%${query}%`;
  return getDb()
    .prepare(
      `SELECT * FROM customers
       WHERE name LIKE ? OR email LIKE ? OR phone LIKE ? OR dealer LIKE ? OR sales_manager LIKE ?
       ORDER BY name ASC LIMIT 50`
    )
    .all(like, like, like, like, like) as Customer[];
}

// ── Merge Candidate Logic ─────────────────────────────────────────────────────

/**
 * 병합 후보 검색. 우선순위: email → name+phone → name+dealer → name 부분일치.
 * 빈 문자열 필드는 매칭에서 제외.
 */
export function findMergeCandidates(query: {
  email?: string;
  name?: string;
  phone?: string;
  dealer?: string;
}): MergeCandidate[] {
  const db = getDb();
  const candidates: MergeCandidate[] = [];
  const seen = new Set<number>();

  const add = (c: Customer, score: number, matched_field: MergeCandidate['matched_field']) => {
    if (!seen.has(c.id)) {
      seen.add(c.id);
      candidates.push({ customer: c, score, matched_field });
    }
  };

  // Email 완전 일치 (score 1.0)
  if (query.email && query.email.trim() !== '') {
    const rows = db
      .prepare('SELECT * FROM customers WHERE email = ? AND email != ?')
      .all(query.email.trim(), '') as Customer[];
    rows.forEach(c => add(c, 1.0, 'email'));
  }

  // name + phone (score 0.9)
  if (query.name && query.name.trim() !== '' && query.phone && query.phone.trim() !== '') {
    const rows = db
      .prepare('SELECT * FROM customers WHERE name = ? AND phone = ? AND phone != ?')
      .all(query.name.trim(), query.phone.trim(), '') as Customer[];
    rows.forEach(c => add(c, 0.9, 'name_phone'));
  }

  // name + dealer (score 0.8)
  if (query.name && query.name.trim() !== '' && query.dealer && query.dealer.trim() !== '') {
    const rows = db
      .prepare('SELECT * FROM customers WHERE name = ? AND dealer = ? AND dealer != ?')
      .all(query.name.trim(), query.dealer.trim(), '') as Customer[];
    rows.forEach(c => add(c, 0.8, 'name_dealer'));
  }

  // name 부분 일치 (score 0.4)
  if (query.name && query.name.trim() !== '') {
    const rows = db
      .prepare('SELECT * FROM customers WHERE name LIKE ? ORDER BY name ASC LIMIT 10')
      .all(`%${query.name.trim()}%`) as Customer[];
    rows.forEach(c => add(c, 0.4, 'name_partial'));
  }

  return candidates.sort((a, b) => b.score - a.score);
}

/**
 * 이름+이메일+전화 등으로 기존 고객 찾거나, 없으면 신규 생성.
 * 자동 병합 우선순위: email → name+phone → name+dealer.
 */
export function findOrCreateCustomer(input: CustomerInput): Customer {
  const db = getDb();

  // 1. Email 일치
  if (input.email && input.email.trim() !== '') {
    const found = db
      .prepare('SELECT * FROM customers WHERE email = ? AND email != ?')
      .get(input.email.trim(), '') as Customer | undefined;
    if (found) return found;
  }

  // 2. name + phone 일치
  if (input.name && input.name.trim() !== '' && input.phone && input.phone.trim() !== '') {
    const found = db
      .prepare('SELECT * FROM customers WHERE name = ? AND phone = ? AND phone != ?')
      .get(input.name.trim(), input.phone.trim(), '') as Customer | undefined;
    if (found) return found;
  }

  // 3. name + dealer 일치
  if (input.name && input.name.trim() !== '' && input.dealer && input.dealer.trim() !== '') {
    const found = db
      .prepare('SELECT * FROM customers WHERE name = ? AND dealer = ? AND dealer != ?')
      .get(input.name.trim(), input.dealer.trim(), '') as Customer | undefined;
    if (found) return found;
  }

  // 신규 생성
  return createCustomer(input);
}

// ── Singleton export for use in serial.service ────────────────────────────────

export const customerService = {
  list: listCustomers,
  getById: getCustomerById,
  create: createCustomer,
  update: updateCustomer,
  delete: deleteCustomer,
  search: searchCustomers,
  mergeCandidates: findMergeCandidates,
  findOrCreate: findOrCreateCustomer,
};
