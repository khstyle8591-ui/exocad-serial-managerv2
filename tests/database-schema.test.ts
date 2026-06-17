import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, getDb, initDatabaseForTesting } from '../src/main/database';

let sqliteAvailable = true;
let sqliteUnavailableReason = '';

// better-sqlite3 is rebuilt for Electron during install. In the plain Node/Vitest
// runtime that can produce a NODE_MODULE_VERSION mismatch, so schema tests are
// intentionally skipped instead of rebuilding the native module and breaking Electron.
try {
  initDatabaseForTesting();
  closeDatabase();
} catch (err) {
  sqliteAvailable = false;
  sqliteUnavailableReason = err instanceof Error ? err.message : String(err);
}

const describeSqlite = sqliteAvailable ? describe : describe.skip;

function tableNames(): string[] {
  return getDb()
    .prepare("SELECT name FROM sqlite_schema WHERE type = 'table'")
    .all()
    .map(row => (row as { name: string }).name);
}

function columnNames(table: string): string[] {
  return getDb()
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map(row => (row as { name: string }).name);
}

function indexNames(table: string): string[] {
  return getDb()
    .prepare(`PRAGMA index_list(${table})`)
    .all()
    .map(row => (row as { name: string }).name);
}

describeSqlite('database schema', () => {
  beforeEach(() => {
    initDatabaseForTesting();
  });

  afterEach(() => {
    closeDatabase();
  });

  it('creates the core application tables', () => {
    expect(tableNames()).toEqual(expect.arrayContaining([
      'customers',
      'serials',
      'activity_logs',
      'mail_templates',
      'inbound_mails',
      'pending_orders',
      'serial_mail_notice_logs',
      'auto_renewal_order_notice_logs',
      'settings',
    ]));
  });

  it('creates inbound mail classification columns', () => {
    expect(columnNames('inbound_mails')).toEqual(expect.arrayContaining([
      'classification',
      'missing_fields',
      'template_sent_at',
      'extracted_serial',
      'linked_serial_id',
    ]));
  });

  it('creates inbound mail lookup indexes', () => {
    expect(indexNames('inbound_mails')).toEqual(expect.arrayContaining([
      'idx_inbound_msgid',
      'idx_inbound_class',
      'idx_inbound_serial',
    ]));
  });

  it('sets the schema user_version to the current migration version', () => {
    expect(getDb().pragma('user_version', { simple: true })).toBe(7);
  });

  it('can initialize a fresh in-memory database repeatedly', () => {
    initDatabaseForTesting();

    expect(tableNames()).toContain('inbound_mails');
    expect(getDb().pragma('user_version', { simple: true })).toBe(7);
  });
});

if (!sqliteAvailable) {
  describe('database schema environment', () => {
    it('documents why in-memory schema checks are skipped in this Node runtime', () => {
      expect(sqliteUnavailableReason).not.toBe('');
      expect(
        sqliteUnavailableReason.includes('NODE_MODULE_VERSION') ||
        sqliteUnavailableReason.includes('better_sqlite3.node') ||
        sqliteUnavailableReason.includes('better-sqlite3'),
      ).toBe(true);
    });
  });
}
