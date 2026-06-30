import { Router } from 'express';
import type { Request, Response } from 'express';
import { portalAdminAuth } from '../admin-auth';
import {
  findAccountById,
  getAllPortalAccounts,
  updatePortalAccountFields,
  setPortalAccountStatus,
  setCustomerMismatch,
  getAllPortalRequests,
  getPortalRequestById,
  updatePortalRequestStatus,
  markPortalRequestPlaywrightFailedByManager,
  markPortalRequestCancelRejected,
  type PortalRequestType,
  type PortalRequestStatus,
} from '../db';
import { portalRequestEvents } from '../request-events';
import { updateCustomer } from '../../../main/services/customer.service';
import { getDb } from '../../../main/database';
import { logActivity, pickLang } from '../../../main/services/activity-log.service';
import { getSettings, saveSettings } from '../../../main/settings';
import { serialService } from '../../../main/services/serial.service';
import { cancelService } from '../../../main/services/cancel.service';
import { notificationService, localizeCancelError } from '../../../main/services/notification.service';
import type { CreditPackage, PortalRequestDescriptions, StyledLocalizedText } from '../../../shared/types';

const router = Router();

router.use(portalAdminAuth);

// ── 포털 설정 ─────────────────────────────────────────────────────────────────

// GET /portal/admin/settings
router.get('/settings', (_req: Request, res: Response) => {
  const s = getSettings();
  res.json({
    portal_enabled: s.portal_enabled,
    credit_auto_alloc_enabled: s.credit_auto_alloc_enabled,
    credit_notification_email: s.credit_notification_email,
    credit_packages: s.credit_packages,
    portal_request_descriptions: s.portal_request_descriptions,
    portal_mismatch_message: s.portal_mismatch_message,
    portal_resume_quote_prompt: s.portal_resume_quote_prompt,
    portal_resume_quote_sent: s.portal_resume_quote_sent,
  });
});

function isLocalizedText(v: unknown): v is StyledLocalizedText {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  if (!(typeof o.ko === 'string' && typeof o.en === 'string' && typeof o.ja === 'string')) return false;
  if (o.color !== undefined && typeof o.color !== 'string') return false;
  if (o.fontSize !== undefined && typeof o.fontSize !== 'number') return false;
  if (o.bold !== undefined && typeof o.bold !== 'boolean') return false;
  return true;
}

function isRequestDescriptions(v: unknown): v is PortalRequestDescriptions {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return isLocalizedText(o.credit) && isLocalizedText(o.renewal_stop) && isLocalizedText(o.renewal_resume);
}

// PATCH /portal/admin/settings
router.patch('/settings', (req: Request, res: Response) => {
  const {
    portal_enabled,
    credit_auto_alloc_enabled,
    credit_notification_email,
    credit_packages,
    portal_request_descriptions,
    portal_mismatch_message,
    portal_resume_quote_prompt,
    portal_resume_quote_sent,
  } = req.body as {
    portal_enabled?: boolean;
    credit_auto_alloc_enabled?: boolean;
    credit_notification_email?: string;
    credit_packages?: CreditPackage[];
    portal_request_descriptions?: PortalRequestDescriptions;
    portal_mismatch_message?: StyledLocalizedText;
    portal_resume_quote_prompt?: StyledLocalizedText;
    portal_resume_quote_sent?: StyledLocalizedText;
  };

  const patch: Partial<ReturnType<typeof getSettings>> = {};
  if (typeof portal_enabled === 'boolean') patch.portal_enabled = portal_enabled;
  if (typeof credit_auto_alloc_enabled === 'boolean') patch.credit_auto_alloc_enabled = credit_auto_alloc_enabled;
  if (typeof credit_notification_email === 'string') patch.credit_notification_email = credit_notification_email.trim();
  if (Array.isArray(credit_packages)) {
    const valid = credit_packages.every(
      p => p.id && typeof p.label === 'string' && typeof p.quantity === 'number' && typeof p.price === 'number',
    );
    if (!valid) { res.status(400).json({ error: '패키지 형식이 올바르지 않습니다.' }); return; }
    patch.credit_packages = credit_packages;
  }
  if (portal_request_descriptions !== undefined) {
    if (!isRequestDescriptions(portal_request_descriptions)) {
      res.status(400).json({ error: '신청 설명 형식이 올바르지 않습니다.' }); return;
    }
    patch.portal_request_descriptions = portal_request_descriptions;
  }
  for (const [key, val] of [
    ['portal_mismatch_message', portal_mismatch_message],
    ['portal_resume_quote_prompt', portal_resume_quote_prompt],
    ['portal_resume_quote_sent', portal_resume_quote_sent],
  ] as const) {
    if (val !== undefined) {
      if (!isLocalizedText(val)) { res.status(400).json({ error: `${key} 형식이 올바르지 않습니다.` }); return; }
      patch[key] = val;
    }
  }

  if (Object.keys(patch).length === 0) { res.status(400).json({ error: '변경할 항목이 없습니다.' }); return; }

  saveSettings(patch);
  res.json({ ok: true });
});

