import { Router } from 'express';
import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { requirePortalAuth, requireCsrf, type PortalRequest } from '../middleware';
import { findAccountById, updateAccountPassword, updatePortalAccountFields, setCustomerMismatch } from '../db';
import { syncPortalAccountIfNeeded } from '../sync';
import { getDb } from '../../../main/database';
import { updateCustomer, getCustomerById } from '../../../main/services/customer.service';
import { logActivity, pickLang } from '../../../main/services/activity-log.service';
import { getNowTimestampString } from '../../../main/utils/date-utils';

const router = Router();

function validatePassword(pw: string): string | null {
  if (pw.length < 8) return 'pw_too_short';
  if (!/[A-Z]/.test(pw)) return 'pw_no_uppercase';
  if (!/[a-z]/.test(pw)) return 'pw_no_lowercase';
  if (!/[0-9]/.test(pw)) return 'pw_no_number';
  return null;
}

interface SerialRow {
  serial_number: string;
  main_product: string;
  status: string;
  expiry_date: string | null;
}

// GET /portal/profile — 프로필 + 연결된 제품(시리얼 전체 + 만료일) 반환
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
        'SELECT serial_number, main_product, status, expiry_date FROM serials WHERE customer_id = ? ORDER BY created_at DESC',
      )
      .all(customer_id)
      .map(s => ({
        main_product: s.main_product,
        serial_number: s.serial_number,
        status: s.status,
        expiry_date: s.expiry_date,
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
      res.status(400).json({ error: 'invalid_email' });
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
    res.status(400).json({ error: 'invalid_language' });
    return;
  }

  getDb()
    .prepare(
      'UPDATE portal_accounts SET language = ?, updated_at = ? WHERE id = ?',
    )
    .run(language, getNowTimestampString(), pr.portalSession!.account_id);

  res.json({ ok: true, language });
});

// POST /portal/profile/change-password — 현재 비밀번호 확인 후 변경
router.post('/change-password', requirePortalAuth, requireCsrf, async (req: Request, res: Response) => {
  const pr = req as PortalRequest;
  const { current_password, password, confirm_password } = req.body as Record<string, string>;

  if (!current_password || !password) {
    res.status(400).json({ error: 'error_required' });
    return;
  }
  if (password !== confirm_password) {
    res.status(400).json({ error: 'error_pw_mismatch' });
    return;
  }
  const pwError = validatePassword(password);
  if (pwError) { res.status(400).json({ error: pwError }); return; }

  const account = findAccountById(pr.portalSession!.account_id);
  if (!account) { res.status(404).json({ error: 'Not found' }); return; }

  const ok = await bcrypt.compare(current_password, account.password_hash);
  if (!ok) {
    res.status(401).json({ error: 'invalid_current_password' });
    return;
  }

  const hash = await bcrypt.hash(password, 12);
  updateAccountPassword(pr.portalSession!.account_id, hash);
  res.json({ ok: true });
});

export default router;
