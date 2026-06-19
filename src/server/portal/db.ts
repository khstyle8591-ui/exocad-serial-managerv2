import { getDb } from '../../main/database';
import type { AppSettings } from '../../shared/types';

export interface PortalAccount {
  id: number;
  login_id: string;
  email: string;
  phone: string;
  address: string;
  name: string;
  exocad_id: string;
  password_hash: string;
  language: AppSettings['app_language'];
  status: 'active' | 'disabled';
  created_at: string;
  updated_at: string;
  last_synced_at: string | null;
  customer_mismatch: string | null;
}

export function findAccountByLoginId(loginId: string): PortalAccount | null {
  return (
    getDb()
      .prepare<[string], PortalAccount>('SELECT * FROM portal_accounts WHERE LOWER(login_id) = LOWER(?)')
      .get(loginId) ?? null
  );
}

export function findAccountById(id: number): PortalAccount | null {
  return (
    getDb()
      .prepare<[number], PortalAccount>('SELECT * FROM portal_accounts WHERE id = ?')
      .get(id) ?? null
  );
}

export function loginIdExists(loginId: string): boolean {
  const row = getDb()
    .prepare<[string], { n: number }>(
      'SELECT COUNT(*) AS n FROM portal_accounts WHERE login_id = ?',
    )
    .get(loginId);
  return (row?.n ?? 0) > 0;
}

export function createAccount(params: {
  login_id: string;
  email: string;
  phone: string;
  address: string;
  name: string;
  exocad_id: string;
  password_hash: string;
  language: string;
}): number {
  const result = getDb()
    .prepare(
      `INSERT INTO portal_accounts
         (login_id, email, phone, address, name, exocad_id, password_hash, language)
       VALUES
         (@login_id, @email, @phone, @address, @name, @exocad_id, @password_hash, @language)`,
    )
    .run(params);
  return result.lastInsertRowid as number;
}

export function updateAccountPassword(accountId: number, passwordHash: string): void {
  getDb()
    .prepare(
      "UPDATE portal_accounts SET password_hash = ?, updated_at = datetime('now','localtime') WHERE id = ?",
    )
    .run(passwordHash, accountId);
}

// ── Reset tokens ──────────────────────────────────────────────────────────────

function resetTokenExpiresAt(): string {
  return new Date(Date.now() + 60 * 60_000)
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ');
}

export function createResetToken(accountId: number, token: string): void {
  const db = getDb();
  db.prepare('DELETE FROM portal_reset_tokens WHERE account_id = ?').run(accountId);
  db.prepare(
    'INSERT INTO portal_reset_tokens (token, account_id, expires_at) VALUES (?, ?, ?)',
  ).run(token, accountId, resetTokenExpiresAt());
}

export interface ResetTokenRow {
  account_id: number;
  used: number;
}

export function consumeResetToken(token: string): ResetTokenRow | null {
  const db = getDb();
  const row = db
    .prepare<[string], ResetTokenRow>(
      "SELECT account_id, used FROM portal_reset_tokens WHERE token = ? AND expires_at > datetime('now','localtime') AND used = 0",
    )
    .get(token);
  if (!row) return null;
  db.prepare('UPDATE portal_reset_tokens SET used = 1 WHERE token = ?').run(token);
  return row;
}

// ── Account links ─────────────────────────────────────────────────────────────

export function isSerialLinked(accountId: number, customerId: number): boolean {
  const row = getDb()
    .prepare<[number, number], { n: number }>(
      'SELECT COUNT(*) AS n FROM portal_account_links WHERE account_id = ? AND customer_id = ?',
    )
    .get(accountId, customerId);
  return (row?.n ?? 0) > 0;
}

export function createAccountLink(
  accountId: number,
  customerId: number,
  verifiedSerial: string,
): void {
  getDb()
    .prepare(
      'INSERT INTO portal_account_links (account_id, customer_id, verified_serial) VALUES (?, ?, ?)',
    )
    .run(accountId, customerId, verifiedSerial);
}

export interface AccountLink {
  customer_id: number;
  verified_serial: string;
}

export function getAccountLinks(accountId: number): AccountLink[] {
  return getDb()
    .prepare<[number], AccountLink>(
      'SELECT customer_id, verified_serial FROM portal_account_links WHERE account_id = ?',
    )
    .all(accountId);
}

export function isLinkedCustomer(accountId: number, customerId: number): boolean {
  return isSerialLinked(accountId, customerId);
}

// ── Portal requests ───────────────────────────────────────────────────────────

export type PortalRequestType = 'credit' | 'renewal_stop' | 'renewal_resume';
export type PortalRequestStatus = 'pending' | 'manager_review' | 'auto_done' | 'approved' | 'rejected' | 'user_cancelled';

export interface PortalRequestRow {
  id: number;
  account_id: number;
  type: PortalRequestType;
  target_serial: string;
  exocad_id: string;
  package_code: string;
  status: PortalRequestStatus;
  note: string;
  created_at: string;
  processed_at: string | null;
}