// ── 포털 계정 ─────────────────────────────────────────────────────────────────

// GET /portal/admin/accounts
router.get('/accounts', (_req: Request, res: Response) => {
  res.json({ accounts: getAllPortalAccounts() });
});

// GET /portal/admin/accounts/:id
router.get('/accounts/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: 'Invalid id' }); return; }
  const account = findAccountById(id);
  if (!account) { res.status(404).json({ error: 'Not found' }); return; }
  const { password_hash: _, ...safe } = account;
  const requests = getAllPortalRequests().filter(r => r.account_id === id);
  res.json({ ...safe, requests });
});

// PATCH /portal/admin/accounts/:id
router.patch('/accounts/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

  const { name, email, phone, address, exocad_id, language } = req.body as Record<string, string>;
  const LANG = ['ko', 'en', 'ja'];
  if (language && !LANG.includes(language)) {
    res.status(400).json({ error: '유효하지 않은 언어입니다.' });
    return;
  }

  updatePortalAccountFields(id, {
    ...(name !== undefined && { name }),
    ...(email !== undefined && { email }),
    ...(phone !== undefined && { phone }),
    ...(address !== undefined && { address }),
    ...(exocad_id !== undefined && { exocad_id }),
    ...(language !== undefined && { language: language as 'ko' | 'en' | 'ja' }),
  });
  res.json({ ok: true });
});

// PATCH /portal/admin/accounts/:id/status
router.patch('/accounts/:id/status', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: 'Invalid id' }); return; }
  const { status } = req.body as { status?: string };
  if (status !== 'active' && status !== 'disabled') {
    res.status(400).json({ error: "status는 'active' 또는 'disabled'여야 합니다." });
    return;
  }
  setPortalAccountStatus(id, status);
  res.json({ ok: true });
});

// POST /portal/admin/accounts/:id/sync-to-customer — portal data → customer DB
router.post('/accounts/:id/sync-to-customer', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: 'Invalid id' }); return; }
  const account = findAccountById(id);
  if (!account) { res.status(404).json({ error: 'Not found' }); return; }

  // Find customer linked to this portal account
  const link = getDb()
    .prepare<[number], { customer_id: number }>('SELECT customer_id FROM portal_account_links WHERE account_id = ? LIMIT 1')
    .get(id);
  if (!link) { res.status(400).json({ error: '연결된 고객이 없습니다.' }); return; }

  updateCustomer(link.customer_id, {
    ...(account.name  && { name:  account.name }),
    ...(account.email && { email: account.email }),
    ...(account.phone && { phone: account.phone }),
  });
  setCustomerMismatch(id, null);
  logActivity({
    action: 'system',
    actor: 'manual',
    severity: 'info',
    details: `Manager synced portal account #${id} data → customer #${link.customer_id}`,
  });

  res.json({ ok: true });
});

// ── 신청 관리 ─────────────────────────────────────────────────────────────────

// GET /portal/admin/requests?type=&status=
router.get('/requests', (req: Request, res: Response) => {
  const { type, status } = req.query as Record<string, string>;
  const validTypes: PortalRequestType[] = ['credit', 'renewal_stop', 'renewal_resume'];
  const validStatuses: PortalRequestStatus[] = ['pending', 'manager_review', 'auto_done', 'approved', 'rejected', 'user_cancelled', 'cancel_requested'];
  const filter: { type?: PortalRequestType; status?: PortalRequestStatus } = {};
  if (type && validTypes.includes(type as PortalRequestType)) filter.type = type as PortalRequestType;
  if (status && validStatuses.includes(status as PortalRequestStatus)) filter.status = status as PortalRequestStatus;
  res.json({ requests: getAllPortalRequests(filter) });
});

// GET /portal/admin/requests/stream — SSE: 신청이 생성/상태변경될 때마다 알림을 보내
// 매니저 화면이 폴링 주기(30초)를 기다리지 않고 즉시 다시 조회하도록 한다.
// :id 라우트보다 먼저 등록해야 Express가 "stream"을 id 파라미터로 잘못 매칭하지 않는다.
router.get('/requests/stream', (req: Request, res: Response) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');

  const onChanged = () => res.write('event: changed\ndata: {}\n\n');
  portalRequestEvents.on('changed', onChanged);

  // 일부 프록시/터널이 idle 커넥션을 끊는 것을 막기 위한 주기적 heartbeat
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 25_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    portalRequestEvents.off('changed', onChanged);
  });
});

