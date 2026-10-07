import { getDb } from '../../main/database';
import { getCustomerById } from '../../main/services/customer.service';
import { getNowTimestampString } from '../../main/utils/date-utils';

const SYNC_INTERVAL_MS = 24 * 3_600_000;

// Asia/Tokyo 기준 'YYYY-MM-DD HH:mm:ss' 문자열은 사전식 비교가 시간 순서와 일치하므로
// Date 파싱(=Node 프로세스의 OS 타임존에 의존, getNowTimestampString의 기준과 어긋날 수 있음) 없이
// 문자열 비교만으로 안전하게 "N시간 이내" 여부를 판정할 수 있다.
function asiaTokyoTimestamp(msAgo: number): string {
  return new Date(Date.now() - msAgo).toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' }).replace('T', ' ');
}

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

  if (account.last_synced_at && account.last_synced_at > asiaTokyoTimestamp(SYNC_INTERVAL_MS)) return;

  // 최초 연결된 고객을 기준으로 프로필 동기화
  const link = db
    .prepare<[number], { customer_id: number }>(
      'SELECT customer_id FROM portal_account_links WHERE account_id = ? ORDER BY id ASC LIMIT 1',
    )
    .get(accountId);

  if (!link) return;

  const customer = getCustomerById(link.customer_id);
  if (!customer) return;

  const now = getNowTimestampString();
  db.prepare(`
    UPDATE portal_accounts
    SET
      name           = COALESCE(NULLIF(name, ''),    ?),
      email          = COALESCE(NULLIF(email, ''),   ?),
      phone          = COALESCE(NULLIF(phone, ''),   ?),
      address        = COALESCE(NULLIF(address, ''), ?),
      last_synced_at = ?,
      updated_at     = ?
    WHERE id = ?
  `).run(customer.name, customer.email, customer.phone, customer.address, now, now, accountId);
}
