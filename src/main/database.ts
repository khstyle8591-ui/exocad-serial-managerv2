import Database from 'better-sqlite3';
import path from 'path';
import { app } from 'electron';

let db: Database.Database;

export function getDbPath(): string {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'exocad.db');
}

export function initDatabase(): Database.Database {
  const dbPath = getDbPath();
  db = new Database(dbPath);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  createTables();
  migrateDatabase();
  return db;
}

function createTables(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS serials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      serial_number TEXT UNIQUE NOT NULL,
      customer_name TEXT NOT NULL DEFAULT '',
      customer_email TEXT NOT NULL DEFAULT '',
      customer_address TEXT NOT NULL DEFAULT '',
      customer_phone TEXT NOT NULL DEFAULT '',
      customer_manager TEXT NOT NULL DEFAULT '',
      purchase_date TEXT NOT NULL,
      expiry_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'cancelled', 'expired')),
      engine_build TEXT NOT NULL DEFAULT '',
      version TEXT NOT NULL DEFAULT '',
      add_ons TEXT NOT NULL DEFAULT '[]',
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS renewal_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      serial_id INTEGER NOT NULL,
      request_date TEXT NOT NULL,
      request_source TEXT NOT NULL DEFAULT 'email' CHECK(request_source IN ('email', 'manual')),
      processed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (serial_id) REFERENCES serials(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      serial_id INTEGER NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('registered', 'renewed', 'cancelled', 'addon_added', 'bulk_imported')),
      details TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (serial_id) REFERENCES serials(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS pending_orders (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id     TEXT NOT NULL DEFAULT '',
      source_url    TEXT NOT NULL DEFAULT '',
      serial_number    TEXT NOT NULL DEFAULT '',
      customer_name    TEXT NOT NULL DEFAULT '',
      customer_email   TEXT NOT NULL DEFAULT '',
      customer_address TEXT NOT NULL DEFAULT '',
      customer_phone   TEXT NOT NULL DEFAULT '',
      customer_manager TEXT NOT NULL DEFAULT '',
      purchase_date TEXT NOT NULL DEFAULT '',
      expiry_date   TEXT NOT NULL DEFAULT '',
      engine_build  TEXT NOT NULL DEFAULT '',
      version       TEXT NOT NULL DEFAULT '',
      notes         TEXT NOT NULL DEFAULT '',
      order_type    TEXT NOT NULL DEFAULT 'new' CHECK(order_type IN ('new', 'renewal', 'addon')),
      raw_data      TEXT NOT NULL DEFAULT '',
      status        TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
      created_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE INDEX IF NOT EXISTS idx_serials_expiry ON serials(expiry_date);
    CREATE INDEX IF NOT EXISTS idx_serials_status ON serials(status);
    CREATE INDEX IF NOT EXISTS idx_serials_serial_number ON serials(serial_number);
    CREATE INDEX IF NOT EXISTS idx_logs_created ON activity_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_logs_serial ON activity_logs(serial_id);
  `);
}

// 기존 DB에 새 컬럼 추가 (이미 존재하면 무시)
function migrateDatabase(): void {
  // serials 테이블 마이그레이션
  const serialColumns = [
    { name: 'customer_address', definition: "TEXT NOT NULL DEFAULT ''" },
    { name: 'customer_phone', definition: "TEXT NOT NULL DEFAULT ''" },
    { name: 'customer_manager', definition: "TEXT NOT NULL DEFAULT ''" },
    { name: 'engine_build', definition: "TEXT NOT NULL DEFAULT ''" },
    { name: 'version', definition: "TEXT NOT NULL DEFAULT ''" },
  ];

  const existingSerialCols = (db.pragma('table_info(serials)') as any[]).map((c: any) => c.name as string);
  for (const col of serialColumns) {
    if (!existingSerialCols.includes(col.name)) {
      db.exec(`ALTER TABLE serials ADD COLUMN ${col.name} ${col.definition}`);
    }
  }

  // pending_orders 테이블 마이그레이션
  const pendingColumns = [
    { name: 'product_code', definition: "TEXT NOT NULL DEFAULT ''" },
    { name: 'flag_duplicate', definition: 'INTEGER NOT NULL DEFAULT 0' },
  ];

  const existingPendingCols = (db.pragma('table_info(pending_orders)') as any[]).map((c: any) => c.name as string);
  for (const col of pendingColumns) {
    if (!existingPendingCols.includes(col.name)) {
      db.exec(`ALTER TABLE pending_orders ADD COLUMN ${col.name} ${col.definition}`);
    }
  }
}

export function getDb(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
  }
}