// GET /portal/admin/requests/:id
router.get('/requests/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: 'Invalid id' }); return; }
  const row = getPortalRequestById(id);
  if (!row) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(row);
});

// PATCH /portal/admin/requests/:id/decide — 승인 / 거절
router.patch('/requests/:id/decide', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

  const { action } = req.body as { action?: string };
  if (action !== 'approve' && action !== 'reject') {
    res.status(400).json({ error: "action은 'approve' 또는 'reject'여야 합니다." });
    return;
  }

  const request = getPortalRequestById(id);
  if (!request) { res.status(404).json({ error: 'Not found' }); return; }
  // playwright_failed_manual: 매니저 승인 후 Playwright 실행이 실패해 재시도가 필요한 상태(status='approved') — 재승인 허용
  const isRetryable = request.status === 'approved' && request.note === 'playwright_failed_manual';
  if (!isRetryable && (request.status === 'auto_done' || request.status === 'approved' || request.status === 'rejected')) {
    res.status(409).json({ error: '이미 처리된 신청입니다.' });
    return;
  }

  if (action === 'reject') {
    updatePortalRequestStatus(id, 'rejected');
    logActivity({
      action: 'system', actor: 'manual', severity: 'info',
      details: pickLang({
        ko: `포털 신청(#${id}) 관리자 거절 — 유형: ${request.type}`,
        en: `Portal request (#${id}) rejected by manager — type: ${request.type}`,
        ja: `ポータル申請(#${id})管理者により却下 — 種類: ${request.type}`,
      }),
    });
    res.json({ ok: true, status: 'rejected' });
    return;
  }

  // 승인 처리
  if (request.type === 'renewal_stop' && request.target_serial) {
    const serial = serialService.getBySerialNumber(request.target_serial);
    if (!serial) {
      res.status(400).json({ error: `시리얼을 찾을 수 없습니다: ${request.target_serial}` });
      return;
    }
    serialService.setStopRequested(
      serial.id,
      true,
      `portal-req-${id}`,
      'manual',
      pickLang({
        ko: `관리자 승인 — 포털 갱신 중단 신청 #${id}`,
        en: `Manager approved — portal renewal-stop request #${id}`,
        ja: `管理者承認 — ポータル更新停止申請 #${id}`,
      }),
    );
    // Playwright로 Exocad 사이트에서 실제 구독 취소 실행 (blocking — 결과 확인)
    const cancelResult = await cancelService.cancelSubscription(serial.serial_number, true);
    if (!cancelResult.success) {
      // 매니저가 이미 승인했으므로 포털 고객에게는 '승인됨'으로 보이게 status='approved' 유지,
      // note로만 Playwright 실패를 구분해 매니저가 재시도할 수 있도록 한다.
      markPortalRequestPlaywrightFailedByManager(id);
      // reason은 언어별로 따로 계산 — cancelResult.error는 Playwright가 던진 한국어 원문이라
      // pickLang()으로만 감싸면 en/ja 문장 안에 한국어가 그대로 섞여 나온다.
      const reasonByLang = (lang: 'ko' | 'en' | 'ja') => cancelResult.error
        ? localizeCancelError(cancelResult.error, lang)
        : ({ ko: '알 수 없는 오류', en: 'unknown error', ja: '不明なエラー' })[lang];
      logActivity({
        serial_id: serial.id, action: 'system', actor: 'manual', severity: 'error', trigger_id: `portal-req-${id}`,
        details: pickLang({
          ko: `포털 갱신중단 승인(#${id}) — Playwright 취소 실패: ${serial.serial_number}, 사유: ${reasonByLang('ko')}`,
          en: `Portal renewal-stop approval (#${id}) — Playwright cancel FAILED: ${serial.serial_number}, reason: ${reasonByLang('en')}`,
          ja: `ポータル更新停止承認(#${id}) — Playwrightキャンセル失敗: ${serial.serial_number}, 理由: ${reasonByLang('ja')}`,
        }),
      });
      await notificationService.sendCriticalAutomationAlert({
        serial_number: serial.serial_number,
        customer_name: serial.customer?.name,
        action: { ko: '포털 갱신중단 관리자 승인 취소', en: 'Portal renewal-stop manager-approved cancel', ja: 'ポータル更新停止 管理者承認キャンセル' },
        error: cancelResult.error,
        details: {
          ko: `관리자가 승인한 포털 신청(#${id})의 Playwright 취소가 실패했습니다. 시리얼 번호를 확인하고 필요 시 수동으로 재처리해주세요.`,
          en: `Manager-approved portal request (#${id}) Playwright cancel failed. Verify the serial number and reprocess manually if needed.`,
          ja: `管理者が承認したポータル申請(#${id})のPlaywrightキャンセルが失敗しました。シリアル番号を確認し、必要に応じて手動で再処理してください。`,
        },
        trigger_id: `portal-req-${id}`,
      });
      res.json({ ok: true, status: 'playwright_failed' });
      return;
    }
    logActivity({
      serial_id: serial.id, action: 'cancelled', actor: 'manual', severity: 'info', trigger_id: `portal-req-${id}`,
      details: pickLang({
        ko: `포털 갱신중단 승인(#${id}) — Playwright 취소 성공: ${serial.serial_number}`,
        en: `Portal renewal-stop approval (#${id}) — Playwright cancel succeeded: ${serial.serial_number}`,
        ja: `ポータル更新停止承認(#${id}) — Playwrightキャンセル成功: ${serial.serial_number}`,
      }),
    });
  } else {
    logActivity({
      action: 'system', actor: 'manual', severity: 'info',
      details: pickLang({
        ko: `포털 신청(#${id}) 관리자 승인 — 유형: ${request.type}`,
        en: `Portal request (#${id}) approved by manager — type: ${request.type}`,
        ja: `ポータル申請(#${id})管理者により承認 — 種類: ${request.type}`,
      }),
    });
  }
  // credit / renewal_resume: DB 상태만 approved로 변경 (관리자 수동 처리)

  updatePortalRequestStatus(id, 'approved');
  res.json({ ok: true, status: 'approved' });
});

