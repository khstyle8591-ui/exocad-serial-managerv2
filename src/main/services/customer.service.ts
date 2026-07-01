import { getDb } from '../database';
import { getNowTimestampString } from '../utils/date-utils';
import type { Customer, CustomerCreditLog, CustomerInput, CustomerSerialSummary, MergeCandidate } from '../../shared/types';
import { serverError } from '../../shared/server-errors';

function normalizeCustomerText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeCustomerInput(input: CustomerInput): CustomerInput {
  return {
    ...input,
    name: normalizeCustomerText(input.name) || '(unknown)',
    email: normalizeCustomerText(input.email),
    phone: normalizeCustomerText(input.phone),
    address: normalizeCustomerText(input.address),
    dealer: normalizeCustomerText(input.dealer),
    sales_manager: normalizeCustomerText(input.sales_manager),
    notes: input.notes ?? '',
  };
}

function getNormalizedCustomerName(customer: Pick<Customer, 'name'>): string {
  return normalizeCustomerText(customer.name);
}

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
  const clean = normalizeCustomerInput(input);
  const existingByName = (db
    .prepare('SELECT * FROM customers ORDER BY id ASC')
    .all() as Customer[])
    .find(c => getNormalizedCustomerName(c) === clean.name);
  if (existingByName) return existingByName;

  const result = db
    .prepare(
      `INSERT INTO customers (name, email, phone, address, dealer, sales_manager, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      clean.name,
      clean.email ?? '',
      clean.phone ?? '',
      clean.address ?? '',
      clean.dealer ?? '',
      clean.sales_manager ?? '',
      clean.notes ?? '',
      now,
      now
    );
  return getCustomerById(result.lastInsertRowid as number)!;
}

export function createCustomerSeparate(input: CustomerInput): Customer {
  const db = getDb();
  const now = getNowTimestampString();
  const clean = normalizeCustomerInput(input);
  const result = db
    .prepare(
      `INSERT INTO customers (name, email, phone, address, dealer, sales_manager, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      clean.name,
      clean.email ?? '',
      clean.phone ?? '',
      clean.address ?? '',
      clean.dealer ?? '',
      clean.sales_manager ?? '',
      clean.notes ?? '',
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

  if (input.name !== undefined) { fields.push('name = ?'); values.push(normalizeCustomerText(input.name)); }
  if (input.email !== undefined) { fields.push('email = ?'); values.push(normalizeCustomerText(input.email)); }
  if (input.phone !== undefined) { fields.push('phone = ?'); values.push(normalizeCustomerText(input.phone)); }
  if (input.address !== undefined) { fields.push('address = ?'); values.push(normalizeCustomerText(input.address)); }
  if (input.dealer !== undefined) { fields.push('dealer = ?'); values.push(normalizeCustomerText(input.dealer)); }
  if (input.sales_manager !== undefined) { fields.push('sales_manager = ?'); values.push(normalizeCustomerText(input.sales_manager)); }
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
    return { success: false, error: serverError('CUSTOMER_HAS_SERIALS', inUse.cnt) };
  }
  const result = db.prepare('DELETE FROM customers WHERE id = ?').run(id);
  return { success: result.changes > 0 };
}

export function searchCustomers(query: string): Customer[] {
  const cleanQuery = normalizeCustomerText(query);
  if (!cleanQuery) return [];

  const like = `%${cleanQuery}%`;
  const sqlMatches = getDb()
    .prepare(
      `SELECT * FROM customers
       WHERE name LIKE ? OR email LIKE ? OR phone LIKE ? OR dealer LIKE ? OR sales_manager LIKE ?
       ORDER BY name ASC LIMIT 50`
    )
    .all(like, like, like, like, like) as Customer[];

  const seen = new Set(sqlMatches.map(c => c.id));
  const normalizedMatches = (getDb()
    .prepare('SELECT * FROM customers ORDER BY name ASC')
    .all() as Customer[])
    .filter(c => !seen.has(c.id))
    .filter(c => [
      c.name,
      c.email,
      c.phone,
      c.dealer,
      c.sales_manager,
    ].some(value => normalizeCustomerText(value).includes(cleanQuery)));

  return [...sqlMatches, ...normalizedMatches].slice(0, 50);
}

