import { Router } from 'express';
import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { requirePortalAuth, requireCsrf, type PortalRequest } from '../middleware';
import { findAccountById, updateAccountPassword, updatePortalAccountFields, setCustomerMismatch } from '../db';
import { syncPortalAccountIfNeeded } from '../sync';
import { getDb } from '../../../main/database';
import { updateCustomer, getCustomerById } from '../../../main/services/customer.service';
import { logActivity, pickLang } from '../../../main/services/activity-log.service';

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

// PATCH /portal/profile — 이메일/연락처/주소/exocad_id 수정 (이름·로그인ID는 변경 불가)
router.patch('/', requirePortalAuth, requireCsrf, (req: Request, res: Response) => {
  const pr = req as PortalRequest;
  const { email, phone, address, exocad_id } = req.body as Record<string, string>;

  if (email !== undefined) {
    const trimmed = email.trim();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      res.status(400).json({ error: '올바른 이메일 형식을 입력해주세요.' });
      return;
    }
  }

  const accountId = pr.portalSession!.account_id;
  updatePortalAccountFields(accountId, {
    ...(email !== undefined && { email: email.trim() }),
    ...(phone !== undefined && { phone: phone.trim() }),
    ...(address !== undefined && { address: address.trim() }),
    ...(exocad_id !== undefined && { exocad_id: exocad_id.trim() }),
  });

  // 매니저 DB(customers) 즉시 반영 — 연결된 고객 레코드에 email/phone/address 전파.
  // (exocad_id는 customers 테이블에 컬럼이 없어 portal_accounts에만 보관 → 매니저 Accounts 탭에서 확인)
  const account = findAccountById(accountId);
  const link = getDb()
    .prepare<[number], { customer_id: number }>(
      'SELECT customer_id FROM portal_account_links WHERE account_id = ? ORDER BY id ASC LIMIT 1',
    )
    .get(accountId);

  if (account && link) {
    updateCustomer(link.customer_id, {
      ...(email   !== undefined && { email:   account.email }),
      ...(phone   !== undefined && { phone:   account.phone }),
      ...(address !== undefined && { address: account.address }),
    });

    // 전파 후 불일치 재검출 (name/email/phone). 이름은 포털에서 수정 불가하므로 차이가 남을 수 있음.
    const customer = getCustomerById(link.customer_id);
    if (customer) {
      const mismatch: Record<string, [string, string]> = {};
      const pairs: Array<[string, string, string]> = [
        ['name',  account.name?.trim()  ?? '', customer.name?.trim()  ?? ''],
        ['email', account.email?.trim() ?? '', customer.email?.trim() ?? ''],
        ['phone', account.phone?.trim() ?? '', customer.phone?.trim() ?? ''],
      ];
      for (const [field, av, cv] of pairs) {
        if (av && cv && av.toLowerCase() !== cv.toLowerCase()) mismatch[field] = [cv, av];
      }
      setCustomerMismatch(accountId, Object.keys(mismatch).length > 0 ? mismatch : null);
    }

    logActivity({
      action: 'system', actor: 'system', severity: 'info',
      details: pickLang({
        ko: `포털 프로필 수정 → 고객 #${link.customer_id} DB 반영 (계정 #${accountId})`,
        en: `Portal profile updated → applied to customer #${link.customer_id} DB (account #${accountId})`,
        ja: `ポータルプロフィール更新 → 顧客 #${link.customer_id} DBへ反映 (アカウント #${accountId})`,
      }),
    });
  }

  res.json({ ok: true });
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
