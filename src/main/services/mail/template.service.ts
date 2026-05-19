import { getDb } from '../../database';
import { getNowTimestampString } from '../../utils/date-utils';
import { renderTemplate, type TemplateVars } from './renderer';
import type { MailTemplate, MailTemplateUpsert } from '../../../shared/types';

const BUILTIN_TEMPLATES: Array<{ code: string; name: string; subject: string; body: string; enabled: boolean }> = [
  {
    code: 'renewal_reminder',
    name: '更新のご案内',
    subject: '【ご案内】{{SERIAL_NUMBER}} のライセンス更新のご案内',
    body: `{{CUSTOMER_NAME}} 様

いつもお世話になっております。
ご使用中のライセンスの有効期限が近づいておりますので、ご案内申し上げます。

■ シリアルナンバー：{{SERIAL_NUMBER}}
■ 製品名：{{MAIN_PRODUCT}}
■ Add-on：{{MODULES}}
■ 有効期限：{{EXPIRY_DATE}}

継続してご利用される場合は、お早めにお手続きをお願い申し上げます。
ご不明な点がございましたら、担当者（{{SALES_MANAGER}}）までお気軽にお問い合わせください。

どうぞよろしくお願いいたします。`,
    enabled: true,
  },
  {
    code: 'expiry_notice',
    name: '有効期限のお知らせ',
    subject: '【重要】{{SERIAL_NUMBER}} のライセンス有効期限のお知らせ',
    body: `{{CUSTOMER_NAME}} 様

いつもお世話になっております。

ご使用中のライセンス（{{SERIAL_NUMBER}}）の有効期限が本日をもって終了いたします。

■ シリアルナンバー：{{SERIAL_NUMBER}}
■ 有効期限：{{EXPIRY_DATE}}
■ 製品名：{{MAIN_PRODUCT}}
■ Add-on：{{MODULES}}

引き続きご利用をご希望の場合は、担当者（{{SALES_MANAGER}}）までご連絡ください。

どうぞよろしくお願いいたします。`,
    enabled: true,
  },
  {
    code: 'stop_expiry_reminder',
    name: '更新停止ライセンス有効期限のご案内',
    subject: '【ご案内】{{SERIAL_NUMBER}} のライセンス有効期限について',
    body: `{{CUSTOMER_NAME}} 様

いつもお世話になっております。

更新停止のご依頼をいただいているライセンスの有効期限が近づいておりますので、ご案内申し上げます。

■ シリアルナンバー：{{SERIAL_NUMBER}}
■ 有効期限：{{EXPIRY_DATE}}
■ 製品名：{{MAIN_PRODUCT}}
■ Add-on：{{MODULES}}

有効期限後はライセンスの継続利用ができなくなる場合があります。
ご不明な点がございましたら、担当者（{{SALES_MANAGER}}）までご連絡ください。

どうぞよろしくお願いいたします。`,
    enabled: true,
  },
  {
    code: 'stop_request_received',
    name: '更新停止リクエスト受付',
    subject: '【受付完了】{{SERIAL_NUMBER}} の更新停止リクエストについて',
    body: `{{CUSTOMER_NAME}} 様

いつもお世話になっております。

ご利用中のライセンスについて、更新停止リクエストを受け付けました。

■ シリアルナンバー：{{SERIAL_NUMBER}}
■ 製品名：{{MAIN_PRODUCT}}
■ 有効期限：{{EXPIRY_DATE}}
■ 受付日：{{TODAY}}

有効期限に合わせてサブスクリプション停止手続きを進めます。
内容に誤りがある場合や更新継続をご希望の場合は、担当者（{{SALES_MANAGER}}）までご連絡ください。

どうぞよろしくお願いいたします。`,
    enabled: true,
  },
  {
    code: 'missing_info_request',
    name: '更新停止リクエスト情報確認',
    subject: '【確認依頼】更新停止リクエストに必要な情報について',
    body: `{{CUSTOMER_NAME}} 様

いつもお世話になっております。

更新停止リクエストの確認に必要な情報が不足しているため、以下の内容をご返信ください。

■ 不足している情報：{{MISSING_FIELDS}}
■ 対象メール件名：{{RECEIVED_SUBJECT}}
■ 検出済みシリアル：{{DETECTED_SERIAL}}

必要情報：
・シリアルナンバー
・更新停止をご希望であることが分かる文面

どうぞよろしくお願いいたします。`,
    enabled: true,
  },
  {
    code: 'cancel_confirmation',
    name: 'キャンセル確認',
    subject: '【確認】{{SERIAL_NUMBER}} のサブスクリプションキャンセルについて',
    body: `{{CUSTOMER_NAME}} 様

いつもお世話になっております。

ご依頼いただきましたサブスクリプションのキャンセルが完了いたしました。

■ シリアルナンバー：{{SERIAL_NUMBER}}
■ 製品名：{{MAIN_PRODUCT}}
■ 処理日：{{TODAY}}

ご利用いただきありがとうございました。
またのご利用をお待ちしております。

どうぞよろしくお願いいたします。`,
    enabled: true,
  },
];