export function listCustomerSerialSummaries(): CustomerSerialSummary[] {
  return getDb()
    .prepare(
      `SELECT
         customer_id,
         COUNT(*) as total,
         SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
         SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled,
         SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END) as expired,
         SUM(CASE WHEN status = 'not-activated' THEN 1 ELSE 0 END) as not_activated,
         SUM(CASE WHEN status = 'broken' THEN 1 ELSE 0 END) as broken
       FROM serials
       GROUP BY customer_id`
    )
    .all() as CustomerSerialSummary[];
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

  const cleanEmail = normalizeCustomerText(query.email);
  const cleanName = normalizeCustomerText(query.name);
  const cleanPhone = normalizeCustomerText(query.phone);
  const cleanDealer = normalizeCustomerText(query.dealer);

  // Email 완전 일치 (score 1.0)
  if (cleanEmail) {
    const rows = db
      .prepare('SELECT * FROM customers WHERE email = ? AND email != ?')
      .all(cleanEmail, '') as Customer[];
    rows.forEach(c => add(c, 1.0, 'email'));
  }

  // name + phone (score 0.9)
  if (cleanName && cleanPhone) {
    const rows = db
      .prepare('SELECT * FROM customers WHERE name = ? AND phone = ? AND phone != ?')
      .all(cleanName, cleanPhone, '') as Customer[];
    rows.forEach(c => add(c, 0.9, 'name_phone'));
  }

  // name + dealer (score 0.8)
  if (cleanName && cleanDealer) {
    const rows = db
      .prepare('SELECT * FROM customers WHERE name = ? AND dealer = ? AND dealer != ?')
      .all(cleanName, cleanDealer, '') as Customer[];
    rows.forEach(c => add(c, 0.8, 'name_dealer'));
  }

  // name 부분 일치 (score 0.4)
  if (cleanName) {
    const rows = searchCustomers(cleanName).slice(0, 10);
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
  const clean = normalizeCustomerInput(input);

  // 1. Email 일치
  if (clean.email) {
    const found = db
      .prepare('SELECT * FROM customers WHERE email = ? AND email != ?')
      .get(clean.email, '') as Customer | undefined;
    if (found) return found;
  }

  // 2. name + phone 일치
  if (clean.name && clean.phone) {
    const found = db
      .prepare('SELECT * FROM customers WHERE name = ? AND phone = ? AND phone != ?')
      .get(clean.name, clean.phone, '') as Customer | undefined;
    if (found) return found;
  }

  // 3. name + dealer 일치
  if (clean.name && clean.dealer) {
    const found = db
      .prepare('SELECT * FROM customers WHERE name = ? AND dealer = ? AND dealer != ?')
      .get(clean.name, clean.dealer, '') as Customer | undefined;
    if (found) return found;
  }

  // 4. name normalized exact match
  if (clean.name) {
    const found = (db
      .prepare('SELECT * FROM customers ORDER BY id ASC')
      .all() as Customer[])
      .find(c => getNormalizedCustomerName(c) === clean.name);
    if (found) return found;
  }

  // 신규 생성
  return createCustomer(clean);
}

export function listCreditLogs(customerId: number, page = 1, pageSize = 20): {
  items: CustomerCreditLog[];
  total: number;
  totalPages: number;
} {
  const db = getDb();
  const { cnt } = db.prepare(
    'SELECT COUNT(*) as cnt FROM customer_credit_logs WHERE customer_id = ?'
  ).get(customerId) as { cnt: number };
  const offset = (page - 1) * pageSize;
  const items = db.prepare(
    'SELECT * FROM customer_credit_logs WHERE customer_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
  ).all(customerId, pageSize, offset) as CustomerCreditLog[];
  return { items, total: cnt, totalPages: Math.max(1, Math.ceil(cnt / pageSize)) };
}

// ── Singleton export for use in serial.service ────────────────────────────────

export const customerService = {
  list: listCustomers,
  serialSummaries: listCustomerSerialSummaries,
  getById: getCustomerById,
  create: createCustomer,
  createSeparate: createCustomerSeparate,
  update: updateCustomer,
  delete: deleteCustomer,
  search: searchCustomers,
  mergeCandidates: findMergeCandidates,
  findOrCreate: findOrCreateCustomer,
};
