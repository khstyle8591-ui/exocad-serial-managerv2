const Database = require('better-sqlite3');
const path = require('path');
const dbPath = path.join(__dirname, 'data', 'exocad.db');
const db = new Database(dbPath);
const info = db.pragma('table_info(renewal_requests)');
console.log(info);
db.close();
