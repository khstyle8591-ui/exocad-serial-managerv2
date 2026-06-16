import { describe, expect, it } from 'vitest';
import { timeToCron } from '../src/main/scheduler';

describe('timeToCron', () => {
  it('converts 24-hour times to cron expressions', () => {
    expect(timeToCron('09:00')).toBe('0 9 * * *');
    expect(timeToCron('23:59')).toBe('59 23 * * *');
    expect(timeToCron('00:00')).toBe('0 0 * * *');
  });

  it('converts AM/PM times to cron expressions', () => {
    expect(timeToCron('9:05 PM')).toBe('5 21 * * *');
    expect(timeToCron('12:00 AM')).toBe('0 0 * * *');
    expect(timeToCron('12:30 PM')).toBe('30 12 * * *');
  });

  it('uses 09:00 for blank input', () => {
    expect(timeToCron('')).toBe('0 9 * * *');
  });

  it('clamps out-of-range minutes and hours using current behavior', () => {
    expect(timeToCron('10:99')).toBe('59 10 * * *');
    expect(timeToCron('25:10')).toBe('10 1 * * *');
  });
});