// PATCH /portal/admin/requests/:id/decide-cancel — 고객의 취소 요청(cancel_requested)을 승인/거절
router.patch('/requests/:id/decide-cancel', (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

    const { action } = req.body as { action?: string };
    if (action !== 'approve' && action !== 'reject') {
      res.status(400).json({ error: "action은 'approve' 또는 'reject'여야 합니다." });
      return;
    }

    const request = getPortalRequestById(id);
    if (!request) { res.status(404).json({ error: 'Not found' }); return; }
    if (request.status !== 'cancel_requested') {
      res.status(409).json({ error: '취소 요청 상태가 아닙니다.' });
      return;
    }

    if (action === 'approve') {
      // 취소 확정 — 원래 신청은 최종적으로 취소됨
      updatePortalRequestStatus(id, 'user_cancelled');

      // renewal_stop 신청 자체를 취소하는 것이므로, 시리얼에 세워둔 갱신중단 플래그도 함께 해제한다.
      // (해제하지 않으면 매니저 승인 후에도 시리얼이 계속 "중단 요청됨" 상태로 남아 재신청이 막힘)
      if (request.type === 'renewal_stop' && request.target_serial) {
        const serial = serialService.getBySerialNumber(request.target_serial);
        if (serial) {
          serialService.setStopRequested(
            serial.id,
            false,
            `portal-req-${id}`,
            'manual',
            pickLang({
              ko: `관리자 승인 — 포털 갱신중단 신청(#${id}) 취소 요청에 따라 플래그 해제`,
              en: `Manager approved — stop flag cleared per portal renewal-stop request (#${id}) cancellation`,
              ja: `管理者承認 — ポータル更新停止申請(#${id})のキャンセル要請により解除`,
            }),
          );
        }
      }

      logActivity({
        action: 'system', actor: 'manual', severity: 'info',
        details: pickLang({
          ko: `포털 신청(#${id}) 취소 요청 승인 — 유형: ${request.type}`,
          en: `Portal request (#${id}) cancellation approved by manager — type: ${request.type}`,
          ja: `ポータル申請(#${id})キャンセル要請を承認 — 種類: ${request.type}`,
        }),
      });
      res.json({ ok: true, status: 'user_cancelled' });
      return;
    }

    // 거절 — 취소 요청을 거절하고 원래 신청은 승인 확정(approved)으로 처리.
    // note='cancel_rejected'로 구분해 포털/매니저 화면에 별도 표시하고 재취소 신청을 막는다.
    markPortalRequestCancelRejected(id);
    logActivity({
      action: 'system', actor: 'manual', severity: 'info',
      details: pickLang({
        ko: `포털 신청(#${id}) 취소 요청 거절 — 유형: ${request.type} (승인 상태로 확정)`,
        en: `Portal request (#${id}) cancellation rejected by manager — type: ${request.type} (finalized as approved)`,
        ja: `ポータル申請(#${id})キャンセル要請を却下 — 種類: ${request.type}（承認確定）`,
      }),
    });
    res.json({ ok: true, status: 'approved' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

export default router;
