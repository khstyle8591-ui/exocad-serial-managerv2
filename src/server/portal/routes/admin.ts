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
  type PortalRequestType,
  type PortalRequestStatus,
} from '../db';
import { updateCustomer } from '../../../main/services/customer.service';
import { getDb } from '../../../main/database';
import { logActivity } from '../../../main/services/activity-log.service';
import { getSettings, saveSettings } from '../../../main/settings';
import { serialService } from '../../../main/services/serial.service';
import { cancelService } from '../../../main/services/cancel.service';
import type { CreditPackage, PortalRequestDescriptions, LocalizedText } from '../../../shared/types';

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

function isLocalizedText(v: unknown): v is LocalizedText {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o.ko === 'string' && typeof o.en === 'string' && typeof o.ja === 'string';
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
    portal_mismatch_message?: LocalizedText;
    portal_resume_quote_prompt?: LocalizedText;
    portal_resume_quote_sent?: LocalizedText;
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
  const validStatuses: PortalRequestStatus[] = ['pending', 'manager_review', 'auto_done', 'approved', 'rejected', 'user_cancelled'];
  const filter: { type?: PortalRequestType; status?: PortalRequestStatus } = {};
  if (type && validTypes.includes(type as PortalRequestType)) filter.type = type as PortalRequestType;
  if (status && validStatuses.includes(status as PortalRequestStatus)) filter.status = status as PortalRequestStatus;
  res.json({ requests: getAllPortalRequests(filter) });
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
  if (request.status === 'auto_done' || request.status === 'approved' || request.status === 'rejected') {
    res.status(409).json({ error: '이미 처리된 신청입니다.' });
    return;
  }

  if (action === 'reject') {
    updatePortalRequestStatus(id, 'rejected');
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
      `관리자 승인 — 포털 갱신 중단 신청 #${id}`,
    );
    // Playwright로 Exocad 사이트에서 실제 구독 취소 실행 (non-blocking)
    cancelService.cancelSubscription(serial.serial_number, true).catch(() => {});
  }
  // credit / renewal_resume: DB 상태만 approved로 변경 (관리자 수동 처리)

  updatePortalRequestStatus(id, 'approved');
  res.json({ ok: true, status: 'approved' });
});

export default router;
