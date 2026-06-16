import { describe, expect, it } from 'vitest';
import { normalizeExcelDate } from '../src/main/services/excel.service';

describe('normalizeExcelDate', () => {
  it('returns null for blank or missing input', () => {
    expect(normalizeExcelDate(null)).toBeNull();
    expect(normalizeExcelDate(undefined)).toBeNull();
    expect(normalizeExcelDate('')).toBeNull();
  });

  it('keeps ISO dates unchanged', () => {
    expect(normalizeExcelDate('2026-02-20')).toBe('2026-02-20');
  });

  it('trims ISO date strings before returning them', () => {
    expect(normalizeExcelDate(' 2026-02-20 ')).toBe('2026-02-20');
  });

  it('normalizes MM/DD/YYYY dates', () => {
    expect(normalizeExcelDate('02/20/2026')).toBe('2026-02-20');
  });

  it('normalizes Excel serial dates', () => {
    expect(normalizeExcelDate(46073)).toBe('2026-02-20');
  });

  it('returns null for invalid input', () => {
    expect(normalizeExcelDate('not-a-date')).toBeNull();
  });
});
