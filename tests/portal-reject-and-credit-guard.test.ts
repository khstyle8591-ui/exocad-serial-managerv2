import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'net';
import http from 'http';

process.env.AUTH_DISABLED = 'true'; // non-production: admin BasicAuth bypass for the test app

let sqliteAvailable = true;
try {
  const { initDatabaseForTesting, closeDatabase } = await import('../src/main/database');
  initDatabaseForTesting();
  closeDatabase();
} catch {
  sqliteAvailable = false;
}
const describeSqlite = sqliteAvailable ? describe : describe.skip;

const tokyoDate = (daysAhead: number) =>
  new Date(Date.now() + daysAhead * 86400000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });

describeSqlite('portal reject / credit stranded-guard regressions', () => {
  let server: http.Server;
  let base = '';
  let mods: any = {};

  beforeAll(async () => {
    const database = await import('../src/main/database');
    database.initDatabaseForTesting();
    const express = (await import('express')).default;
    const portalRouter = (await import('../src/server/portal/index')).default;
    mods = {
      database,
      settings: await import('../src/main/settings'),
      serial: await import('../src/main/services/serial.service'),
      cancel: await import('../src/main/services/cancel.service'),
      portalDb: await import('../src/server/portal/db'),
      mw: await import('../src/server/portal/middleware'),
      automation: await import('../src/main/services/automation.service'),
      notification: await import('../src/main/services/notification.service'),
      browser: await import('../src/main/services/playwright-browser'),
    };
    const app = express();
    app.use(express.json());
    app.use('/portal', portalRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    vi.spyOn(mods.notification.notificationService, 'sendCriticalAutomationAlert').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(() => {
    server?.close();
    mods.database?.closeDatabase();
  });

  async function submitStopRequest(serialNumber: string, login: string, expiry: string) {
    const { serial, portalDb, mw } = mods;
    const s = serial.serialService.create({
      serial_number: serialNumber, customer_name: `Clinic ${login}`, customer_email: `${login}@example.com`,
      expiry_date: expiry, status: 'active',
    });
    const accountId = portalDb.createAccount({
      login_id: login, email: `${login}@example.com`, phone: '', address: '', name: `Clinic ${login}`,
      exocad_id: '', password_hash: 'x', language: 'ko',
    });
    portalDb.createAccountLink(accountId, s.customer_id, s.serial_number);
    const { token, csrfToken } = mw.createSession(accountId);
    const submit = await fetch(`${base}/portal/requests/renewal-stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `psid=${token}`, 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ target_serial: s.serial_number }),
    }).then(r => r.json());
    return { s, requestId: submit.request_id as number, submit };
  }

  const decide = (requestId: number, action: 'approve' | 'reject') =>
    fetch(`${base}/portal/admin/requests/${requestId}/decide`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }),
    }).then(r => r.json());

  it('rejecting a portal renewal-stop request clears the stop flag, so pre-expiry auto-cancel skips the serial', async () => {
    const { settings, serial, cancel } = mods;
    settings.saveSettings({ portal_enabled: true, auto_cancel_enabled: true, auto_cancel_days_before: 30 });

    const { s, requestId, submit } = await submitStopRequest('AAAAAAAA-BBBB-CCCCCCCC', 'rejected', tokyoDate(30));
    expect(submit.ok).toBe(true);
    expect(serial.serialService.getById(s.id).renewal_stop_requested).toBe(1);

    expect((await decide(requestId, 'reject')).status).toBe('rejected');
    expect(serial.serialService.getById(s.id).renewal_stop_requested).toBe(0);

    const spy = vi.spyOn(cancel.cancelService, 'cancelSubscription')
      .mockResolvedValue({ serial_number: s.serial_number, success: true, verified: true, verified_status: 'opted out' });
    await cancel.cancelService.processPreExpiryAutoCancel();
    expect(spy).not.toHaveBeenCalledWith(s.serial_number, true);
    expect(serial.serialService.getById(s.id).status).toBe('active');
    spy.mockRestore();
  });

  it('rejecting leaves an already-cancelled serial untouched (no revival path)', async () => {
    const { settings, serial, portalDb } = mods;
    settings.saveSettings({ portal_enabled: true });
    const { s, requestId } = await submitStopRequest('DDDDDDDD-EEEE-FFFFFFFF', 'cancelled', tokyoDate(10));
    serial.serialService.cancelSubscription(s.id); // auto-cancel ran while the request was still pending
    expect(portalDb.getPortalRequestById(requestId).status).toBe('pending');

    await decide(requestId, 'reject');
    const after = serial.serialService.getById(s.id);
    expect(after.status).toBe('cancelled');
    expect(after.renewal_stop_requested).toBe(1);
  });

  function setupCreditRequest(login: string) {
    const { settings, portalDb } = mods;
    settings.saveSettings({
      credit_auto_alloc_enabled: true,
      credit_packages: [{ id: 'p100', label: '100 credits', quantity: 100, price: 1 }],
    });
    const accountId = portalDb.createAccount({
      login_id: login, email: '', phone: '', address: '', name: login, exocad_id: '', password_hash: 'x', language: 'ko',
    });
    return portalDb.createPortalRequest({ account_id: accountId, type: 'credit', exocad_id: `${login}-exocad`, package_code: 'p100' });
  }

  it('a credit request that waited >15 min for the browser slot is NOT distributed after stranded-recovery marked it failed', async () => {
    const { cancel, portalDb, automation, browser } = mods;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date());
    const reqId = setupCreditRequest('buyer-stranded');
    const distribute = vi.spyOn(cancel.cancelService as any, '_doDistributeCredits')
      .mockResolvedValue({ exocad_id: 'x', success: true, verified: true });

    // another long browser job (e.g. order polling) holds the global slot
    let release!: () => void;
    const blocker = browser.withBrowserSlot(() => new Promise<void>(r => { release = r; }));

    vi.setSystemTime(new Date(Date.now() + 6 * 60_000)); // past the 5-min grace
    const run1 = automation.runCreditAutoDistributionNow(); // claims, then queues behind the blocker
    expect(portalDb.getPortalRequestById(reqId).alloc_status).toBe('distributing');

    vi.setSystemTime(new Date(Date.now() + 16 * 60_000)); // still blocked 16 min later
    await automation.runCreditAutoDistributionNow(); // next minute tick: stranded recovery
    expect(portalDb.getPortalRequestById(reqId).alloc_status).toBe('failed');

    release();
    await blocker;
    await run1;

    expect(distribute).not.toHaveBeenCalled();
    const final = portalDb.getPortalRequestById(reqId);
    expect(final.alloc_status).toBe('failed');
    expect(final.status).toBe('pending');
    distribute.mockRestore();
  }, 30_000);

  it('a normal credit request still distributes and is approved', async () => {
    const { cancel, portalDb, automation } = mods;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date());
    const reqId = setupCreditRequest('buyer-normal');
    const distribute = vi.spyOn(cancel.cancelService as any, '_doDistributeCredits')
      .mockResolvedValue({ exocad_id: 'x', success: true, verified: true });

    vi.setSystemTime(new Date(Date.now() + 6 * 60_000));
    await automation.runCreditAutoDistributionNow();

    expect(distribute).toHaveBeenCalledTimes(1);
    const final = portalDb.getPortalRequestById(reqId);
    expect(final.alloc_status).toBe('distributed');
    expect(final.status).toBe('approved');
    distribute.mockRestore();
  }, 30_000);
});
