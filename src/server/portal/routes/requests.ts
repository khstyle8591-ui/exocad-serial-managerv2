import { Router } from 'express';
import type { Request, Response } from 'express';
import { requirePortalAuth, requireCsrf, type PortalRequest } from '../middleware';
import {
  findAccountById,
  isSerialLinked,
  createPortalRequest,
  updatePortalRequestStatus,
  markPortalRequestPlaywrightFailed,
  getPortalRequestsByAccount,
} from '../db';
import { serialService } from '../../../main/services/serial.service';
import { cancelService } from '../../../main/services/cancel.service';
import { sendCancelCompleteNotice } from '../../../main/services/mail/lifecycle-notice.service';
import { sendTemplate } from '../../../main/services/mail/smtp.service';
import { getSettings } from '../../../main/settings';
import { logActivity, pickLang } from '../../../main/services/activity-log.service';
import { notificationService } from '../../../main/services/notification.service';
import { logger } from '../../../main/utils/logger';

const router = Router();

const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

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

  logActivity({
    action: 'system', actor: 'system', severity: 'info',
    details: pickLang({
      ko: `포털 크레딧 신청(#${requestId}) 접수 — 계정: ${account.login_id}, 패키지: ${pkg.label}`,
      en: `Portal credit request received (#${requestId}) — account: ${account.login_id}, package: ${pkg.label}`,
      ja: `ポータルクレジット申請(#${requestId})受付 — アカウント: ${account.login_id}, パッケージ: ${pkg.label}`,
    }),
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
    // 멱등 — 이미 중단 요청 상태. 중복 시도 기록을 남겨 매니저/고객 화면에 "중복신청"으로 표시.
    // status를 즉시 'rejected'로 확정해 매니저의 처리 대기열(pending/manager_review)에 노출되지 않게 한다.
    const dupId = createPortalRequest({
      account_id: accountId,
      type: 'renewal_stop',
      target_serial: serial.serial_number,
      note: 'duplicate',
    });
    updatePortalRequestStatus(dupId, 'rejected');
    res.json({ ok: true, status: 'already_requested' });
    return;
  }

  const requestId = createPortalRequest({
    account_id: accountId,
    type: 'renewal_stop',
    target_serial: serial.serial_number,
  });

  logActivity({
    serial_id: serial.id, action: 'system', actor: 'system', severity: 'info',
    details: pickLang({
      ko: `포털 갱신 중단 신청(#${requestId}) 접수 — 시리얼: ${serial.serial_number}, 고객: ${serial.customer?.name || ''}`,
      en: `Portal renewal-stop request received (#${requestId}) — serial: ${serial.serial_number}, customer: ${serial.customer?.name || ''}`,
      ja: `ポータル更新停止申請(#${requestId})受付 — シリアル: ${serial.serial_number}, 顧客: ${serial.customer?.name || ''}`,
    }),
  });

  // 중복신청 방지를 위해 신청 접수 시점에 항상 플래그를 세움 (failsafe 윈도우 여부와 무관)
  serialService.setStopRequested(
    serial.id,
    true,
    `portal-req-${requestId}`,
    'system',
    pickLang({
      ko: `포털 갱신 중단 신청(#${requestId}) 접수됨`,
      en: `Portal renewal-stop request (#${requestId}) received`,
      ja: `ポータル更新停止申請(#${requestId})受付`,
    }),
  );

  // failsafe 윈도우 (만료 당일/익일) → 관리자 승인 없이 즉시 취소까지 수행
  // 인바운드 메일 failsafe와 동일한 처리 흐름
  let autoApplied = false;
  let processingFailed = false;
  if (serial.expiry_date && isInFailsafeWindow(serial.expiry_date)) {
    const triggerId = `portal-req-${requestId}`;
    const cancelResult = await cancelService.cancelSubscription(serial.serial_number, true);
    if (cancelResult.success && cancelResult.verified) {
      const updated = serialService.cancelSubscription(serial.id);
      if (updated) await sendCancelCompleteNotice(updated).catch(() => {});
      updatePortalRequestStatus(requestId, 'auto_done');
      autoApplied = true;
      logActivity({
        serial_id: serial.id, action: 'cancelled', actor: 'system', severity: 'info', trigger_id: triggerId,
        details: pickLang({
          ko: `포털 만료 윈도우 자동취소 성공 — 시리얼: ${serial.serial_number} (신청 #${requestId})`,
          en: `Portal expiry-window auto-cancel succeeded — serial: ${serial.serial_number} (request #${requestId})`,
          ja: `ポータル失効ウィンドウ自動キャンセル成功 — シリアル: ${serial.serial_number} (申請 #${requestId})`,
        }),
      });
    } else {
      processingFailed = true;
      markPortalRequestPlaywrightFailed(requestId);
      const reason = cancelResult.error || (cancelResult.success ? '취소 결과 미검증' : '알 수 없는 오류');
      logActivity({
        serial_id: serial.id, action: 'system', actor: 'system', severity: 'error', trigger_id: triggerId,
        details: pickLang({
          ko: `포털 만료 윈도우 자동취소 실패 — 시리얼: ${serial.serial_number} (신청 #${requestId}), 사유: ${reason}`,
          en: `Portal expiry-window auto-cancel FAILED — serial: ${serial.serial_number} (request #${requestId}), reason: ${reason}`,
          ja: `ポータル失効ウィンドウ自動キャンセル失敗 — シリアル: ${serial.serial_number} (申請 #${requestId}), 理由: ${reason}`,
        }),
      });
      await notificationService.sendCriticalAutomationAlert({
        serial_number: serial.serial_number,
        customer_name: serial.customer?.name,
        action: { ko: '포털 갱신중단 자동취소', en: 'Portal renewal-stop auto-cancel', ja: 'ポータル更新停止自動キャンセル' },
        error: cancelResult.error,
        details: {
          ko: `포털 신청(#${requestId})의 만료 윈도우 자동취소가 실패했습니다. 시리얼 번호를 확인하고 필요 시 수동으로 재처리해주세요.`,
          en: `Portal request (#${requestId}) expiry-window auto-cancel failed. Verify the serial number and reprocess manually if needed.`,
          ja: `ポータル申請(#${requestId})の失効ウィンドウ自動キャンセルが失敗しました。シリアル番号を確認し、必要に応じて手動で再処理してください。`,
        },
        trigger_id: triggerId,
      });
    }
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

  res.json({ ok: true, request_id: requestId, auto_applied: autoApplied, processing_failed: processingFailed });
});

