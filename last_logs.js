const Database = require('better-sqlite3');
const path = require('path');
const dbPath = path.join(__dirname, 'data', 'exocad.db');
const db = new Database(dbPath);
try {
    const logs = db.prepare('SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT 10').all();
    console.log('--- Recent Activity Logs ---');
    console.log(JSON.stringify(logs, null, 2));
} catch (e) {
    console.error('Error:', e.message);
}
db.close();
