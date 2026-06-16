import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, getDb, initDatabaseForTesting } from '../src/main/database';
import { approvePendingOrder } from '../src/main/services/order.service';

let sqliteAvailable = true;
let sqliteUnavailableReason = '';

try {
  initDatabaseForTesting();
  closeDatabase();
} catch (err) {
  sqliteAvailable = false;
  sqliteUnavailableReason = err instanceof Error ? err.message : String(err);
}

const describeSqlite = sqliteAvailable ? describe : describe.skip;

describeSqlite('approvePendingOrder addon handling', () => {
  beforeEach(() => {
    initDatabaseForTesting();
  });

  afterEach(() => {
    closeDatabase();
  });

  it('fails a pending addon when its base serial is missing and keeps it pending', async () => {
    const result = getDb().prepare(`
      INSERT INTO pending_orders
        (source_id, serial_number, order_type, raw_data, status)
      VALUES
        ('poll-addon-missing', 'MISSING-ADDON-SERIAL', 'addon', '{"_add_ons":[{"name":"Module A","added_date":"2026-05-22"}]}', 'pending')
    `).run();

    const approval = await approvePendingOrder(result.lastInsertRowid as number, {
      serial_status: 'not-activated',
    });
    const pending = getDb()
      .prepare('SELECT status FROM pending_orders WHERE id = ?')
      .get(result.lastInsertRowid) as { status: string };

    expect(approval).toEqual({
      success: false,
      error: 'Add-on 대상 시리얼 MISSING-ADDON-SERIAL을 찾을 수 없습니다.',
    });
    expect(pending.status).toBe('pending');
    expect(getDb().prepare('SELECT COUNT(*) as count FROM serials').get()).toEqual({ count: 0 });
  });

  it('keeps a legacy polled main product out of serial version during approval', async () => {
    const result = getDb().prepare(`
      INSERT INTO pending_orders
        (source_id, serial_number, customer_name, main_product, version, product_code, order_type, raw_data, status)
      VALUES
        ('poll-main-legacy', 'MAIN-PRODUCT-SERIAL', 'Main Customer', '', 'EXOCAD Basic', '006-001001',
         'new', '{"_poll_group":"main","品名":"EXOCAD Basic"}', 'pending')
    `).run();

    const approval = await approvePendingOrder(result.lastInsertRowid as number, {
      serial_status: 'not-activated',
    });
    const serial = getDb()
      .prepare('SELECT main_product, version, status FROM serials WHERE serial_number = ?')
      .get('MAIN-PRODUCT-SERIAL') as { main_product: string; version: string; status: string };

    expect(approval.success).toBe(true);
    expect(serial).toEqual({
      main_product: 'EXOCAD Basic',
      version: '',
      status: 'not-activated',
    });
  });

  it('reclassifies an already pending moved add-on code as a main product during approval', async () => {
    const result = getDb().prepare(`
      INSERT INTO pending_orders
        (source_id, serial_number, customer_name, main_product, version, product_code, order_type, raw_data, status)
      VALUES
        ('poll-main-reclassified', 'MOVED-MAIN-SERIAL', 'Moved Customer', '', 'EXOCAD Main Product', '006-001010',
         'addon', '{"_poll_group":"addon","品名":"EXOCAD Main Product"}', 'pending')
    `).run();

    const approval = await approvePendingOrder(result.lastInsertRowid as number, {
      serial_status: 'not-activated',
    });
    const serial = getDb()
      .prepare('SELECT main_product, version, status FROM serials WHERE serial_number = ?')
      .get('MOVED-MAIN-SERIAL') as { main_product: string; version: string; status: string };

    expect(approval.success).toBe(true);
    expect(serial).toEqual({
      main_product: 'EXOCAD Main Product',
      version: '',
      status: 'not-activated',
    });
  });
});

if (!sqliteAvailable) {
  describe('approvePendingOrder addon environment', () => {
    it('documents why addon approval DB checks are skipped in this Node runtime', () => {
      expect(sqliteUnavailableReason).not.toBe('');
    });
  });
}
