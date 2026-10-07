import { getDb } from '../../database';
import { getNowTimestampString } from '../../utils/date-utils';
import { getSettings } from '../../settings';
import { renderTemplate, type TemplateVars } from './renderer';
import type { MailTemplate, MailTemplateUpsert } from '../../../shared/types';

interface TemplatePreviewRow {
  serial_number: string;
  expiry_date: string | null;
  purchase_date: string | null;
  main_product: string;
  modules: string;
  c_name: string | null;
  c_email: string | null;
  c_dealer: string | null;
  c_sm: string | null;
  c_address: string | null;
}

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
    code: 'invalid_cancellation_response',
    name: '更新停止回答の再提出依頼',
    subject: '【再提出依頼】更新停止リクエストの回答内容をご確認ください',
    body: `{{CUSTOMER_NAME}} 様

いつもお世話になっております。

更新停止リクエストの回答内容を確認できませんでした。以下のエラーをご確認のうえ、回答ブロック内の各項目をご記入して再度ご返信ください。

■ エラー：{{RESPONSE_ERRORS}}
■ 検出済みシリアル：{{DETECTED_SERIAL}}
■ 対象メール件名：{{RECEIVED_SUBJECT}}

{{REPLY_TEMPLATE}}

回答ブロック以外の文章は自由に追加していただけます。
どうぞよろしくお願いいたします。`,
    enabled: true,
  },
  {
    code: 'portal_reset_password',
    name: 'パスワードリセット',
    subject: '【パスワードリセット】Exocad Portal',
    body: `{{NAME}} 様

パスワードリセットのご要望を受け付けました。
以下のリンクからパスワードの再設定をお願いいたします。

{{RESET_URL}}

このリンクは24時間有効です。
ご自身でリクエストされていない場合は、このメールを無視してください。

どうぞよろしくお願いいたします。`,
    enabled: true,
  },
  {
    code: 'portal_renewal_stop_confirm',
    name: 'ポータル更新停止受付確認',
    subject: '【受付完了】更新停止のお申し込みを受け付けました',
    body: `{{NAME}} 様

Exocad Portalより更新停止のお申し込みを受け付けました。

■ 対象シリアル：{{SERIAL}}
■ 申請番号：#{{REQUEST_ID}}
■ 受付日：{{TODAY}}

担当者よりご連絡いたします。
ご不明な点がございましたらPMまでお問い合わせください。

どうぞよろしくお願いいたします。`,
    enabled: true,
  },
  {
    code: 'portal_renewal_resume_confirm',
    name: 'ポータル更新再開受付確認',
    subject: '【受付完了】更新再開のお申し込みを受け付けました',
    body: `{{NAME}} 様

Exocad Portalより更新再開のお申し込みを受け付けました。

■ 対象シリアル：{{SERIAL}}
■ 申請番号：#{{REQUEST_ID}}
■ 見積書希望：{{INCLUDE_QUOTE}}
■ 受付日：{{TODAY}}

担当者よりご連絡いたします。
ご不明な点がございましたらPMまでお問い合わせください。

どうぞよろしくお願いいたします。`,
    enabled: true,
  },
  {
    code: 'manual_renewal_confirm',
    name: '更新完了のご案内',
    subject: '【完了】{{SERIAL_NUMBER}} のライセンス更新が完了しました',
    body: `{{CUSTOMER_NAME}} 様

いつもお世話になっております。

ご利用中のライセンスの更新が完了いたしましたので、ご案内申し上げます。

■ シリアルナンバー：{{SERIAL_NUMBER}}
■ 製品名：{{MAIN_PRODUCT}}
■ 更新前の有効期限：{{PREVIOUS_EXPIRY_DATE}}
■ 新しい有効期限：{{EXPIRY_DATE}}

引き続きご利用いただけますので、よろしくお願いいたします。
ご不明な点がございましたら、担当者（{{SALES_MANAGER}}）までお問い合わせください。

どうぞよろしくお願いいたします。`,
    enabled: true,
  },
  {
    code: 'renewal_order_notice',
    name: '更新発注書（内部通知）',
    subject: '[Exocad Manager] 更新発注書（{{RENEWAL_TYPE}}） - {{SERIAL_NUMBER}}',
    body: `以下のシリアルが{{RENEWAL_TYPE}}で更新処理されました。

■ シリアル番号：{{SERIAL_NUMBER}}
■ 顧客名：{{CUSTOMER_NAME}}
■ 顧客メール：{{CUSTOMER_EMAIL}}
■ 顧客住所：{{ADDRESS}}
■ メイン製品：{{MAIN_PRODUCT}}
■ モジュール：{{MODULES}}
■ 更新前の有効期限：{{PREVIOUS_EXPIRY_DATE}}
■ 更新後の有効期限：{{EXPIRY_DATE}}
■ 処理時刻：{{PROCESSED_AT}}

上記内容にてご請求処理をお願いいたします。`,
    enabled: true,
  },
  {
    code: 'portal_credit_notify_admin',
    name: 'クレジット発注書（承認時送付）',
    subject: '【発注書】クレジット購入のご請求について (#{{REQUEST_ID}})',
    body: `下記の内容でクレジット申請が承認されましたので、ご請求手続きをお願いいたします。

■ 申請番号：#{{REQUEST_ID}}
■ 顧客名：{{CUSTOMER_NAME}}
■ 住所：{{ADDRESS}}
■ アカウント名：{{ACCOUNT_NAME}}
■ ログインID：{{LOGIN_ID}}
■ メールアドレス：{{EMAIL}}
■ My.exocad ID：{{EXOCAD_ID}}
■ パッケージ：{{PACKAGE_LABEL}}
■ 数量：{{PACKAGE_QTY}}
■ 金額：{{PACKAGE_PRICE}}
■ 承認日：{{TODAY}}

上記内容にてご請求処理をお願いいたします。`,
    enabled: true,
  },
  {
    code: 'portal_credit_confirm',
    name: 'ポータルクレジット申請受付確認',
    subject: '【受付完了】クレジットのお申し込みを受け付けました',
    body: `{{NAME}} 様

Exocad Portalよりクレジットのお申し込みを受け付けました。

■ パッケージ：{{PACKAGE_LABEL}}
■ My.exocad ID：{{EXOCAD_ID}}
■ 申請番号：#{{REQUEST_ID}}
■ 受付日：{{TODAY}}

担当者よりご連絡いたします。
ご不明な点がございましたらPMまでお問い合わせください。

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
           c.dealer AS c_dealer, c.sales_manager AS c_sm, c.address AS c_address
    FROM serials s
    LEFT JOIN customers c ON s.customer_id = c.id
    WHERE s.id = ?
  `).get(serialId) as TemplatePreviewRow | undefined;

  if (!row) throw new Error(`Serial not found: ${serialId}`);

  const modules: string[] = JSON.parse(row.modules || '[]');
  const today = new Date().toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' });
  const pkg = getSettings().credit_packages[0];

  const vars: TemplateVars = {
    // Serial/customer-based templates — real data from the selected serial.
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

    // Portal templates address the account holder directly — reuse the same customer/serial data.
    NAME: row.c_name || '',
    SERIAL: row.serial_number,
    ADDRESS: row.c_address || '',
    EMAIL: row.c_email || '',
    DETECTED_SERIAL: row.serial_number,
    PACKAGE_LABEL: pkg?.label || '',
    PACKAGE_QTY: pkg ? String(pkg.quantity) : '',
    PACKAGE_PRICE: pkg ? String(pkg.price) : '',

    // Portal account/request fields with no serial-level source — preview-only sample values.
    REQUEST_ID: '1001',
    ACCOUNT_NAME: row.c_name || '(サンプルアカウント)',
    LOGIN_ID: 'sample_login',
    EXOCAD_ID: 'EX-000000',
    RESET_URL: 'https://example.com/reset?token=sample',
    INCLUDE_QUOTE: '希望する',
    PREVIOUS_EXPIRY_DATE: row.expiry_date || '',
    PROCESSED_AT: today,
    RENEWAL_TYPE: '手動',
    MISSING_FIELDS: 'シリアルナンバー',
    RECEIVED_SUBJECT: '（サンプル件名）',
    RESPONSE_ERRORS: '（サンプルエラー内容）',
    REPLY_TEMPLATE: '（サンプル返信テンプレート）',
  };

  return {
    subject: renderTemplate(template.subject, vars),
    body: renderTemplate(template.body, vars),
  };
}
