import { getDb } from '../../main/database';
import { getCustomerById } from '../../main/services/customer.service';

const SYNC_INTERVAL_MS = 24 * 3_600_000;

/**
 * 로그인된 포털 계정의 프로필을 고객 DB와 지연 동기화한다.
 * - 최초 연결 후 24시간 이내에는 재실행하지 않는다 (부하 최소).
 * - 기존에 입력된 값이 있는 필드는 덮어쓰지 않는다 (COALESCE 조건).
 */
export function syncPortalAccountIfNeeded(accountId: number): void {
  const db = getDb();

  const account = db
    .prepare<[number], { last_synced_at: string | null }>(
      'SELECT last_synced_at FROM portal_accounts WHERE id = ?',
    )
    .get(accountId);

  if (!account) return;

  if (account.last_synced_at) {
    const lastSync = new Date(account.last_synced_at.replace(' ', 'T')).getTime();
    if (Date.now() - lastSync < SYNC_INTERVAL_MS) return;
  }

  // 최초 연결된 고객을 기준으로 프로필 동기화
  const link = db
    .prepare<[number], { customer_id: number }>(
      'SELECT customer_id FROM portal_account_links WHERE account_id = ? ORDER BY id ASC LIMIT 1',
    )
    .get(accountId);

  if (!link) return;

  const customer = getCustomerById(link.customer_id);
  if (!customer) return;

  db.prepare(`
    UPDATE portal_accounts
    SET
      name           = COALESCE(NULLIF(name, ''),    ?),
      email          = COALESCE(NULLIF(email, ''),   ?),
      phone          = COALESCE(NULLIF(phone, ''),   ?),
      address        = COALESCE(NULLIF(address, ''), ?),
      last_synced_at = datetime('now', 'localtime'),
      updated_at     = datetime('now', 'localtime')
    WHERE id = ?
  `).run(customer.name, customer.email, customer.phone, customer.address, accountId);
}
