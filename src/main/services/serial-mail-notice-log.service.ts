import { getDb } from '../database';
import { getNowTimestampString } from '../utils/date-utils';
import type { SerialMailNoticeLog } from '../../shared/types';

type NoticeInput = {
  serial_id: number;
  serial_number: string;
  template_code: string;
  notice_kind: SerialMailNoticeLog['notice_kind'];
  days_before: number;
  recipient_email: string;
  status: SerialMailNoticeLog['status'];
  message?: string;
};

function addYears(timestamp: string, years: number): string {
  const date = new Date(timestamp.replace(' ', 'T') + '+09:00');
  date.setFullYear(date.getFullYear() + years);
  return date.toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' }).replace('T', ' ');
}

export function logSerialMailNotice(input: NoticeInput): number {
  const sentAt = getNowTimestampString();
  const expiresAt = addYears(sentAt, 1);
  const result = getDb()
    .prepare(`
      INSERT INTO serial_mail_notice_logs
        (serial_id, serial_number, template_code, notice_kind, days_before,
         recipient_email, status, message, sent_at, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      input.serial_id,
      input.serial_number,
      input.template_code,
      input.notice_kind,
      input.days_before,
      input.recipient_email,
      input.status,
      input.message ?? '',
      sentAt,
      expiresAt,
      sentAt,
    );
  return result.lastInsertRowid as number;
}

export function listSerialMailNoticeLogs(serialId: number, limit = 50): SerialMailNoticeLog[] {
  return getDb()
    .prepare(`
      SELECT *
      FROM serial_mail_notice_logs
      WHERE serial_id = ?
      ORDER BY datetime(sent_at) DESC, id DESC
      LIMIT ?
    `)
    .all(serialId, limit) as SerialMailNoticeLog[];
}

export function deleteExpiredSerialMailNoticeLogs(): number {
  const result = getDb()
    .prepare("DELETE FROM serial_mail_notice_logs WHERE datetime(expires_at) < datetime('now', 'localtime')")
    .run();
  return result.changes;
}
