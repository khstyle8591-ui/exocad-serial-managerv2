import nodemailer from 'nodemailer';
import { getSettings } from '../../settings';
import { logger } from '../../utils/logger';
import { getTemplate } from './template.service';
import { renderTemplate, type TemplateVars } from './renderer';
import { logActivity } from '../activity-log.service';

function buildTransporter(settings: ReturnType<typeof getSettings>) {
  const port = Number(settings.smtp_port) || 587;
  const useImplicitSSL = port === 465;
  const isGmail = settings.smtp_host.toLowerCase().includes('gmail');
  const cleanPassword = settings.smtp_password.replace(/\s+/g, '');

  return nodemailer.createTransport({
    host: settings.smtp_host,
    port,
    secure: useImplicitSSL,
    requireTLS: !useImplicitSSL && (settings.smtp_tls || isGmail),
    auth: { user: settings.smtp_user, pass: cleanPassword },
    connectionTimeout: 15000,
  });
}

export async function sendTemplate(
  code: string,
  to: string,
  vars: TemplateVars,
  options?: { serial_id?: number; actor?: 'manual' | 'auto' | 'email' | 'polling' | 'system' },
): Promise<{ success: boolean; message: string }> {
  const template = getTemplate(code);
  if (!template) return { success: false, message: `Template not found: ${code}` };
  if (!template.enabled) return { success: false, message: `Template is disabled: ${code}` };

  const settings = getSettings();
  if (!settings.smtp_host || !settings.smtp_user) {
    return { success: false, message: 'SMTP が設定されていません。' };
  }

  const today = new Date().toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' });
  const fullVars: TemplateVars = { TODAY: today, ...vars };

  const subject = renderTemplate(template.subject, fullVars);
  const bodyText = renderTemplate(template.body, fullVars);
  const htmlBody = `<div style="white-space:pre-wrap;font-family:sans-serif;font-size:14px">${bodyText.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>`;

  try {
    const transporter = buildTransporter(settings);
    await transporter.sendMail({
      from: `Exocad Manager <${settings.smtp_user}>`,
      to,
      subject,
      text: bodyText,
      html: htmlBody,
    });

    logger.info(`[mail] Sent template '${code}' to ${to}`);
    await logActivity({
      serial_id: options?.serial_id ?? null,
      action: 'mail_sent',
      actor: options?.actor ?? 'manual',
      details: `template=${code} to=${to}`,
      severity: 'info',
    });

    return { success: true, message: `メール送信完了 → ${to}` };
  } catch (err: any) {
    logger.error(`[mail] Failed to send '${code}' to ${to}: ${err.message}`);
    await logActivity({
      serial_id: options?.serial_id ?? null,
      action: 'mail_failed',
      actor: options?.actor ?? 'manual',
      details: `template=${code} to=${to} error=${err.message}`,
      severity: 'error',
    });
    return { success: false, message: `送信失敗: ${err.message}` };
  }
}

export async function testSmtp(
  settingsOverride?: any,
): Promise<{ success: boolean; message: string }> {
  const cleanOverride = Object.fromEntries(
    Object.entries(settingsOverride ?? {}).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  );
  const settings = { ...getSettings(), ...cleanOverride };

  if (!settings.smtp_host) return { success: false, message: 'SMTP 서버 주소가 없습니다.' };
  if (!settings.smtp_user) return { success: false, message: 'SMTP 사용자명이 없습니다.' };
  if (!settings.smtp_password) return { success: false, message: 'SMTP 비밀번호가 없습니다.' };

  try {
    await buildTransporter(settings as ReturnType<typeof getSettings>).verify();
    logger.info('[mail] SMTP verify OK');
    return { success: true, message: 'SMTP 연결 성공' };
  } catch (err: any) {
    logger.error(`[mail] SMTP verify failed: ${err.message}`);
    return { success: false, message: `연결 실패: ${err.message}` };
  }
}

export async function sendTestDryRun(
  settingsOverride?: any,
): Promise<{ success: boolean; message: string }> {
  const cleanOverride = Object.fromEntries(
    Object.entries(settingsOverride ?? {}).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  );
  const settings = { ...getSettings(), ...cleanOverride } as ReturnType<typeof getSettings>;
  const to = settings.smtp_test_address || settings.report_email_to;

  if (!to) {
    return { success: false, message: '테스트 수신 주소(smtp_test_address)가 설정되어 있지 않습니다.' };
  }
  if (!settings.smtp_host || !settings.smtp_user || !settings.smtp_password) {
    return { success: false, message: 'SMTP 설정이 불완전합니다.' };
  }

  try {
    const transporter = buildTransporter(settings);
    const now = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
    await transporter.sendMail({
      from: `Exocad Manager <${settings.smtp_user}>`,
      to,
      subject: '[Exocad Manager] SMTP テストメール',
      text: `Exocad Manager SMTP 설정 테스트 메일입니다.\n발송 시각: ${now}`,
    });
    logger.info(`[mail] Test email sent to ${to}`);
    return { success: true, message: `테스트 메일 발송 완료 → ${to}` };
  } catch (err: any) {
    logger.error(`[mail] Test email failed: ${err.message}`);
    return { success: false, message: `발송 실패: ${err.message}` };
  }
}
