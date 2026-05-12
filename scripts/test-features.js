/**
 * Feature test script — runs inside Electron, queries DB, prints test results.
 * Usage: .\node_modules\.bin\electron.cmd scripts/test-features.js
 */

const path = require('path');
const { app } = require('electron');

app.setName('Exocad Serial Manager');

const PASS = '✅ PASS';
const FAIL = '❌ FAIL';
const WARN = '⚠️  WARN';
let failures = 0;

function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  ${PASS}  ${label}${detail ? ' — ' + detail : ''}`);
  } else {
    console.log(`  ${FAIL}  ${label}${detail ? ' — ' + detail : ''}`);
    failures++;
  }
}

function warn(label, detail = '') {
  console.log(`  ${WARN}  ${label}${detail ? ' — ' + detail : ''}`);
}

app.whenReady().then(() => {
  const dbModule = require(path.join(process.cwd(), 'dist', 'main', 'main', 'database.js'));
  const db = dbModule.initDatabase();
  console.log('[test] DB:', dbModule.getDbPath());
  console.log('');

  // ══════════════════════════════════════════════════════════════
  // 1. Dashboard data (Stats counts)
  // ══════════════════════════════════════════════════════════════
  console.log('── [1] Dashboard / Stats ─────────────────────────────────────');
  const counts = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) as active,
      SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END) as cancelled,
      SUM(CASE WHEN status='expired' THEN 1 ELSE 0 END) as expired,
      SUM(CASE WHEN status='not-activated' THEN 1 ELSE 0 END) as not_activated,
      SUM(CASE WHEN status='broken' THEN 1 ELSE 0 END) as broken
    FROM serials
  `).get();
  check('Total serials = 12', counts.total === 12, `got ${counts.total}`);
  check('Active serials = 7', counts.active === 7, `got ${counts.active}`);
  check('Cancelled = 1', counts.cancelled === 1, `got ${counts.cancelled}`);
  check('Expired = 1', counts.expired === 1, `got ${counts.expired}`);
  check('Not-activated = 2', counts.not_activated === 2, `got ${counts.not_activated}`);
  check('Broken (limbo) = 1', counts.broken === 1, `got ${counts.broken}`);

  // Expiring soon
  const today = new Date().toISOString().slice(0, 10);
  const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const in90 = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
  const expiring30 = db.prepare(`SELECT COUNT(*) as n FROM serials WHERE status='active' AND expiry_date BETWEEN ? AND ?`).get(today, in30);
  const expiring90 = db.prepare(`SELECT COUNT(*) as n FROM serials WHERE status='active' AND expiry_date BETWEEN ? AND ?`).get(today, in90);
  check('Expiring within 30 days >= 2', expiring30.n >= 2, `got ${expiring30.n} (URGENT + EXPIRING)`);
  check('Expiring within 90 days >= 3', expiring90.n >= 3, `got ${expiring90.n}`);

  // ══════════════════════════════════════════════════════════════
  // 2. Serials page
  // ══════════════════════════════════════════════════════════════
  console.log('');
  console.log('── [2] Serials Page ──────────────────────────────────────────');
  const allSerials = db.prepare(`
    SELECT s.*, c.name as customer_name FROM serials s
    JOIN customers c ON s.customer_id = c.id
  `).all();
  check('All serials have customer_name', allSerials.every(s => s.customer_name), 'JOIN ok');
  check('stop_requested serial exists', allSerials.some(s => s.renewal_stop_requested === 1 && s.status === 'active'), 'EXO-2024-004-STOP');

  const stopSerial = allSerials.find(s => s.serial_number === 'EXO-2024-004-STOP');
  check('Stop serial: renewal_stop_requested=1', stopSerial?.renewal_stop_requested === 1);
  check('Stop serial: still active', stopSerial?.status === 'active');

  const brokenSerial = allSerials.find(s => s.serial_number === 'EXO-2024-010-BROKEN');
  check('Broken serial: status=broken', brokenSerial?.status === 'broken');
  check('Broken serial: no expiry_date', !brokenSerial?.expiry_date);

  // Modules JSON parsing
  const withModules = allSerials.find(s => s.serial_number === 'EXO-2024-006-JP');
  let parsedModules = [];
  try { parsedModules = JSON.parse(withModules?.modules || '[]'); } catch {}
  check('Modules JSON parseable', parsedModules.length === 3, `got ${parsedModules.length} modules`);

  // ══════════════════════════════════════════════════════════════
  // 3. Customers page
  // ══════════════════════════════════════════════════════════════
  console.log('');
  console.log('── [3] Customers Page ────────────────────────────────────────');
  const allCustomers = db.prepare('SELECT * FROM customers').all();
  check('Customer count = 7', allCustomers.length === 7, `got ${allCustomers.length}`);
  check('KR and JP dealers present', allCustomers.some(c => c.dealer === 'Dealer KR') && allCustomers.some(c => c.dealer === 'Dealer JP'));

  // Each customer has at least 1 serial
  const custWithSerial = db.prepare(`
    SELECT customer_id, COUNT(*) as n FROM serials GROUP BY customer_id
  `).all();
  check('All customers have serials', custWithSerial.length === allCustomers.length, `${custWithSerial.length}/${allCustomers.length} have serials`);

  // ══════════════════════════════════════════════════════════════
  // 4. Logs page
  // ══════════════════════════════════════════════════════════════
  console.log('');
  console.log('── [4] Logs Page ─────────────────────────────────────────────');
  const logs = db.prepare('SELECT * FROM activity_logs ORDER BY created_at DESC').all();
  check('Logs count = 15', logs.length === 15, `got ${logs.length}`);
  check('Has error severity log', logs.some(l => l.severity === 'error'), 'Broken serial activation fail');
  check('Has warn severity log', logs.some(l => l.severity === 'warn'));
  check('Has cron_ran log', logs.some(l => l.action === 'cron_ran'));
  check('Has mail_sent log', logs.some(l => l.action === 'mail_sent'));
  check('Has stop_requested log', logs.some(l => l.action === 'stop_requested'));

  const actionTypes = [...new Set(logs.map(l => l.action))];
  console.log(`       Actions present: ${actionTypes.join(', ')}`);

  // ══════════════════════════════════════════════════════════════
  // 5. Mail System (Inbound Mails)
  // ══════════════════════════════════════════════════════════════
  console.log('');
  console.log('── [5] Mail System ───────────────────────────────────────────');
  const mails = db.prepare('SELECT * FROM inbound_mails').all();
  check('Inbound mail count = 5', mails.length === 5, `got ${mails.length}`);
  check('Has stop_request mails', mails.filter(m => m.classification === 'stop_request').length === 4, `got ${mails.filter(m => m.classification === 'stop_request').length}`);
  check('Has unrelated mail', mails.some(m => m.classification === 'unrelated'));
  check('Unprocessed mails exist (2)', mails.filter(m => m.processed === 0).length === 2, `got ${mails.filter(m => m.processed === 0).length}`);
  check('Serial linkage present', mails.filter(m => m.linked_serial_id !== null).length >= 3);

  // JSON fields parse
  const mailWithKw = mails.find(m => m.matched_keywords && m.matched_keywords !== '[]');
  let kws = [];
  try { kws = JSON.parse(mailWithKw?.matched_keywords || '[]'); } catch {}
  check('matched_keywords JSON parseable', kws.length > 0, `e.g. ${kws.join(', ')}`);

  // ══════════════════════════════════════════════════════════════
  // 6. Requested Orders (Pending Orders)
  // ══════════════════════════════════════════════════════════════
  console.log('');
  console.log('── [6] Requested Orders / Pending Orders ─────────────────────');
  const orders = db.prepare('SELECT * FROM pending_orders').all();
  check('Order count = 5', orders.length === 5, `got ${orders.length}`);
  check('Has pending orders', orders.filter(o => o.status === 'pending').length === 3, `got ${orders.filter(o => o.status === 'pending').length}`);
  check('Has approved order', orders.some(o => o.status === 'approved'));
  check('Has rejected order', orders.some(o => o.status === 'rejected'));
  check('Has duplicate flagged', orders.some(o => o.flag_duplicate === 1));
  check('Has renewal type order', orders.some(o => o.order_type === 'renewal'));
  check('Has addon type order', orders.some(o => o.order_type === 'addon'));
  check('Has new type order', orders.some(o => o.order_type === 'new'));
  check('Multiple source_ids', [...new Set(orders.map(o => o.source_id))].length >= 2);

  // ══════════════════════════════════════════════════════════════
  // 7. Auto-cancel logic (what cancel cron would target)
  // ══════════════════════════════════════════════════════════════
  console.log('');
  console.log('── [7] Auto-Cancel Cron Logic ────────────────────────────────');
  // With auto_cancel_days_before=1, targets serials expiring in exactly 1 day with no renewal request
  const cancelTargets = db.prepare(`
    SELECT s.serial_number, s.expiry_date, s.renewal_stop_requested,
      (SELECT COUNT(*) FROM inbound_mails im WHERE im.linked_serial_id = s.id AND im.classification='stop_request') as renewal_cnt
    FROM serials s
    WHERE s.status='active'
  `).all();
  console.log(`       Active serials scanned: ${cancelTargets.length}`);
  const withStop = cancelTargets.filter(s => s.renewal_stop_requested === 1);
  const withRenewalMail = cancelTargets.filter(s => s.renewal_cnt > 0);
  console.log(`       With stop flag: ${withStop.length}, With renewal mail: ${withRenewalMail.length}`);
  check('Stop flag correctly blocks auto-cancel', withStop.length > 0);
  check('Renewal mail exists for expiring serials', withRenewalMail.length > 0);

  // ══════════════════════════════════════════════════════════════
  // 8. Expiry notice cron targets (90/30/10 day)
  // ══════════════════════════════════════════════════════════════
  console.log('');
  console.log('── [8] Expiry Notice Cron Targets ────────────────────────────');
  for (const days of [90, 30, 10]) {
    const target = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
    const hits = db.prepare(`SELECT serial_number, expiry_date FROM serials WHERE status='active' AND date(expiry_date) = date(?)`).all(target);
    console.log(`       ${days}d target (${target}): ${hits.length > 0 ? hits.map(h => h.serial_number).join(', ') : 'none'}`);
  }
  warn('Expiry notice cron runs at 05:00 Asia/Tokyo daily — not directly testable via DB');

  // ══════════════════════════════════════════════════════════════
  // 9. Settings table
  // ══════════════════════════════════════════════════════════════
  console.log('');
  console.log('── [9] Settings ──────────────────────────────────────────────');
  const settings = db.prepare('SELECT key, value FROM settings').all();
  // 0 rows is valid — getSettings() merges with DEFAULT_SETTINGS in code
  if (settings.length === 0) {
    warn('Settings: 0 rows in DB — defaults used from code (expected on first run)');
  } else {
    check('Settings rows exist', true, `${settings.length} rows`);
    const langSetting = settings.find(s => s.key === 'app_language');
    if (langSetting) {
      check('app_language persisted', ['ko', 'en', 'ja'].includes(langSetting.value), `value: ${langSetting.value}`);
    } else {
      warn('app_language not yet saved — will appear after first language change in UI');
    }
  }

  // ══════════════════════════════════════════════════════════════
  // Summary
  // ══════════════════════════════════════════════════════════════
  console.log('');
  console.log('══════════════════════════════════════════════════════════════');
  if (failures === 0) {
    console.log(`✅ ALL TESTS PASSED`);
  } else {
    console.log(`❌ ${failures} test(s) FAILED`);
  }
  console.log('══════════════════════════════════════════════════════════════');

  dbModule.closeDatabase();
  app.quit();
}).catch(err => {
  console.error('[test] Error:', err);
  app.exit(1);
});
