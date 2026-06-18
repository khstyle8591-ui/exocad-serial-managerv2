import { Router } from 'express';
import type { Request, Response } from 'express';
import { requirePortalAuth, requireCsrf, type PortalRequest } from '../middleware';
import {
  findAccountById,
  isSerialLinked,
  createPortalRequest,
  updatePortalRequestStatus,
  getPortalRequestsByAccount,
} from '../db';
import { serialService } from '../../../main/services/serial.service';
import { cancelService } from '../../../main/services/cancel.service';
import { sendCancelCompleteNotice } from '../../../main/services/mail/lifecycle-notice.service';
import { sendTemplate } from '../../../main/services/mail/smtp.service';
import { getSettings } from '../../../main/settings';

const router = Router();

// ── 소유권 검증 헬퍼 ──────────────────────────────────────────────────────────

function resolveOwnedSerial(accountId: number, serialNumber: string) {
  const serial = serialService.getBySerialNumber(serialNumber.trim());
  if (!serial) return { error: '시리얼을 찾을 수 없습니다.' };
  if (!isSerialLinked(accountId, serial.customer_id)) {
    return { error: '본인 소유의 시리얼이 아닙니다.' };
  }
  return { serial };
}

// ── 만료 윈도우 판정 (오늘 / 내일, Asia/Tokyo 기준) ──────────────────────────

function isInFailsafeWindow(expiryDate: string): boolean {
  const toTokyo = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return expiryDate === toTokyo(today) || expiryDate === toTokyo(tomorrow);
}

// ── GET /portal/requests — 내 신청 이력 ──────────────────────────────────────

router.get('/', requirePortalAuth, (req: Request, res: Response) => {
  const pr = req as PortalRequest;
  const rows = getPortalRequestsByAccount(pr.portalSession!.account_id);
  res.json({ requests: rows });
});

// ── POST /portal/requests/credit — 크레딧 신청 ──────────────────────────────

router.post('/credit', requirePortalAuth, requireCsrf, async (req: Request, res: Response) => {
  const pr = req as PortalRequest;
  const accountId = pr.portalSession!.account_id;
  const { exocad_id, package_code } = req.body as Record<string, string>;

  if (!exocad_id?.trim() || !package_code?.trim()) {
    res.status(400).json({ error: '필수 항목을 입력해주세요.' });
    return;
  }

  const settings = getSettings();
  const pkg = settings.credit_packages.find(p => p.id === package_code.trim());
  if (!pkg) {
    res.status(400).json({ error: '유효하지 않은 패키지입니다.' });
    return;
  }

  const account = findAccountById(accountId);
  if (!account) { res.status(404).json({ error: 'Not found' }); return; }

  const requestId = createPortalRequest({
    account_id: accountId,
    type: 'credit',
    exocad_id: exocad_id.trim(),
    package_code: package_code.trim(),
  });

  // 자동 배분 OFF(기본) → 관리자 메일로 발송
  if (!settings.credit_auto_alloc_enabled && settings.credit_notification_email) {
    await sendTemplate('portal_credit_notify_admin', settings.credit_notification_email, {
      REQUEST_ID: String(requestId),
      ACCOUNT_NAME: account.name,
      LOGIN_ID: account.login_id,
      EMAIL: account.email,
      EXOCAD_ID: exocad_id.trim(),
      PACKAGE_LABEL: pkg.label,
      PACKAGE_QTY: String(pkg.quantity),
      PACKAGE_PRICE: String(pkg.price),
    }).catch(() => {});
  }

  // 고객 신청 확인 메일
  if (account.email) {
    await sendTemplate('portal_credit_confirm', account.email, {
      NAME: account.name,
      REQUEST_ID: String(requestId),
      EXOCAD_ID: exocad_id.trim(),
      PACKAGE_LABEL: pkg.label,
    }).catch(() => {});
  }

  res.json({ ok: true, request_id: requestId });
});

// ── POST /portal/requests/renewal-stop — 갱신 중단 요청 ─────────────────────