// ── POST /portal/requests/:id/cancel — 대기 중 신청 취소 요청 (매니저 승인 필요) ──
router.post('/:id/cancel', requirePortalAuth, requireCsrf, (req: Request, res: Response) => {
  try {
    const pr = req as PortalRequest;
    const accountId = pr.portalSession!.account_id;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

    const mine = getPortalRequestsByAccount(accountId).find(r => r.id === id);
    if (!mine) { res.status(404).json({ error: 'Not found' }); return; }
    if (mine.status !== 'pending') {
      res.status(400).json({ error: 'only_pending_cancellable' });
      return;
    }

    // 즉시 확정하지 않고 매니저 승인/거절 대기 상태로 전환
    updatePortalRequestStatus(id, 'cancel_requested');
    logActivity({
      action: 'system', actor: 'system', severity: 'info',
      details: pickLang({
        ko: `포털 신청(#${id}) 고객 취소 요청 — 유형: ${mine.type} (매니저 승인 대기)`,
        en: `Portal request (#${id}) cancellation requested by customer — type: ${mine.type} (awaiting manager decision)`,
        ja: `ポータル申請(#${id})顧客によるキャンセル要請 — 種類: ${mine.type}（管理者承認待ち）`,
      }),
    });
    res.json({ ok: true });
  } catch (err: unknown) {
    logger.error(`[portal] request cancel failed: ${getErrorMessage(err)}`);
    res.status(500).json({ error: getErrorMessage(err) });
  }
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

  logActivity({
    serial_id: serial.id, action: 'system', actor: 'system', severity: 'info',
    details: pickLang({
      ko: `포털 갱신 재개 신청(#${requestId}) 접수 — 시리얼: ${serial.serial_number}`,
      en: `Portal renewal-resume request received (#${requestId}) — serial: ${serial.serial_number}`,
      ja: `ポータル更新再開申請(#${requestId})受付 — シリアル: ${serial.serial_number}`,
    }),
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
