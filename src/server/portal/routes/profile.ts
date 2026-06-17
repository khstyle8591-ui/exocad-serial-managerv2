import { Router } from 'express';
import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { requirePortalAuth, requireCsrf, type PortalRequest } from '../middleware';
import { findAccountById, updateAccountPassword } from '../db';
import { syncPortalAccountIfNeeded } from '../sync';
import { getDb } from '../../../main/database';

const router = Router();

function maskSerial(serial: string): string {
  const parts = serial.split('-');
  if (parts.length !== 3) return 'X'.repeat(serial.replace(/-/g, '').length);
  const [s1, s2, s3] = parts;
  return [
    s1.slice(0, 4) + 'X'.repeat(Math.max(0, s1.length - 4)),
    'X'.repeat(s2.length),
    'X'.repeat(Math.max(0, s3.length - 4)) + s3.slice(-4),
  ].join('-');
}

function validatePassword(pw: string): string | null {
  if (pw.length < 8) return '비밀번호는 8자 이상이어야 합니다.';
  if (!/[A-Z]/.test(pw)) return '대문자를 포함해야 합니다.';
  if (!/[a-z]/.test(pw)) return '소문자를 포함해야 합니다.';
  if (!/[0-9]/.test(pw)) return '숫자를 포함해야 합니다.';
  return null;
}

interface SerialRow {
  serial_number: string;
  main_product: string;
  status: string;
}

// GET /portal/profile — 프로필 + 연결된 제품(마스킹 시리얼) 반환
router.get('/', requirePortalAuth, (req: Request, res: Response) => {
  const pr = req as PortalRequest;
  const accountId = pr.portalSession!.account_id;

  syncPortalAccountIfNeeded(accountId);

  const account = findAccountById(accountId);
  if (!account) { res.status(404).json({ error: 'Not found' }); return; }

  const links = getDb()
    .prepare<[number], { customer_id: number }>(
      'SELECT customer_id FROM portal_account_links WHERE account_id = ?',
    )
    .all(accountId);

  const linkedProducts = links.flatMap(({ customer_id }) =>
    getDb()
      .prepare<[number], SerialRow>(
        'SELECT serial_number, main_product, status FROM serials WHERE customer_id = ? ORDER BY created_at DESC',
      )
      .all(customer_id)
      .map(s => ({
        main_product: s.main_product,
        masked_serial: maskSerial(s.serial_number),
        status: s.status,
      })),
  );

  const { password_hash: _, ...safe } = account;
  res.json({ ...safe, csrf_token: pr.portalSession!.csrf_token, linked_products: linkedProducts });
});

// PATCH /portal/profile/language — 언어 영속 변경
router.patch('/language', requirePortalAuth, requireCsrf, (req: Request, res: Response) => {
  const pr = req as PortalRequest;
  const { language } = req.body as Record<string, string>;

  if (!['ko', 'en', 'ja'].includes(language)) {
    res.status(400).json({ error: '유효하지 않은 언어입니다.' });
    return;
  }

  getDb()
    .prepare(
      "UPDATE portal_accounts SET language = ?, updated_at = datetime('now','localtime') WHERE id = ?",
    )
    .run(language, pr.portalSession!.account_id);

  res.json({ ok: true, language });
});

// POST /portal/profile/change-password — 현재 비밀번호 확인 후 변경
router.post('/change-password', requirePortalAuth, requireCsrf, async (req: Request, res: Response) => {
  const pr = req as PortalRequest;
  const { current_password, password, confirm_password } = req.body as Record<string, string>;

  if (!current_password || !password) {
    res.status(400).json({ error: '필수 항목을 입력해주세요.' });
    return;
  }
  if (password !== confirm_password) {
    res.status(400).json({ error: '새 비밀번호가 일치하지 않습니다.' });
    return;
  }
  const pwError = validatePassword(password);
  if (pwError) { res.status(400).json({ error: pwError }); return; }

  const account = findAccountById(pr.portalSession!.account_id);
  if (!account) { res.status(404).json({ error: 'Not found' }); return; }

  const ok = await bcrypt.compare(current_password, account.password_hash);
  if (!ok) {
    res.status(401).json({ error: '현재 비밀번호가 일치하지 않습니다.' });
    return;
  }

  const hash = await bcrypt.hash(password, 12);
  updateAccountPassword(pr.portalSession!.account_id, hash);
  res.json({ ok: true });
});

export default router;
