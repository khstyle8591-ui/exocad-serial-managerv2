const path = require('path');

const databaseModulePath = path.join(__dirname, '..', 'dist', 'main', 'main', 'database.js');
const { closeDatabase, getDb, initDatabaseForTesting, CURRENT_SCHEMA_VERSION } = require(databaseModulePath);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertContainsAll(actual, expected, label) {
  const missing = expected.filter(item => !actual.includes(item));
  assert(missing.length === 0, `${label} missing: ${missing.join(', ')}`);
}

function tableNames() {
  return getDb()
    .prepare("SELECT name FROM sqlite_schema WHERE type = 'table'")
    .all()
    .map(row => row.name);
}

function columnNames(table) {
  return getDb()
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map(row => row.name);
}

function indexNames(table) {
  return getDb()
    .prepare(`PRAGMA index_list(${table})`)
    .all()
    .map(row => row.name);
}

function runIsolated(name, fn) {
  initDatabaseForTesting();
  try {
    fn();
    console.log(`[db-schema] PASS ${name}`);
  } finally {
    closeDatabase();
  }
}

function main() {
  runIsolated('creates the core application tables', () => {
    assertContainsAll(tableNames(), [
      'customers',
      'serials',
      'activity_logs',
      'mail_templates',
      'inbound_mails',
      'pending_orders',
      'settings',
    ], 'tables');
  });

  runIsolated('creates inbound mail classification columns', () => {
    assertContainsAll(columnNames('inbound_mails'), [
      'classification',
      'missing_fields',
      'template_sent_at',
      'extracted_serial',
      'linked_serial_id',
    ], 'inbound_mails columns');
  });

  runIsolated('creates inbound mail lookup indexes', () => {
    assertContainsAll(indexNames('inbound_mails'), [
      'idx_inbound_msgid',
      'idx_inbound_class',
      'idx_inbound_serial',
    ], 'inbound_mails indexes');
  });

  runIsolated('sets the schema user_version to the current migration version', () => {
    assert(
      getDb().pragma('user_version', { simple: true }) === CURRENT_SCHEMA_VERSION,
      `expected user_version = ${CURRENT_SCHEMA_VERSION}`
    );
  });

  runIsolated('can initialize a fresh in-memory database repeatedly', () => {
    initDatabaseForTesting();
    assert(tableNames().includes('inbound_mails'), 'expected inbound_mails after repeated init');
    assert(
      getDb().pragma('user_version', { simple: true }) === CURRENT_SCHEMA_VERSION,
      `expected user_version = ${CURRENT_SCHEMA_VERSION} after repeated init`
    );
  });

  console.log('[db-schema] All schema checks passed');
}

try {
  main();
} catch (error) {
  console.error(`[db-schema] FAIL ${error instanceof Error ? error.stack || error.message : String(error)}`);
  try {
    closeDatabase();
  } catch {
    // ignore cleanup errors
  }
  process.exit(1);
}
