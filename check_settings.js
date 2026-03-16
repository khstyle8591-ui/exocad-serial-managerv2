const Database = require('better-sqlite3');
const path = require('path');
const dbPath = path.join(__dirname, 'data', 'exocad.db');
const db = new Database(dbPath);
const settings = db.prepare('SELECT * FROM settings').all();
console.log(JSON.stringify(settings, null, 2));
db.close();
