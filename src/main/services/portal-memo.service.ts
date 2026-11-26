import { getDb } from '../database';
import { getNowTimestampString } from '../utils/date-utils';
import type { PortalSerialMemo } from '../../shared/types';

// Fits the empty space of a portal dashboard card with the longest product name (full-width chars).
export const PORTAL_SERIAL_MEMO_MAX_LENGTH = 24;


// A memo is visible only while its writer is still linked to the serial's current customer, so a
// serial moved to another customer never shows the previous holder's note.
const VISIBLE_MEMO_SQL = `
  SELECT m.serial_id, m.memo, m.account_id, a.login_id, m.updated_at
    FROM portal_serial_memos m
    JOIN serials s         ON s.id = m.serial_id
    JOIN portal_accounts a ON a.id = m.account_id
   WHERE EXISTS (SELECT 1 FROM portal_account_links l
                  WHERE l.account_id = m.account_id AND l.customer_id = s.customer_id)`;

export function getVisiblePortalMemo(serialId: number): PortalSerialMemo | null {
  return (getDb()
    .prepare(`${VISIBLE_MEMO_SQL} AND m.serial_id = ?`)
    .get(serialId) as PortalSerialMemo | undefined) ?? null;
}

export function getVisiblePortalMemosForCustomer(customerId: number): Map<number, PortalSerialMemo> {
  const rows = getDb()
    .prepare(`${VISIBLE_MEMO_SQL} AND s.customer_id = ?`)
    .all(customerId) as PortalSerialMemo[];
  return new Map(rows.map(r => [r.serial_id, r]));
}

/** Collapse whitespace (no line breaks in a one-line memo) and strip control characters. */
export function normalizePortalMemo(raw: unknown): string {
  return String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export type SetPortalMemoResult =
  | { ok: true; memo: string }
  | { ok: false; error: 'serial_not_found' | 'memo_too_long' };

/**
 * Save (or clear, when empty) the memo for a serial on behalf of a portal account.
 * The account must be linked to the customer that currently holds the serial; otherwise the
 * serial is reported as not found so the API does not reveal other customers' serials.
 */
export function setPortalMemo(accountId: number, serialNumber: string, rawMemo: unknown): SetPortalMemoResult {
  const db = getDb();
  const serial = db
    .prepare(`SELECT s.id FROM serials s
               WHERE LOWER(s.serial_number) = LOWER(?)
                 AND EXISTS (SELECT 1 FROM portal_account_links l
                              WHERE l.account_id = ? AND l.customer_id = s.customer_id)`)
    .get(String(serialNumber ?? '').trim(), accountId) as { id: number } | undefined;
  if (!serial) return { ok: false, error: 'serial_not_found' };

  const memo = normalizePortalMemo(rawMemo);
  if ([...memo].length > PORTAL_SERIAL_MEMO_MAX_LENGTH) return { ok: false, error: 'memo_too_long' };

  if (!memo) {
    db.prepare('DELETE FROM portal_serial_memos WHERE serial_id = ?').run(serial.id);
    return { ok: true, memo: '' };
  }
  db.prepare(`
    INSERT INTO portal_serial_memos (serial_id, account_id, memo, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(serial_id) DO UPDATE SET account_id = excluded.account_id, memo = excluded.memo, updated_at = excluded.updated_at
  `).run(serial.id, accountId, memo, getNowTimestampString());
  return { ok: true, memo };
}