export function createPortalRequest(params: {
  account_id: number;
  type: PortalRequestType;
  target_serial?: string;
  exocad_id?: string;
  package_code?: string;
  note?: string;
}): number {
  const result = getDb()
    .prepare(
      `INSERT INTO portal_requests
         (account_id, type, target_serial, exocad_id, package_code, note)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      params.account_id,
      params.type,
      params.target_serial ?? '',
      params.exocad_id ?? '',
      params.package_code ?? '',
      params.note ?? '',
    );
  return result.lastInsertRowid as number;
}

export function updatePortalRequestStatus(id: number, status: PortalRequestStatus): void {
  getDb()
    .prepare(
      "UPDATE portal_requests SET status = ?, processed_at = datetime('now','localtime') WHERE id = ?",
    )
    .run(status, id);
}

export function markPortalRequestPlaywrightFailed(id: number): void {
  getDb()
    .prepare(
      "UPDATE portal_requests SET status = 'rejected', note = 'playwright_failed', processed_at = datetime('now','localtime') WHERE id = ?",
    )
    .run(id);
}

export function findActiveRenewalStopRequest(serialNumber: string): PortalRequestRow | null {
  return (
    getDb()
      .prepare<[string], PortalRequestRow>(
        `SELECT * FROM portal_requests
         WHERE target_serial = ? AND type = 'renewal_stop'
         AND status NOT IN ('user_cancelled', 'rejected')
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(serialNumber) ?? null
  );
}

export function getPortalRequestsByAccount(accountId: number): PortalRequestRow[] {
  return getDb()
    .prepare<[number], PortalRequestRow>(
      'SELECT * FROM portal_requests WHERE account_id = ? ORDER BY created_at DESC',
    )
    .all(accountId);
}

// ── Admin queries ─────────────────────────────────────────────────────────────

export interface PortalAccountSafe extends Omit<PortalAccount, 'password_hash'> {}

export function getAllPortalAccounts(): PortalAccountSafe[] {
  return getDb()
    .prepare<[], PortalAccountSafe>(
      'SELECT id,login_id,email,phone,address,name,exocad_id,language,status,created_at,updated_at,last_synced_at,customer_mismatch FROM portal_accounts ORDER BY created_at DESC',
    )
    .all();
}

export function setCustomerMismatch(id: number, data: Record<string, [string, string]> | null): void {
  getDb()
    .prepare('UPDATE portal_accounts SET customer_mismatch = ? WHERE id = ?')
    .run(data ? JSON.stringify(data) : null, id);
}

export function updatePortalAccountFields(
  id: number,
  fields: Partial<Pick<PortalAccount, 'name' | 'email' | 'phone' | 'address' | 'exocad_id' | 'language'>>,
): void {
  const allowed = ['name', 'email', 'phone', 'address', 'exocad_id', 'language'] as const;
  const updates = allowed.filter(k => k in fields);
  if (updates.length === 0) return;
  const set = updates.map(k => `${k} = ?`).join(', ');
  const values = updates.map(k => (fields as Record<string, unknown>)[k]);
  getDb()
    .prepare(`UPDATE portal_accounts SET ${set}, updated_at = datetime('now','localtime') WHERE id = ?`)
    .run(...values, id);
}

export function setPortalAccountStatus(id: number, status: 'active' | 'disabled'): void {
  getDb()
    .prepare("UPDATE portal_accounts SET status = ?, updated_at = datetime('now','localtime') WHERE id = ?")
    .run(status, id);
}

export interface PortalRequestWithAccount extends PortalRequestRow {
  account_name: string;
  account_login_id: string;
  account_email: string;
}

export function getAllPortalRequests(filter?: {
  type?: PortalRequestType;
  status?: PortalRequestStatus;
}): PortalRequestWithAccount[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter?.type) { clauses.push('pr.type = ?'); params.push(filter.type); }
  if (filter?.status) { clauses.push('pr.status = ?'); params.push(filter.status); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return getDb()
    .prepare<unknown[], PortalRequestWithAccount>(
      `SELECT pr.*, pa.name AS account_name, pa.login_id AS account_login_id, pa.email AS account_email
       FROM portal_requests pr
       JOIN portal_accounts pa ON pa.id = pr.account_id
       ${where}
       ORDER BY pr.created_at DESC`,
    )
    .all(...params);
}

export function getPortalRequestById(id: number): PortalRequestWithAccount | null {
  return (
    getDb()
      .prepare<[number], PortalRequestWithAccount>(
        `SELECT pr.*, pa.name AS account_name, pa.login_id AS account_login_id, pa.email AS account_email
         FROM portal_requests pr
         JOIN portal_accounts pa ON pa.id = pr.account_id
         WHERE pr.id = ?`,
      )
      .get(id) ?? null
  );
}
