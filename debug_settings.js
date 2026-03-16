const Database = require('better-sqlite3');
const path = require('path');
const dbPath = path.join(__dirname, 'data', 'exocad.db');
const db = new Database(dbPath);
const rows = db.prepare('SELECT key, value FROM settings WHERE key IN ("mail_check_times", "poll_sources")').all();
console.log(JSON.stringify(rows, null, 2));
db.close();
