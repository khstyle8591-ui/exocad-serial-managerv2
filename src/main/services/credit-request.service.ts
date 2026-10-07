import { getSettings } from '../settings';
import { getPortalRequestById, findAccountById, getAccountLinks } from '../../server/portal/db';
import { getCustomerById } from './customer.service';
import { sendTemplate } from './mail/smtp.service';
import { logActivity, pickLang } from './activity-log.service';
import { logger } from '../utils/logger';

/**
 * 크레딧 신청 승인 시 지정 메일로 발주서(청구 요청) 메일을 발송 + 활동 로그 기록.
 * 매니저 수동 승인(actor='manual')과 자동배분 성공 후 자동승인(actor='auto') 양쪽에서 공용으로 쓰인다.
 * status 전이는 호출자가 처리한다(이 함수는 메일/로그만 담당).
 */
export async function sendCreditInvoiceMail(requestId: number, actor: 'manual' | 'auto'): Promise<void> {
  const request = getPortalRequestById(requestId);
  if (!request) {
    logger.warn(`[credit-invoice] request #${requestId} not found — skip`);
    return;
  }

  const settings = getSettings();
  if (settings.credit_notification_email) {
    const pkg = settings.credit_packages.find(p => p.id === request.package_code);
    const account = findAccountById(request.account_id);
    if (account) {
      // 연결된 고객이 여러 개면 가장 먼저 연결된 것을 기준으로 한다(sync.ts의 동기화 기준과 동일).
      const link = getAccountLinks(request.account_id)[0];
      const customer = link ? getCustomerById(link.customer_id) : undefined;

      await sendTemplate('portal_credit_notify_admin', settings.credit_notification_email, {
        REQUEST_ID: String(requestId),
        ACCOUNT_NAME: account.name,
        CUSTOMER_NAME: customer?.name || account.name,
        ADDRESS: customer?.address || account.address,
        LOGIN_ID: account.login_id,
        EMAIL: account.email,
        EXOCAD_ID: request.exocad_id,
        PACKAGE_LABEL: pkg?.label || request.package_code,
        PACKAGE_QTY: pkg ? String(pkg.quantity) : '',
        PACKAGE_PRICE: pkg ? String(pkg.price) : '',
      }).catch(() => {});
    }
  } else {
    logger.warn(`[credit-invoice] request #${requestId} approved but credit_notification_email is not configured — invoice mail skipped`);
  }

  logActivity({
    action: 'system', actor: actor === 'auto' ? 'auto' : 'manual', severity: 'info',
    details: pickLang({
      ko: actor === 'auto'
        ? `포털 크레딧 신청(#${requestId}) 자동배분 성공 → 자동 승인 — 발주서 메일 발송`
        : `포털 크레딧 신청(#${requestId}) 관리자 승인 — 발주서 메일 발송`,
      en: actor === 'auto'
        ? `Portal credit request (#${requestId}) auto-approved after successful distribution — invoice mail sent`
        : `Portal credit request (#${requestId}) approved by manager — invoice mail sent`,
      ja: actor === 'auto'
        ? `ポータルクレジット申請(#${requestId})自動配分成功により自動承認 — 発注書メール送信`
        : `ポータルクレジット申請(#${requestId})管理者により承認 — 発注書メール送信`,
    }),
  });
}
