const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'data', 'exocad.db');
const db = new Database(dbPath);

console.log('--- Last 5 Pending Orders (Order Polling) ---');
const orders = db.prepare('SELECT id, source_id, created_at, status FROM pending_orders ORDER BY created_at DESC LIMIT 5').all();
console.table(orders);

console.log('--- Last 5 Renewal Requests (Mail Reception) ---');
const renewals = db.prepare('SELECT id, serial_id, created_at, processed FROM renewal_requests ORDER BY created_at DESC LIMIT 5').all();
console.table(renewals);

console.log('--- Current Settings for Scheduling ---');
const settingsRows = db.prepare('SELECT key, value FROM settings WHERE key IN ("mail_check_times", "poll_sources")').all();
settingsRows.forEach(row => {
    console.log(`${row.key}: ${row.value}`);
});

db.close();