router.post('/renewal-stop', requirePortalAuth, requireCsrf, async (req: Request, res: Response) => {
  const pr = req as PortalRequest;
  const accountId = pr.portalSession!.account_id;
  const { target_serial } = req.body as Record<string, string>;

  if (!target_serial?.trim()) {
    res.status(400).json({ error: '시리얼을 입력해주세요.' });
    return;
  }

  const resolved = resolveOwnedSerial(accountId, target_serial);
  if ('error' in resolved) {
    res.status(400).json({ error: resolved.error });
    return;
  }
  const { serial } = resolved;

  if (serial.status === 'cancelled') {
    res.status(400).json({ error: '이미 취소된 시리얼입니다.' });
    return;
  }
  if (serial.status === 'expired') {
    res.status(400).json({ error: '이미 만료된 시리얼입니다. 재갱신 신청을 이용해주세요.' });
    return;
  }
  if (serial.renewal_stop_requested === 1) {
    // 멱등 — 이미 중단 요청 상태
    res.json({ ok: true, status: 'already_requested' });
    return;
  }

  const requestId = createPortalRequest({
    account_id: accountId,
    type: 'renewal_stop',
    target_serial: serial.serial_number,
  });

  // failsafe 윈도우 (만료 당일/익일) → 관리자 승인 없이 즉시 취소까지 수행
  // 인바운드 메일 failsafe와 동일한 처리 흐름
  let autoApplied = false;
  if (serial.expiry_date && isInFailsafeWindow(serial.expiry_date)) {
    const triggerId = `portal-req-${requestId}`;
    serialService.setStopRequested(
      serial.id,
      true,
      triggerId,
      'system',
      `포털 갱신 중단 신청(#${requestId}) — 만료 윈도우 자동 적용`,
    );
    const cancelResult = await cancelService.cancelSubscription(serial.serial_number, true);
    if (cancelResult.success && cancelResult.verified) {
      const updated = serialService.cancelSubscription(serial.id);
      if (updated) await sendCancelCompleteNotice(updated).catch(() => {});
    }
    updatePortalRequestStatus(requestId, 'auto_done');
    autoApplied = true;
  }

  const account = findAccountById(accountId);
  if (account?.email) {
    await sendTemplate('portal_renewal_stop_confirm', account.email, {
      NAME: account.name,
      SERIAL: serial.serial_number,
      REQUEST_ID: String(requestId),
      AUTO_APPLIED: autoApplied ? 'true' : 'false',
    }).catch(() => {});
  }

  res.json({ ok: true, request_id: requestId, auto_applied: autoApplied });
});

// ── POST /portal/requests/renewal-resume — 갱신 재개 요청 (접수만) ───────────

router.post('/renewal-resume', requirePortalAuth, requireCsrf, async (req: Request, res: Response) => {
  const pr = req as PortalRequest;
  const accountId = pr.portalSession!.account_id;
  const { target_serial, include_quote = 'false' } = req.body as Record<string, string>;

  if (!target_serial?.trim()) {
    res.status(400).json({ error: '시리얼을 입력해주세요.' });
    return;
  }

  const resolved = resolveOwnedSerial(accountId, target_serial);
  if ('error' in resolved) {
    res.status(400).json({ error: resolved.error });
    return;
  }
  const { serial } = resolved;

  const requestId = createPortalRequest({
    account_id: accountId,
    type: 'renewal_resume',
    target_serial: serial.serial_number,
    note: include_quote === 'true' ? 'quote_requested' : '',
  });

  const account = findAccountById(accountId);
  if (account?.email) {
    await sendTemplate('portal_renewal_resume_confirm', account.email, {
      NAME: account.name,
      SERIAL: serial.serial_number,
      REQUEST_ID: String(requestId),
      INCLUDE_QUOTE: include_quote === 'true' ? 'true' : 'false',
    }).catch(() => {});
  }

  res.json({ ok: true, request_id: requestId });
});

export default router;
