const Database = require('better-sqlite3');
const dbPath = "C:\\Users\\pf-5y\\OneDrive\\Desktop\\Project\\exocad-manager\\data\\exocad.db";
const db = new Database(dbPath);
const row = db.prepare("SELECT value FROM settings WHERE key = 'poll_sources'").get();
if (row) {
    const sources = JSON.parse(row.value);
    console.log(JSON.stringify(sources, null, 2));
} else {
    console.log('No poll_sources found in DB');
}
db.close();
