import { getDb } from '../../main/database';
import { getNowTimestampString } from '../../main/utils/date-utils';
import { emitPortalRequestChanged } from './request-events';
import type { AppSettings, CustomerPortalInfo } from '../../shared/types';

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
  // created_at/updated_at도 테이블 DEFAULT(OS 타임존 의존)가 아닌 Asia/Tokyo 명시 값으로 저장한다.
  const now = getNowTimestampString();
  const result = getDb()
    .prepare(
      `INSERT INTO portal_accounts
         (login_id, email, phone, address, name, exocad_id, password_hash, language, created_at, updated_at)
       VALUES
         (@login_id, @email, @phone, @address, @name, @exocad_id, @password_hash, @language, @now, @now)`,
    )
    .run({ ...params, now });
  return result.lastInsertRowid as number;
}

export function updateAccountPassword(accountId: number, passwordHash: string): void {
  getDb()
    .prepare(
      'UPDATE portal_accounts SET password_hash = ?, updated_at = ? WHERE id = ?',
    )
    .run(passwordHash, getNowTimestampString(), accountId);
}

// ── Reset tokens ──────────────────────────────────────────────────────────────

// Asia/Tokyo 기준으로 통일 (consumeResetToken의 비교 기준과 일치시킴) — date-utils 설명 참조.
function resetTokenExpiresAt(): string {
  return new Date(Date.now() + 60 * 60_000)
    .toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' })
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
    .prepare<[string, string], ResetTokenRow>(
      'SELECT account_id, used FROM portal_reset_tokens WHERE token = ? AND expires_at > ? AND used = 0',
    )
    .get(token, getNowTimestampString());
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

/**
 * 고객별 연결된 포털 계정 정보(login_id, exocad_id) 일괄 조회 (읽기 전용 표시용).
 * 고객 한 명에 여러 포털 계정이 연결된 경우 가장 먼저 연결된 계정을 기준으로 표시한다
 * (sync.ts의 "기준 고객" 선정 방식과 동일).
 */
export function listCustomerPortalInfo(): CustomerPortalInfo[] {
  return getDb()
    .prepare<[], CustomerPortalInfo>(
      `SELECT g.customer_id AS customer_id, pa.login_id AS login_id, pa.exocad_id AS exocad_id
       FROM (
         SELECT customer_id, MIN(id) AS link_id
         FROM portal_account_links
         GROUP BY customer_id
       ) g
       JOIN portal_account_links l ON l.id = g.link_id
       JOIN portal_accounts pa ON pa.id = l.account_id`,
    )
    .all();
}

// ── Portal requests ───────────────────────────────────────────────────────────

export type PortalRequestType = 'credit' | 'renewal_stop' | 'renewal_resume';
export type PortalRequestStatus = 'pending' | 'manager_review' | 'auto_done' | 'approved' | 'rejected' | 'user_cancelled' | 'cancel_requested';

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
  // created_at은 테이블 DEFAULT(datetime('now','localtime'))에 맡기지 않고 명시적으로 전달한다.
  // DEFAULT는 SQLite가 OS 타임존을 사용하므로, 서버 OS가 UTC인 경우(흔한 GCP VM 기본값)
  // Asia/Tokyo 기준보다 9시간 어긋난 접수 시각이 저장/표시되는 버그가 있었음.
  const result = getDb()
    .prepare(
      `INSERT INTO portal_requests
         (account_id, type, target_serial, exocad_id, package_code, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      params.account_id,
      params.type,
      params.target_serial ?? '',
      params.exocad_id ?? '',
      params.package_code ?? '',
      params.note ?? '',
      getNowTimestampString(),
    );
  emitPortalRequestChanged();
  return result.lastInsertRowid as number;
}

export function updatePortalRequestStatus(id: number, status: PortalRequestStatus): void {
  getDb()
    .prepare(
      'UPDATE portal_requests SET status = ?, processed_at = ? WHERE id = ?',
    )
    .run(status, getNowTimestampString(), id);
  emitPortalRequestChanged();
}

// 시스템/고객 신청에서 발생한 Playwright 실패 — 포털에 "처리 실패"로 노출됨(고객이 시리얼 확인 후 재신청 유도).
export function markPortalRequestPlaywrightFailed(id: number): void {
  getDb()
    .prepare(
      "UPDATE portal_requests SET status = 'rejected', note = 'playwright_failed', processed_at = ? WHERE id = ?",
    )
    .run(getNowTimestampString(), id);
  emitPortalRequestChanged();
}

// 매니저가 승인한 후 Playwright 실행이 실패한 경우 — 매니저는 이미 신청을 검토/승인했으므로
// status는 'approved'로 유지해 포털 고객에게는 그냥 "승인됨"으로 보이게 하고,
// note로만 Playwright 실패를 구분해 매니저가 재시도할 수 있도록 한다.
export function markPortalRequestPlaywrightFailedByManager(id: number): void {
  getDb()
    .prepare(
      "UPDATE portal_requests SET status = 'approved', note = 'playwright_failed_manual', processed_at = ? WHERE id = ?",
    )
    .run(getNowTimestampString(), id);
  emitPortalRequestChanged();
}

// 매니저가 고객의 취소 요청(cancel_requested)을 거절한 경우 — 원래 신청은 그대로 승인된 것으로
// 확정하고(status='approved'), note로만 "취소 거절"을 구분해 포털/매니저 화면에서 별도 표시하고
// 고객이 다시 취소를 신청하지 못하게 한다.
export function markPortalRequestCancelRejected(id: number): void {
  getDb()
    .prepare(
      "UPDATE portal_requests SET status = 'approved', note = 'cancel_rejected', processed_at = ? WHERE id = ?",
    )
    .run(getNowTimestampString(), id);
  emitPortalRequestChanged();
}

// 갱신중단 플래그가 이미 선점된 상태에서 들어온 중복 신청 — 매니저 대기열에 노출되지 않도록
// 즉시 'rejected'로 확정하고 note로만 구분해 포털/매니저 화면에 "중복신청"으로 표시한다.
export function markPortalRequestDuplicate(id: number): void {
  getDb()
    .prepare(
      "UPDATE portal_requests SET status = 'rejected', note = 'duplicate', processed_at = ? WHERE id = ?",
    )
    .run(getNowTimestampString(), id);
  emitPortalRequestChanged();
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
    .prepare(`UPDATE portal_accounts SET ${set}, updated_at = ? WHERE id = ?`)
    .run(...values, getNowTimestampString(), id);
}

export function setPortalAccountStatus(id: number, status: 'active' | 'disabled'): void {
  getDb()
    .prepare('UPDATE portal_accounts SET status = ?, updated_at = ? WHERE id = ?')
    .run(status, getNowTimestampString(), id);
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
