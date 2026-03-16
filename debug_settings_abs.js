const Database = require('better-sqlite3');
const dbPath = "C:\\Users\\pf-5y\\OneDrive\\Desktop\\Project\\exocad-manager\\data\\exocad.db";
try {
    const db = new Database(dbPath);
    const rows = db.prepare('SELECT key, value FROM settings WHERE key IN ("mail_check_times", "poll_sources")').all();
    console.log(JSON.stringify(rows, null, 2));
    db.close();
} catch (e) {
    console.error('ERROR MESSAGE:', e.message);
    console.error('ERROR CODE:', e.code);
}
