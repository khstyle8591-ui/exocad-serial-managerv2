import { describe, expect, it } from 'vitest';
import {
  buildFieldMap,
  normalizeDate,
  resolveApprovedExpiryDate,
  resolvePollingDateRange,
} from '../src/main/services/order.service';
import type { PollSource } from '../src/shared/types';

describe('normalizeDate', () => {
  it('keeps ISO dates unchanged', () => {
    expect(normalizeDate('2026-02-20')).toBe('2026-02-20');
  });

  it('normalizes four-digit year dates with dot or slash separators', () => {
    expect(normalizeDate('2026.2.20')).toBe('2026-02-20');
    expect(normalizeDate('2026/02/20')).toBe('2026-02-20');
  });

  it('normalizes two-digit year dates with dot or slash separators', () => {
    expect(normalizeDate('26.2.20')).toBe('2026-02-20');
    expect(normalizeDate('26/02/20')).toBe('2026-02-20');
  });

  it('normalizes MM/DD/YYYY dates', () => {
    expect(normalizeDate('02/20/2026')).toBe('2026-02-20');
  });

  it('trims input before normalizing', () => {
    expect(normalizeDate(' 2026.2.20 ')).toBe('2026-02-20');
  });

  it('returns an empty string for blank or missing input', () => {
    expect(normalizeDate(undefined)).toBe('');
    expect(normalizeDate('')).toBe('');
    expect(normalizeDate('   ')).toBe('');
  });

  it('returns an empty string for invalid input', () => {
    expect(normalizeDate('not-a-date')).toBe('');
  });
});

describe('polling field map safety', () => {
  const source = (overrides: Partial<PollSource> = {}) => ({
    id: 'erp',
    name: 'ERP',
    url: 'https://example.test/orders',
    login_url: '',
    login_id: '',
    login_pw: '',
    enabled: true,
    field_serial: 'LOT',
    field_customer: '注文先',
    field_phone: '',
    field_purchase: '',
    field_expiry: '',
    field_product: '品名',
    product_filter: '',
    last_polled: '',
    ...overrides,
  }) as PollSource;

  it('keeps phone and expiry blank when the current ERP settings point at unreliable fields', () => {
    const fieldMap = buildFieldMap(source({
      field_phone: '入荷日',
      field_expiry: '出荷伝票',
    }));

    expect(fieldMap.phone).toBe('');
    expect(fieldMap.expiry).toBe('');
  });

  it('does not invent an expiry field when no polling expiry column is configured', () => {
    expect(buildFieldMap(source()).expiry).toBe('');
  });
});

describe('resolveApprovedExpiryDate', () => {
  it('keeps an explicitly collected or edited expiry date', () => {
    expect(resolveApprovedExpiryDate('2027-05-22', 'not-activated', new Date('2027-05-22T00:00:00Z')))
      .toBe('2027-05-22');
  });

  it('uses the active fallback date for an active approval without expiry data', () => {
    expect(resolveApprovedExpiryDate('', 'active', new Date('2027-05-22T00:00:00Z')))
      .toBe('2027-05-22');
  });

  it('keeps expiry null for a not-activated approval without expiry data', () => {
    expect(resolveApprovedExpiryDate('', 'not-activated', new Date('2027-05-22T00:00:00Z')))
      .toBeNull();
  });
});

describe('resolvePollingDateRange', () => {
  it('uses the specified polling date as a single-day ERP range', () => {
    expect(resolvePollingDateRange('2026-04-10', '2026-05-22')).toEqual({
      startDate: '2026-04-10',
      endDate: '2026-04-10',
    });
  });

  it('uses the default polling date as a single-day ERP range for automatic polling', () => {
    expect(resolvePollingDateRange(undefined, '2026-05-22')).toEqual({
      startDate: '2026-05-22',
      endDate: '2026-05-22',
    });
  });
});
