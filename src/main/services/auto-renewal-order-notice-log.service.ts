import { getDb } from '../database';
import { getNowTimestampString } from '../utils/date-utils';
import type { AutoRenewalOrderNoticeLog, SerialWithCustomer } from '../../shared/types';

type AutoRenewalOrderNoticeLogInput = {
  serial: SerialWithCustomer;
  previous_expiry_date: string | null;
  recipient_email: string;
  subject: string;
  html_body: string;
  status: AutoRenewalOrderNoticeLog['status'];
  message?: string;
};

export function logAutoRenewalOrderNotice(input: AutoRenewalOrderNoticeLogInput): number {
  const sentAt = getNowTimestampString();
  const result = getDb()
    .prepare(`
      INSERT INTO auto_renewal_order_notice_logs
        (serial_id, serial_number, customer_name, customer_email, main_product, modules,
         previous_expiry_date, renewed_expiry_date, recipient_email, subject, html_body,
         status, message, sent_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      input.serial.id,
      input.serial.serial_number,
      input.serial.customer?.name || '',
      input.serial.customer?.email || '',
      input.serial.main_product || '',
      input.serial.modules || '[]',
      input.previous_expiry_date || '',
      input.serial.expiry_date || '',
      input.recipient_email,
      input.subject,
      input.html_body,
      input.status,
      input.message || '',
      sentAt,
      sentAt,
    );
  return result.lastInsertRowid as number;
}

export function listAutoRenewalOrderNoticeLogs(limit = 100): AutoRenewalOrderNoticeLog[] {
  return getDb()
    .prepare(`
      SELECT *
      FROM auto_renewal_order_notice_logs
      ORDER BY datetime(sent_at) DESC, id DESC
      LIMIT ?
    `)
    .all(limit) as AutoRenewalOrderNoticeLog[];
}

export function getAutoRenewalOrderNoticeLog(id: number): AutoRenewalOrderNoticeLog | undefined {
  return getDb()
    .prepare('SELECT * FROM auto_renewal_order_notice_logs WHERE id = ?')
    .get(id) as AutoRenewalOrderNoticeLog | undefined;
}
