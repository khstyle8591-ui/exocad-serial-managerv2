import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { logger } from './utils/logger';

let db: Database.Database;

export const CURRENT_SCHEMA_VERSION = 13;

type Migration = {
  version: number;
  name: string;
  run: () => void;
};

export function getDbPath(): string {
  if (!process.env.DB_PATH) {
    throw new Error(
      'DB_PATH is required. Set DB_PATH to the SQLite database file before running the server, ' +
      'migration, or maintenance scripts.'
    );
  }
  const dbPath = process.env.DB_PATH;
  const dataDir = path.dirname(dbPath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  return dbPath;
}

export function getLegacyDbPath(): string {
  const dbPath = getDbPath();
  return dbPath.replace(/\.db$/, '-legacy.db');
}

/**
 * 현재 DB 파일이 신규 스키마인지 확인.
 * customers 테이블 존재 여부로 판단.
 */
function hasNewSchema(dbPath: string): boolean {
  try {
    const tempDb = new Database(dbPath, { readonly: true, fileMustExist: true });
    const row = tempDb
      .prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name='customers'")
      .get() as { name: string } | undefined;
    tempDb.close();
    return !!row;
  } catch {
    return false;
  }
}

/**
 * 첫 실행 감지: 구 스키마 exocad.db → exocad-legacy.db rename.
 * -wal / -shm 파일도 함께 처리.
 * Returns true if rename happened.
 */
function detectAndRenameLegacy(): boolean {
  const dbPath = getDbPath();
  const legacyPath = getLegacyDbPath();

  if (!fs.existsSync(dbPath)) return false;   // 완전히 새 설치
  if (hasNewSchema(dbPath)) return false;      // 이미 신규 스키마

  logger.info('[DB] Old schema detected. Renaming to legacy...');
  fs.renameSync(dbPath, legacyPath);

  for (const ext of ['-wal', '-shm']) {
    const src = dbPath + ext;
    if (fs.existsSync(src)) {
      try {
        fs.renameSync(src, legacyPath + ext);
      } catch {
        // rename 실패 시 삭제 (WAL/SHM은 재생성 가능)
        try { fs.unlinkSync(src); } catch { /* ignore */ }
      }
    }
  }

  logger.info(`[DB] Legacy DB saved at: ${legacyPath}`);
  return true;
}

/**
 * activity_logs.severity CHECK 제약에 'critical'이 빠진 구 스키마를 마이그레이션.
 * SQLite는 CHECK 제약을 ALTER로 변경할 수 없어 테이블 재생성이 필요.
 * 새 설치에서는 createTables() 가 올바른 제약으로 생성하므로 이 함수가 no-op.
 */
function migrateSeverityConstraint(): void {
  const row = db
    .prepare("SELECT sql FROM sqlite_schema WHERE name='activity_logs' AND type='table'")
    .get() as { sql: string } | undefined;

  if (!row) return;                          // 테이블 자체가 없으면 createTables()가 처리
  if (row.sql.includes("'critical'")) return; // 이미 올바른 제약 보유

  logger.info('[DB] Migrating activity_logs: adding critical severity...');

  db.exec(`
    CREATE TABLE activity_logs_new (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      serial_id  INTEGER,
      action     TEXT NOT NULL CHECK(action IN (
                   'registered','renewed','cancelled','addon_added',
                   'activated','stop_requested','stop_cleared',
                   'status_forced_expired','bulk_imported','customer_merged',
                   'legacy_imported','mail_sent','mail_failed','cron_ran','system'
                 )),
      actor      TEXT NOT NULL DEFAULT 'system'
                   CHECK(actor IN ('manual','auto','email','polling','system')),
      diff       TEXT NOT NULL DEFAULT '{}',
      details    TEXT NOT NULL DEFAULT '',
      trigger_id TEXT,
      severity   TEXT NOT NULL DEFAULT 'info'
                   CHECK(severity IN ('info','warn','error','critical')),
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (serial_id) REFERENCES serials(id) ON DELETE SET NULL
    );

    INSERT INTO activity_logs_new SELECT * FROM activity_logs;

    DROP TABLE activity_logs;

    ALTER TABLE activity_logs_new RENAME TO activity_logs;

    CREATE INDEX IF NOT EXISTS idx_logs_created  ON activity_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_logs_serial   ON activity_logs(serial_id);
    CREATE INDEX IF NOT EXISTS idx_logs_action   ON activity_logs(action);
    CREATE INDEX IF NOT EXISTS idx_logs_severity ON activity_logs(severity);
  `);

  logger.info('[DB] Migration complete: activity_logs.severity now includes critical');
}

function migrateInboundClassificationConstraint(): void {
  const row = db
    .prepare("SELECT sql FROM sqlite_schema WHERE name='inbound_mails' AND type='table'")
    .get() as { sql: string } | undefined;

  if (!row) return;
  if (
    row.sql.includes("'stop_request_candidate'") &&
    row.sql.includes("'renewal_request'") &&
    row.sql.includes("'missing_info'") &&
    row.sql.includes("'invalid_cancellation_response'") &&
    row.sql.includes('missing_fields') &&
    row.sql.includes('template_sent_at') &&
    row.sql.includes('response_errors') &&
    row.sql.includes('admin_review_resolved')
  ) return;

  logger.info('[DB] Migrating inbound_mails: adding request classifications...');
  const columns = db.prepare('PRAGMA table_info(inbound_mails)').all() as { name: string }[];
  const hasMissingFields = columns.some(col => col.name === 'missing_fields');
  const hasTemplateSentAt = columns.some(col => col.name === 'template_sent_at');
  const has = (name: string) => columns.some(col => col.name === name);

  db.exec(`
    CREATE TABLE inbound_mails_new (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id       TEXT,
      mail_from        TEXT NOT NULL,
      mail_to          TEXT NOT NULL DEFAULT '',
      subject          TEXT NOT NULL,
      body             TEXT NOT NULL,
      received_at      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      classification   TEXT NOT NULL DEFAULT 'unclassified'
                         CHECK(classification IN ('unclassified','renewal_request','stop_request_candidate','stop_request','missing_info','invalid_cancellation_response','unrelated','error')),
      matched_template TEXT,
      matched_keywords TEXT NOT NULL DEFAULT '[]',
      extracted_serial TEXT,
      linked_serial_id INTEGER,
      processed        INTEGER NOT NULL DEFAULT 0,
      missing_fields   TEXT NOT NULL DEFAULT '[]',
      template_sent_at TEXT,
      response_errors  TEXT NOT NULL DEFAULT '[]',
      response_attempt INTEGER NOT NULL DEFAULT 0,
      response_customer_name TEXT,
      admin_review     INTEGER NOT NULL DEFAULT 0,
      admin_review_resolved INTEGER NOT NULL DEFAULT 0,
      error            TEXT,
      FOREIGN KEY (linked_serial_id) REFERENCES serials(id) ON DELETE SET NULL
    );

    INSERT INTO inbound_mails_new
      (id, message_id, mail_from, mail_to, subject, body, received_at,
       classification, matched_template, matched_keywords, extracted_serial,
       linked_serial_id, processed, missing_fields, template_sent_at, response_errors,
       response_attempt, response_customer_name, admin_review, admin_review_resolved, error)
    SELECT
      id, message_id, mail_from, mail_to, subject, body, received_at,
      CASE WHEN classification = 'stop_request' THEN 'renewal_request' ELSE classification END,
      matched_template, matched_keywords, extracted_serial,
      linked_serial_id, processed,
      ${hasMissingFields ? 'missing_fields' : "'[]'"},
      ${hasTemplateSentAt ? 'template_sent_at' : 'NULL'},
      ${has('response_errors') ? 'response_errors' : "'[]'"},
      ${has('response_attempt') ? 'response_attempt' : '0'},
      ${has('response_customer_name') ? 'response_customer_name' : 'NULL'},
      ${has('admin_review') ? 'admin_review' : '0'},
      ${has('admin_review_resolved') ? 'admin_review_resolved' : '0'},
      error
    FROM inbound_mails;

    DROP TABLE inbound_mails;
    ALTER TABLE inbound_mails_new RENAME TO inbound_mails;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_inbound_msgid
      ON inbound_mails(message_id) WHERE message_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_inbound_class  ON inbound_mails(classification);
    CREATE INDEX IF NOT EXISTS idx_inbound_serial ON inbound_mails(linked_serial_id);
  `);

  logger.info('[DB] Migration complete: inbound_mails classifications updated');
}

function ensureInboundMessageIdUniqueIndex(): void {
  const index = db
    .prepare("SELECT sql FROM sqlite_schema WHERE name='idx_inbound_msgid' AND type='index'")
    .get() as { sql: string | null } | undefined;

  if (index?.sql?.includes('WHERE message_id IS NOT NULL')) {
    logger.info('[DB] Rebuilding inbound_mails message_id unique index...');
    db.exec('DROP INDEX IF EXISTS idx_inbound_msgid;');
  }

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_inbound_msgid
      ON inbound_mails(message_id);
  `);
}

function createPendingOrderSourceUniqueIndex(): void {
  const duplicate = db
    .prepare(`
      SELECT source_id, COUNT(*) AS cnt
      FROM pending_orders
      WHERE source_id != ''
      GROUP BY source_id
      HAVING cnt > 1
      LIMIT 1
    `)
    .get() as { source_id: string; cnt: number } | undefined;

  if (duplicate) {
    logger.warn(
      `[DB] pending_orders.source_id has duplicates; unique index skipped. ` +
      `Example: ${duplicate.source_id} (${duplicate.cnt} rows)`
    );
    return;
  }

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_source_id_unique
      ON pending_orders(source_id)
      WHERE source_id != '';
  `);
}

