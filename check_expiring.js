
const Database = require('better-sqlite3');
const path = require('path');
const dbPath = path.join(__dirname, 'data', 'exocad.db');
const db = new Database(dbPath);
const today = new Date().toISOString().slice(0, 10);
const expiringCount = db.prepare("SELECT COUNT(*) as count FROM serials WHERE status = 'active' AND expiry_date <= ?").get(today).count;
console.log(`Expiring serials count: ${expiringCount}`);
db.close();
