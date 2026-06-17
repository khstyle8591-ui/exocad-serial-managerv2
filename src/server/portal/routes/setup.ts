import { Router } from 'express';
import type { Request, Response } from 'express';
import { requirePortalAuth, requireCsrf, type PortalRequest } from '../middleware';
import { createAccountLink, getAccountLinks, isSerialLinked } from '../db';
import { syncPortalAccountIfNeeded } from '../sync';
import { serialService } from '../../../main/services/serial.service';

const router = Router();

// POST /portal/setup/link-serial — 시리얼 입력 → 본인확인 후 계정 연결
router.post('/link-serial', requirePortalAuth, requireCsrf, (req: Request, res: Response) => {
  const pr = req as PortalRequest;
  const accountId = pr.portalSession!.account_id;
  const { serial } = req.body as Record<string, string>;

  if (!serial?.trim()) {
    res.status(400).json({ error: '시리얼을 입력해주세요.' });
    return;
  }

  const serialRecord = serialService.getBySerialNumber(serial.trim());
  if (!serialRecord) {
    res.status(404).json({ error: '시리얼을 찾을 수 없습니다. 입력을 확인하거나 PM에 문의해주세요.' });
    return;
  }

  if (isSerialLinked(accountId, serialRecord.customer_id)) {
    // 멱등 — 이미 연결돼 있으면 성공으로 처리
    res.json({ ok: true, customer_id: serialRecord.customer_id, main_product: serialRecord.main_product, already_linked: true });
    return;
  }

  createAccountLink(accountId, serialRecord.customer_id, serialRecord.serial_number.toUpperCase());
  syncPortalAccountIfNeeded(accountId);

  res.json({ ok: true, customer_id: serialRecord.customer_id, main_product: serialRecord.main_product });
});

// GET /portal/setup/links — 연결된 고객/시리얼 목록 조회
router.get('/links', requirePortalAuth, (req: Request, res: Response) => {
  const pr = req as PortalRequest;
  const links = getAccountLinks(pr.portalSession!.account_id);
  res.json({ links });
});

export default router;