function createSerialMailNoticeLogsTable(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS serial_mail_notice_logs (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      serial_id       INTEGER,
      serial_number   TEXT NOT NULL DEFAULT '',
      template_code   TEXT NOT NULL DEFAULT '',
      notice_kind     TEXT NOT NULL CHECK(notice_kind IN ('expiry_renewal','expiry_stop')),
      days_before     INTEGER NOT NULL,
      recipient_email TEXT NOT NULL DEFAULT '',
      status          TEXT NOT NULL CHECK(status IN ('sent','failed')),
      message         TEXT NOT NULL DEFAULT '',
      sent_at         TEXT NOT NULL,
      expires_at      TEXT NOT NULL,
      created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (serial_id) REFERENCES serials(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_notice_logs_serial_sent
      ON serial_mail_notice_logs(serial_id, sent_at DESC);
    CREATE INDEX IF NOT EXISTS idx_notice_logs_expires
      ON serial_mail_notice_logs(expires_at);
  `);
}

function createAutoRenewalOrderNoticeLogsTable(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS auto_renewal_order_notice_logs (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      serial_id            INTEGER,
      serial_number        TEXT NOT NULL DEFAULT '',
      customer_name        TEXT NOT NULL DEFAULT '',
      customer_email       TEXT NOT NULL DEFAULT '',
      main_product         TEXT NOT NULL DEFAULT '',
      modules              TEXT NOT NULL DEFAULT '[]',
      previous_expiry_date TEXT NOT NULL DEFAULT '',
      renewed_expiry_date  TEXT NOT NULL DEFAULT '',
      recipient_email      TEXT NOT NULL DEFAULT '',
      subject              TEXT NOT NULL DEFAULT '',
      html_body            TEXT NOT NULL DEFAULT '',
      status               TEXT NOT NULL CHECK(status IN ('sent','failed')),
      message              TEXT NOT NULL DEFAULT '',
      sent_at              TEXT NOT NULL,
      created_at           TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (serial_id) REFERENCES serials(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_auto_renew_order_notice_sent
      ON auto_renewal_order_notice_logs(sent_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_auto_renew_order_notice_serial
      ON auto_renewal_order_notice_logs(serial_id, sent_at DESC);
    CREATE INDEX IF NOT EXISTS idx_auto_renew_order_notice_status
      ON auto_renewal_order_notice_logs(status);
  `);
}

function createPortalTables(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS portal_accounts (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      login_id       TEXT    NOT NULL UNIQUE,
      email          TEXT    NOT NULL DEFAULT '',
      phone          TEXT    NOT NULL DEFAULT '',
      address        TEXT    NOT NULL DEFAULT '',
      name           TEXT    NOT NULL DEFAULT '',
      exocad_id      TEXT    NOT NULL DEFAULT '',
      password_hash  TEXT    NOT NULL,
      language       TEXT    NOT NULL DEFAULT 'ko' CHECK(language IN ('ko','en','ja')),
      status         TEXT    NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
      created_at     TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at     TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
      last_synced_at TEXT
    );

    CREATE TABLE IF NOT EXISTS portal_account_links (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id      INTEGER NOT NULL,
      customer_id     INTEGER NOT NULL,
      verified_serial TEXT    NOT NULL DEFAULT '',
      created_at      TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (account_id)  REFERENCES portal_accounts(id) ON DELETE CASCADE,
      FOREIGN KEY (customer_id) REFERENCES customers(id)       ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_pal_account  ON portal_account_links(account_id);
    CREATE INDEX IF NOT EXISTS idx_pal_customer ON portal_account_links(customer_id);

    CREATE TABLE IF NOT EXISTS portal_requests (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id    INTEGER NOT NULL,
      type          TEXT    NOT NULL CHECK(type IN ('credit','renewal_stop','renewal_resume')),
      target_serial TEXT    NOT NULL DEFAULT '',
      exocad_id     TEXT    NOT NULL DEFAULT '',
      package_code  TEXT    NOT NULL DEFAULT '',
      status        TEXT    NOT NULL DEFAULT 'pending'
                            CHECK(status IN ('pending','manager_review','auto_done','approved','rejected','user_cancelled','cancel_requested')),
      note          TEXT    NOT NULL DEFAULT '',
      created_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
      processed_at  TEXT,
      FOREIGN KEY (account_id) REFERENCES portal_accounts(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_pr_account ON portal_requests(account_id);
    CREATE INDEX IF NOT EXISTS idx_pr_type    ON portal_requests(type, status);
    CREATE INDEX IF NOT EXISTS idx_pr_serial  ON portal_requests(target_serial) WHERE target_serial != '';

    CREATE TABLE IF NOT EXISTS portal_sessions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      token       TEXT    NOT NULL UNIQUE,
      account_id  INTEGER NOT NULL,
      csrf_token  TEXT    NOT NULL DEFAULT '',
      expires_at  TEXT    NOT NULL,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (account_id) REFERENCES portal_accounts(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_ps_token   ON portal_sessions(token);
    CREATE INDEX IF NOT EXISTS idx_ps_account ON portal_sessions(account_id);
    CREATE INDEX IF NOT EXISTS idx_ps_expires ON portal_sessions(expires_at);

    CREATE TABLE IF NOT EXISTS portal_reset_tokens (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      token       TEXT    NOT NULL UNIQUE,
      account_id  INTEGER NOT NULL,
      expires_at  TEXT    NOT NULL,
      used        INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (account_id) REFERENCES portal_accounts(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_prt_token   ON portal_reset_tokens(token);
    CREATE INDEX IF NOT EXISTS idx_prt_account ON portal_reset_tokens(account_id);
  `);
}

function getUserVersion(): number {
  return db.pragma('user_version', { simple: true }) as number;
}

function setUserVersion(version: number): void {
  db.pragma(`user_version = ${version}`);
}

function migratePortalAccountMismatch(): void {
  const row = db
    .prepare("SELECT sql FROM sqlite_schema WHERE name='portal_accounts' AND type='table'")
    .get() as { sql: string } | undefined;
  if (!row) return;
  if (row.sql.includes('customer_mismatch')) return;
  db.exec('ALTER TABLE portal_accounts ADD COLUMN customer_mismatch TEXT');
}

/**
 * portal_requests.status CHECK 제약에 'user_cancelled'가 빠진 구 스키마를 마이그레이션.
 * 고객이 pending 신청을 취소하면 UPDATE ... SET status='user_cancelled'가 실행되는데,
 * 구 제약에는 이 값이 없어 SQLite CHECK constraint 위반으로 500 에러가 발생했음.
 * SQLite는 CHECK 제약을 ALTER로 변경할 수 없어 테이블 재생성이 필요.
 */
function migratePortalRequestsUserCancelled(): void {
  const row = db
    .prepare("SELECT sql FROM sqlite_schema WHERE name='portal_requests' AND type='table'")
    .get() as { sql: string } | undefined;

  if (!row) return;                              // 테이블 자체가 없으면 createPortalTables()가 처리
  if (row.sql.includes("'user_cancelled'")) return; // 이미 올바른 제약 보유

  logger.info('[DB] Migrating portal_requests: adding user_cancelled status...');

  db.exec(`
    CREATE TABLE portal_requests_new (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id    INTEGER NOT NULL,
      type          TEXT    NOT NULL CHECK(type IN ('credit','renewal_stop','renewal_resume')),
      target_serial TEXT    NOT NULL DEFAULT '',
      exocad_id     TEXT    NOT NULL DEFAULT '',
      package_code  TEXT    NOT NULL DEFAULT '',
      status        TEXT    NOT NULL DEFAULT 'pending'
                            CHECK(status IN ('pending','manager_review','auto_done','approved','rejected','user_cancelled','cancel_requested')),
      note          TEXT    NOT NULL DEFAULT '',
      created_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
      processed_at  TEXT,
      FOREIGN KEY (account_id) REFERENCES portal_accounts(id) ON DELETE CASCADE
    );

    INSERT INTO portal_requests_new SELECT * FROM portal_requests;

    DROP TABLE portal_requests;

    ALTER TABLE portal_requests_new RENAME TO portal_requests;

    CREATE INDEX IF NOT EXISTS idx_pr_account ON portal_requests(account_id);
    CREATE INDEX IF NOT EXISTS idx_pr_type    ON portal_requests(type, status);
    CREATE INDEX IF NOT EXISTS idx_pr_serial  ON portal_requests(target_serial) WHERE target_serial != '';
  `);

  logger.info('[DB] Migration complete: portal_requests.status now includes user_cancelled');
}

/**
 * portal_requests.status CHECK 제약에 'cancel_requested'가 빠진 구 스키마를 마이그레이션.
 * 고객의 취소 신청은 이제 즉시 'user_cancelled'로 확정되지 않고 'cancel_requested'(매니저 승인 대기)
 * 상태를 거치므로 이 값이 제약에 없으면 동일하게 CHECK constraint 위반(500)이 발생한다.
 */
function migratePortalRequestsCancelRequested(): void {
  const row = db
    .prepare("SELECT sql FROM sqlite_schema WHERE name='portal_requests' AND type='table'")
    .get() as { sql: string } | undefined;

  if (!row) return;                                  // 테이블 자체가 없으면 createPortalTables()가 처리
  if (row.sql.includes("'cancel_requested'")) return; // 이미 올바른 제약 보유

  logger.info('[DB] Migrating portal_requests: adding cancel_requested status...');

  db.exec(`
    CREATE TABLE portal_requests_new (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id    INTEGER NOT NULL,
      type          TEXT    NOT NULL CHECK(type IN ('credit','renewal_stop','renewal_resume')),
      target_serial TEXT    NOT NULL DEFAULT '',
      exocad_id     TEXT    NOT NULL DEFAULT '',
      package_code  TEXT    NOT NULL DEFAULT '',
      status        TEXT    NOT NULL DEFAULT 'pending'
                            CHECK(status IN ('pending','manager_review','auto_done','approved','rejected','user_cancelled','cancel_requested')),
      note          TEXT    NOT NULL DEFAULT '',
      created_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
      processed_at  TEXT,
      FOREIGN KEY (account_id) REFERENCES portal_accounts(id) ON DELETE CASCADE
    );

    INSERT INTO portal_requests_new SELECT * FROM portal_requests;

    DROP TABLE portal_requests;

    ALTER TABLE portal_requests_new RENAME TO portal_requests;

    CREATE INDEX IF NOT EXISTS idx_pr_account ON portal_requests(account_id);
    CREATE INDEX IF NOT EXISTS idx_pr_type    ON portal_requests(type, status);
    CREATE INDEX IF NOT EXISTS idx_pr_serial  ON portal_requests(target_serial) WHERE target_serial != '';
  `);

  logger.info('[DB] Migration complete: portal_requests.status now includes cancel_requested');
}

function addPendingOrdersReviewFlag(): void {
  const columns = db.prepare('PRAGMA table_info(pending_orders)').all() as { name: string }[];
  if (columns.some(c => c.name === 'review_flag')) return;
  db.exec(`ALTER TABLE pending_orders ADD COLUMN review_flag TEXT NOT NULL DEFAULT ''`);
  logger.info('[DB] Migration complete: pending_orders.review_flag added');
}

function addCustomersAiCredits(): void {
  const columns = db.prepare('PRAGMA table_info(customers)').all() as { name: string }[];
  if (columns.some(c => c.name === 'ai_credits')) return;
  db.exec(`ALTER TABLE customers ADD COLUMN ai_credits INTEGER NOT NULL DEFAULT 0`);
  logger.info('[DB] Migration complete: customers.ai_credits added');
}

function createCustomerCreditLogsTable(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS customer_credit_logs (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id   INTEGER NOT NULL,
      credits       INTEGER NOT NULL DEFAULT 0,
      purchase_date TEXT NOT NULL DEFAULT '',
      source        TEXT NOT NULL DEFAULT '',
      pending_id    INTEGER,
      created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
      FOREIGN KEY (pending_id)  REFERENCES pending_orders(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_credit_logs_customer
      ON customer_credit_logs(customer_id, created_at DESC);
  `);
}

const migrations: Migration[] = [
  {
    version: 1,
    name: 'activity_logs severity critical',
    run: migrateSeverityConstraint,
  },
  {
    version: 2,
    name: 'inbound_mails request classifications',
    run: migrateInboundClassificationConstraint,
  },
  {
    version: 3,
    name: 'inbound_mails message_id unique index',
    run: ensureInboundMessageIdUniqueIndex,
  },
  {
    version: 4,
    name: 'pending_orders source_id unique index',
    run: createPendingOrderSourceUniqueIndex,
  },
  {
    version: 5,
    name: 'serial mail notice logs',
    run: createSerialMailNoticeLogsTable,
  },
  {
    version: 6,
    name: 'auto renewal order notice logs',
    run: createAutoRenewalOrderNoticeLogsTable,
  },
  {
    version: 7,
    name: 'portal tables',
    run: createPortalTables,
  },
  {
    version: 8,
    name: 'portal_accounts customer_mismatch column',
    run: migratePortalAccountMismatch,
  },
  {
    version: 9,
    name: 'portal_requests user_cancelled status',
    run: migratePortalRequestsUserCancelled,
  },
  {
    version: 10,
    name: 'portal_requests cancel_requested status',
    run: migratePortalRequestsCancelRequested,
  },
  {
    version: 11,
    name: 'pending_orders review_flag column',
    run: addPendingOrdersReviewFlag,
  },
  {
    version: 12,
    name: 'customers ai_credits column',
    run: addCustomersAiCredits,
  },
  {
    version: 13,
    name: 'customer_credit_logs table',
    run: createCustomerCreditLogsTable,
  },
];

function runMigrations(): void {
  const currentVersion = getUserVersion();
  if (currentVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `Database schema version ${currentVersion} is newer than supported version ${CURRENT_SCHEMA_VERSION}`
    );
  }

  // 자가 치유: user_version이 이미 2 이상으로 기록된 DB라도(예: 레거시 DB를 리네임해
  // 가져온 경우) inbound_mails 테이블이 실제로는 구버전 컬럼 구성일 수 있다.
  // 이 함수는 자체적으로 idempotent(이미 정상이면 즉시 return)하므로 버전 게이팅과
  // 무관하게 매 부팅 시 호출해 실제 스키마를 검증/복구한다.
  migrateInboundClassificationConstraint();

  for (const migration of migrations) {
    if (migration.version <= currentVersion) continue;
    logger.info(`[DB] Running migration ${migration.version}: ${migration.name}`);
    migration.run();
    setUserVersion(migration.version);
  }

  if (getUserVersion() < CURRENT_SCHEMA_VERSION) {
    setUserVersion(CURRENT_SCHEMA_VERSION);
  }
}

export function initDatabase(): Database.Database {
  const renamed = detectAndRenameLegacy();

  const dbPath = getDbPath();
  logger.info(`[DB] Using path: ${dbPath}`);
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  createTables();
  runMigrations();

  // 레거시 DB 존재 알림 (settings에 기록 — 첫 실행만).
  // 일회성 settings key는 이후 재사용 가능하도록 삭제하거나 덮어쓰지 않는다.
  if (renamed || fs.existsSync(getLegacyDbPath())) {
    db.prepare(
      "INSERT OR IGNORE INTO settings (key, value) VALUES ('legacy_import_available', 'true')"
    ).run();
  }

  return db;
}

export function initDatabaseForTesting(): Database.Database {
  if (db) {
    db.close();
  }

  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');

  createTables();
  runMigrations();

  return db;
}

function createTables(): void {
  db.exec(`
    -- =========================================================
    -- customers  (NEW — primary entity)
    -- =========================================================
    CREATE TABLE IF NOT EXISTS customers (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT NOT NULL,
      email         TEXT NOT NULL DEFAULT '',
      phone         TEXT NOT NULL DEFAULT '',
      address       TEXT NOT NULL DEFAULT '',
      dealer        TEXT NOT NULL DEFAULT '',
      sales_manager TEXT NOT NULL DEFAULT '',
      notes         TEXT NOT NULL DEFAULT '',
      ai_credits    INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_customers_name   ON customers(name);
    CREATE INDEX IF NOT EXISTS idx_customers_email  ON customers(email);
    CREATE INDEX IF NOT EXISTS idx_customers_phone  ON customers(phone);
    CREATE INDEX IF NOT EXISTS idx_customers_dealer ON customers(dealer);
    CREATE INDEX IF NOT EXISTS idx_customers_sales_manager ON customers(sales_manager);

    -- =========================================================
    -- serials  (REDESIGNED — customer_* 컬럼 제거, customer_id FK)
    -- =========================================================
    CREATE TABLE IF NOT EXISTS serials (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      serial_number          TEXT NOT NULL UNIQUE,
      customer_id            INTEGER NOT NULL,
      purchase_date          TEXT,
      expiry_date            TEXT,
      status                 TEXT NOT NULL DEFAULT 'not-activated'
        CHECK(status IN ('active','cancelled','expired','not-activated','broken')),
      engine_build           TEXT NOT NULL DEFAULT '',
      version                TEXT NOT NULL DEFAULT '',
      main_product           TEXT NOT NULL DEFAULT '',
      modules                TEXT NOT NULL DEFAULT '[]',
      notes                  TEXT NOT NULL DEFAULT '',
      renewal_stop_requested INTEGER NOT NULL DEFAULT 0
        CHECK(renewal_stop_requested IN (0,1)),
      stop_requested_at      TEXT,
      activated_at           TEXT,
      created_at             TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at             TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS idx_serials_customer ON serials(customer_id);
    CREATE INDEX IF NOT EXISTS idx_serials_expiry   ON serials(expiry_date);
    CREATE INDEX IF NOT EXISTS idx_serials_status   ON serials(status);
    CREATE INDEX IF NOT EXISTS idx_serials_stop     ON serials(renewal_stop_requested, expiry_date);
    CREATE INDEX IF NOT EXISTS idx_serials_number   ON serials(serial_number);
    CREATE INDEX IF NOT EXISTS idx_serials_status_expiry_id ON serials(status, expiry_date, id);
    CREATE INDEX IF NOT EXISTS idx_serials_customer_status_expiry ON serials(customer_id, status, expiry_date);

    -- =========================================================
    -- activity_logs  (REDESIGNED — actor/diff/trigger_id/severity)
    -- =========================================================
    CREATE TABLE IF NOT EXISTS activity_logs (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      serial_id  INTEGER,
      action     TEXT NOT NULL CHECK(action IN (
                   'registered','renewed','cancelled','addon_added',
                   'activated','stop_requested','stop_cleared',
                   'status_forced_expired','bulk_imported','customer_merged',
                   'legacy_imported','mail_sent','mail_failed','cron_ran','system'
                 )),
      actor      TEXT NOT NULL DEFAULT 'system'
                   CHECK(actor IN ('manual','auto','email','polling','system')),
      diff       TEXT NOT NULL DEFAULT '{}',
      details    TEXT NOT NULL DEFAULT '',
      trigger_id TEXT,
      severity   TEXT NOT NULL DEFAULT 'info'
                   CHECK(severity IN ('info','warn','error','critical')),
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (serial_id) REFERENCES serials(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_logs_created  ON activity_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_logs_serial   ON activity_logs(serial_id);
    CREATE INDEX IF NOT EXISTS idx_logs_action   ON activity_logs(action);
    CREATE INDEX IF NOT EXISTS idx_logs_severity ON activity_logs(severity);

    -- =========================================================
    -- mail_templates  (NEW)
    -- =========================================================
    CREATE TABLE IF NOT EXISTS mail_templates (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      code       TEXT NOT NULL UNIQUE,
      name       TEXT NOT NULL,
      subject    TEXT NOT NULL,
      body       TEXT NOT NULL,
      is_builtin INTEGER NOT NULL DEFAULT 0,
      enabled    INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    -- =========================================================
    -- inbound_mails  (NEW — 구 captured_emails + renewal_requests 대체)
    -- =========================================================
    CREATE TABLE IF NOT EXISTS inbound_mails (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id       TEXT,
      mail_from        TEXT NOT NULL,
      mail_to          TEXT NOT NULL DEFAULT '',
      subject          TEXT NOT NULL,
      body             TEXT NOT NULL,
      received_at      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      classification   TEXT NOT NULL DEFAULT 'unclassified'
                         CHECK(classification IN ('unclassified','renewal_request','stop_request_candidate','stop_request','missing_info','invalid_cancellation_response','unrelated','error')),
      matched_template TEXT,
      matched_keywords TEXT NOT NULL DEFAULT '[]',
      extracted_serial TEXT,
      linked_serial_id INTEGER,
      processed        INTEGER NOT NULL DEFAULT 0,
      missing_fields   TEXT NOT NULL DEFAULT '[]',
      template_sent_at TEXT,
      response_errors  TEXT NOT NULL DEFAULT '[]',
      response_attempt INTEGER NOT NULL DEFAULT 0,
      response_customer_name TEXT,
      admin_review     INTEGER NOT NULL DEFAULT 0,
      admin_review_resolved INTEGER NOT NULL DEFAULT 0,
      error            TEXT,
      FOREIGN KEY (linked_serial_id) REFERENCES serials(id) ON DELETE SET NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_inbound_msgid
      ON inbound_mails(message_id) WHERE message_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_inbound_class  ON inbound_mails(classification);
    CREATE INDEX IF NOT EXISTS idx_inbound_serial ON inbound_mails(linked_serial_id);

    -- =========================================================
    -- pending_orders  (UPDATED — trade_number / main_product / modules)
    -- =========================================================
    CREATE TABLE IF NOT EXISTS pending_orders (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id        TEXT NOT NULL DEFAULT '',
      source_url       TEXT NOT NULL DEFAULT '',
      trade_number     TEXT NOT NULL DEFAULT '',
      serial_number    TEXT NOT NULL DEFAULT '',
      customer_name    TEXT NOT NULL DEFAULT '',
      customer_email   TEXT NOT NULL DEFAULT '',
      customer_phone   TEXT NOT NULL DEFAULT '',
      customer_address TEXT NOT NULL DEFAULT '',
      dealer           TEXT NOT NULL DEFAULT '',
      sales_manager    TEXT NOT NULL DEFAULT '',
      purchase_date    TEXT NOT NULL DEFAULT '',
      expiry_date      TEXT NOT NULL DEFAULT '',
      engine_build     TEXT NOT NULL DEFAULT '',
      version          TEXT NOT NULL DEFAULT '',
      main_product     TEXT NOT NULL DEFAULT '',
      modules          TEXT NOT NULL DEFAULT '[]',
      order_type       TEXT NOT NULL DEFAULT 'new'
                         CHECK(order_type IN ('new','renewal','addon')),
      product_code     TEXT NOT NULL DEFAULT '',
      raw_data         TEXT NOT NULL DEFAULT '',
      status           TEXT NOT NULL DEFAULT 'pending'
                         CHECK(status IN ('pending','approved','rejected')),
      flag_duplicate   INTEGER NOT NULL DEFAULT 0,
      review_flag      TEXT NOT NULL DEFAULT '',
      notes            TEXT NOT NULL DEFAULT '',
      created_at       TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_pending_status ON pending_orders(status);
    CREATE INDEX IF NOT EXISTS idx_pending_trade  ON pending_orders(trade_number);
    CREATE INDEX IF NOT EXISTS idx_pending_serial ON pending_orders(serial_number);

    -- =========================================================
    -- serial_mail_notice_logs  (per-serial expiry notice history)
    -- =========================================================
    CREATE TABLE IF NOT EXISTS serial_mail_notice_logs (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      serial_id       INTEGER,
      serial_number   TEXT NOT NULL DEFAULT '',
      template_code   TEXT NOT NULL DEFAULT '',
      notice_kind     TEXT NOT NULL CHECK(notice_kind IN ('expiry_renewal','expiry_stop')),
      days_before     INTEGER NOT NULL,
      recipient_email TEXT NOT NULL DEFAULT '',
      status          TEXT NOT NULL CHECK(status IN ('sent','failed')),
      message         TEXT NOT NULL DEFAULT '',
      sent_at         TEXT NOT NULL,
      expires_at      TEXT NOT NULL,
      created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (serial_id) REFERENCES serials(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_notice_logs_serial_sent
      ON serial_mail_notice_logs(serial_id, sent_at DESC);
    CREATE INDEX IF NOT EXISTS idx_notice_logs_expires
      ON serial_mail_notice_logs(expires_at);

    -- =========================================================
    -- auto_renewal_order_notice_logs  (per-auto-renewal order mail history)
    -- =========================================================
    CREATE TABLE IF NOT EXISTS auto_renewal_order_notice_logs (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      serial_id            INTEGER,
      serial_number        TEXT NOT NULL DEFAULT '',
      customer_name        TEXT NOT NULL DEFAULT '',
      customer_email       TEXT NOT NULL DEFAULT '',
      main_product         TEXT NOT NULL DEFAULT '',
      modules              TEXT NOT NULL DEFAULT '[]',
      previous_expiry_date TEXT NOT NULL DEFAULT '',
      renewed_expiry_date  TEXT NOT NULL DEFAULT '',
      recipient_email      TEXT NOT NULL DEFAULT '',
      subject              TEXT NOT NULL DEFAULT '',
      html_body            TEXT NOT NULL DEFAULT '',
      status               TEXT NOT NULL CHECK(status IN ('sent','failed')),
      message              TEXT NOT NULL DEFAULT '',
      sent_at              TEXT NOT NULL,
      created_at           TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (serial_id) REFERENCES serials(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_auto_renew_order_notice_sent
      ON auto_renewal_order_notice_logs(sent_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_auto_renew_order_notice_serial
      ON auto_renewal_order_notice_logs(serial_id, sent_at DESC);
    CREATE INDEX IF NOT EXISTS idx_auto_renew_order_notice_status
      ON auto_renewal_order_notice_logs(status);

    -- =========================================================
    -- customer_credit_logs  (AI credits purchase history)
    -- =========================================================
    CREATE TABLE IF NOT EXISTS customer_credit_logs (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id   INTEGER NOT NULL,
      credits       INTEGER NOT NULL DEFAULT 0,
      purchase_date TEXT NOT NULL DEFAULT '',
      source        TEXT NOT NULL DEFAULT '',
      pending_id    INTEGER,
      created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
      FOREIGN KEY (pending_id)  REFERENCES pending_orders(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_credit_logs_customer
      ON customer_credit_logs(customer_id, created_at DESC);

    -- =========================================================
    -- settings  (UNCHANGED)
    -- =========================================================
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    );
  `);
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
    db = undefined as unknown as Database.Database;
  }
}
