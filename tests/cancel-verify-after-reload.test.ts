import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/main/services/playwright-waits', () => ({
  waitForSettledPage: vi.fn().mockResolvedValue(undefined),
  waitForVisible: vi.fn().mockResolvedValue(undefined),
  shortPause: vi.fn().mockResolvedValue(undefined),
}));

import { cancelService } from '../src/main/services/cancel.service';

const SERIAL = 'AAAAAAAA-BBBB-CCCCCCCC';
const POLL_ATTEMPTS = 5; // verifyCancelResult polls this many times before reloading

describe('verifyCancelResult after reload', () => {
  const svc = cancelService as any;
  let order: string[];
  let page: any;

  // readStatusCells: first POLL_ATTEMPTS calls = pre-reload polling (cancel not visible yet),
  // the next call = the read after reload (+ re-search).
  function stub(afterReload: string[] | Error, searchFails = false) {
    let reads = 0;
    vi.spyOn(svc, 'readStatusCells').mockImplementation(async () => {
      reads += 1;
      order.push('read');
      if (reads <= POLL_ATTEMPTS) return ['active', 'license'];
      if (afterReload instanceof Error) throw afterReload;
      return afterReload;
    });
    vi.spyOn(svc, 'searchSerial').mockImplementation(async () => {
      order.push('search');
      if (searchFails) throw new Error('search input not found');
    });
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    order = [];
    page = { reload: vi.fn().mockImplementation(async () => { order.push('reload'); }) };
  });

  it('searches for the serial again after reload, before reading the status', async () => {
    stub(['opted out']);
    const result = await svc.verifyCancelResult(page, SERIAL);

    const afterReload = order.slice(order.indexOf('reload'));
    expect(afterReload).toEqual(['reload', 'search', 'read']);
    expect(result).toEqual({ verified: true, status: 'opted out' });
  });

  it('does not treat a missing row as success when the re-search itself fails', async () => {
    stub([], true); // would have returned [] → "row_removed" success without the re-search guard
    const result = await svc.verifyCancelResult(page, SERIAL);

    expect(result.verified).toBe(false);
    expect(result.status).toMatch(/^error:/);
    expect(result.status).not.toBe('row_removed');
  });

  it('still reports unverified when the re-searched row shows a non-cancelled status', async () => {
    stub(['active', 'license']);
    const result = await svc.verifyCancelResult(page, SERIAL);
    expect(result.verified).toBe(false);
  });
});
