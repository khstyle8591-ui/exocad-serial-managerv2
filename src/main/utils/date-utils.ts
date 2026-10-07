/**
 * Returns the current date string in YYYY-MM-DD format (Asia/Tokyo timezone)
 */
export function getTodayDateString(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
}

/**
 * Returns the date string in YYYY-MM-DD format for a given Date object (Asia/Tokyo timezone)
 */
export function getDateString(date: Date): string {
  return date.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
}

/**
 * Returns the yesterday's date string in YYYY-MM-DD format (Asia/Tokyo timezone)
 */
export function getYesterdayDateString(): string {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return getDateString(yesterday);
}

/**
 * Returns the date string N days ago in YYYY-MM-DD format (Asia/Tokyo timezone)
 */
export function getDaysAgoDateString(days: number): string {
  const target = new Date();
  target.setDate(target.getDate() - days);
  return getDateString(target);
}

/**
 * Returns the current timestamp string in YYYY-MM-DD HH:mm:ss format (Asia/Tokyo timezone)
 */
export function getNowTimestampString(): string {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' }).replace('T', ' ');
}

/**
 * Returns the timestamp string N minutes ago in YYYY-MM-DD HH:mm:ss format (Asia/Tokyo timezone),
 * in the same format as getNowTimestampString() so it can be compared lexically against created_at columns.
 */
export function getTimestampMinutesAgoString(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000)
    .toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' })
    .replace('T', ' ');
}

/**
 * Returns the timestamp (ms) for N days ago
 */
export function getTimestampDaysAgo(days: number): number {
  return Date.now() - (days * 24 * 60 * 60 * 1000);
}
