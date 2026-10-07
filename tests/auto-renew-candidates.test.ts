import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDatabase, initDatabaseForTesting } from '../src/main/database';
import { serialService } from '../src/main/services/serial.service';

let sqliteAvailable = true;
try {
  initDatabaseForTesting();
  closeDatabase();
} catch {
  sqliteAvailable = false;
}
const describeSqlite = sqliteAvailable ? describe : describe.skip;

const tokyoDate = (daysAhead: number) =>
  new Date(Date.now() + daysAhead * 86400000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });

describeSqlite('getAutoRenewCandidates', () => {
  const ids: Record<string, string> = {};

  function add(key: string, status: string, expiryOffsetDays: number, stopRequested = false) {
    const serial_number = `${key.toUpperCase().padEnd(8, 'X').slice(0, 8)}-AAAA-${String(Object.keys(ids).length).padStart(8, '0')}`;
    ids[key] = serial_number;
    serialService.create({
      serial_number, customer_name: `Customer ${key}`, customer_email: `${key}@example.com`,
      status: status as any, expiry_date: tokyoDate(expiryOffsetDays), renewal_stop_requested: stopRequested,
    });
  }

  beforeAll(() => {
    initDatabaseForTesting();
    add('active', 'active', -1);                       // due, active → renew
    add('expiredrecent', 'expired', -2);               // flipped by syncExpired just before the cron → renew (grace)
    add('expiredold', 'expired', -10);                 // long expired → do not renew
    add('cancelledrecent', 'cancelled', -1);           // manager used [DB-only cancel] → must NOT be revived
    add('cancelledold', 'cancelled', -10);
    add('stopped', 'active', -1, true);                // stop requested → never renew
    add('notactivated', 'not-activated', -1);
    add('future', 'active', 30);                       // not due yet
  });

  afterAll(() => {
    closeDatabase();
  });

  it('renews active and recently-expired serials only', () => {
    const got = serialService.getAutoRenewCandidates().map(s => s.serial_number).sort();
    expect(got).toEqual([ids.active, ids.expiredrecent].sort());
  });

  it('never revives a cancelled serial, even within the 3-day grace window', () => {
    const got = serialService.getAutoRenewCandidates().map(s => s.serial_number);
    expect(got).not.toContain(ids.cancelledrecent);
    expect(got).not.toContain(ids.cancelledold);
  });
});