export function seedBuiltinTemplates(): void {
  const db = getDb();
  for (const t of BUILTIN_TEMPLATES) {
    db.prepare(`
      INSERT OR IGNORE INTO mail_templates (code, name, subject, body, is_builtin, enabled)
      VALUES (?, ?, ?, ?, 1, ?)
    `).run(t.code, t.name, t.subject, t.body, t.enabled ? 1 : 0);
  }
}

export function listTemplates(): MailTemplate[] {
  return getDb()
    .prepare('SELECT * FROM mail_templates ORDER BY is_builtin DESC, name ASC')
    .all() as MailTemplate[];
}

export function getTemplate(code: string): MailTemplate | undefined {
  return getDb()
    .prepare('SELECT * FROM mail_templates WHERE code = ?')
    .get(code) as MailTemplate | undefined;
}

export function upsertTemplate(input: MailTemplateUpsert): MailTemplate {
  const db = getDb();
  const now = getNowTimestampString();

  if (input.id) {
    db.prepare(`
      UPDATE mail_templates
      SET name=?, subject=?, body=?, enabled=?, updated_at=?
      WHERE id=?
    `).run(input.name, input.subject, input.body, input.enabled ? 1 : 0, now, input.id);
    return db.prepare('SELECT * FROM mail_templates WHERE id=?').get(input.id) as MailTemplate;
  }

  db.prepare(`
    INSERT INTO mail_templates (code, name, subject, body, is_builtin, enabled, updated_at)
    VALUES (?, ?, ?, ?, 0, ?, ?)
    ON CONFLICT(code) DO UPDATE
      SET name=excluded.name, subject=excluded.subject,
          body=excluded.body, enabled=excluded.enabled, updated_at=excluded.updated_at
  `).run(input.code, input.name, input.subject, input.body, input.enabled ? 1 : 0, now);

  return getTemplate(input.code)!;
}

export function deleteTemplate(code: string): void {
  const t = getTemplate(code);
  if (!t) throw new Error('Template not found');
  if (t.is_builtin) throw new Error('Built-in templates cannot be deleted');
  getDb().prepare('DELETE FROM mail_templates WHERE code=?').run(code);
}

export function previewTemplate(
  code: string,
  serialId: number,
): { subject: string; body: string } {
  const template = getTemplate(code);
  if (!template) throw new Error(`Template not found: ${code}`);

  const row = getDb().prepare(`
    SELECT s.serial_number, s.expiry_date, s.purchase_date, s.main_product, s.modules,
           c.name AS c_name, c.email AS c_email,
           c.dealer AS c_dealer, c.sales_manager AS c_sm
    FROM serials s
    LEFT JOIN customers c ON s.customer_id = c.id
    WHERE s.id = ?
  `).get(serialId) as any;

  if (!row) throw new Error(`Serial not found: ${serialId}`);

  const modules: string[] = JSON.parse(row.modules || '[]');
  const today = new Date().toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' });

  const vars: TemplateVars = {
    CUSTOMER_NAME: row.c_name || '',
    CUSTOMER_EMAIL: row.c_email || '',
    SERIAL_NUMBER: row.serial_number,
    EXPIRY_DATE: row.expiry_date || '',
    PURCHASE_DATE: row.purchase_date || '',
    MAIN_PRODUCT: row.main_product || '',
    MODULES: modules.join(', '),
    TODAY: today,
    DEALER: row.c_dealer || '',
    SALES_MANAGER: row.c_sm || '',
  };

  return {
    subject: renderTemplate(template.subject, vars),
    body: renderTemplate(template.body, vars),
  };
}
