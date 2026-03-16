const Database = require('better-sqlite3');
const path = require('path');
const dbPath = path.join(__dirname, 'data', 'exocad.db');
const db = new Database(dbPath);
const logs = db.prepare('SELECT * FROM activity_logs WHERE action = "cancelled" ORDER BY created_at DESC LIMIT 5').all();
console.table(logs);
db.close();
