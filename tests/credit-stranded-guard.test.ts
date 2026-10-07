import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

let sqliteAvailable = true;
try {
  const { initDatabaseForTesting, closeDatabase } = await import('../src/main/database');
  initDatabaseForTesting();
  closeDatabase();
} catch {
  sqliteAvailable = false;
}
const describeSqlite = sqliteAvailable ? describe : describe.skip;

describeSqlite('credit distribution stranded-guard regression', () => {
  let mods: any = {};

  beforeAll(async () => {
    const database = await import('../src/main/database');
    database.initDatabaseForTesting();
    mods = {
      database,
      settings: await import('../src/main/settings'),
      cancel: await import('../src/main/services/cancel.service'),
      portalDb: await import('../src/server/portal/db'),
      automation: await import('../src/main/services/automation.service'),
      notification: await import('../src/main/services/notification.service'),
      browser: await import('../src/main/services/playwright-browser'),
    };
    vi.spyOn(mods.notification.notificationService, 'sendCriticalAutomationAlert').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(() => {
    mods.database?.closeDatabase();
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
