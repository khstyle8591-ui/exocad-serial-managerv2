import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import type { Request, Response } from 'express';
import {
  createSession,
  destroySession,
  setSessionCookie,
  clearSessionCookie,
  requirePortalAuth,
  requireCsrf,
  generateToken,
  SESSION_COOKIE,
  type PortalRequest,
} from '../middleware';
import {
  findAccountByLoginId,
  findAccountById,
  loginIdExists,
  createAccount,
  updateAccountPassword,
  createResetToken,
  consumeResetToken,
} from '../db';
import { sendTemplate } from '../../../main/services/mail/smtp.service';
import { logger } from '../../../main/utils/logger';

const router = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

const GENERIC_ERROR = 'invalid_credentials';

function validatePassword(pw: string): string | null {
  if (pw.length < 8) return 'pw_too_short';
  if (!/[A-Z]/.test(pw)) return 'pw_no_uppercase';
  if (!/[a-z]/.test(pw)) return 'pw_no_lowercase';
  if (!/[0-9]/.test(pw)) return 'pw_no_number';
  return null;
}

function toLanguage(val: unknown): 'ko' | 'en' | 'ja' {
  if (val === 'en' || val === 'ja') return val;
  return 'ko';
}

// POST /portal/auth/signup
router.post('/signup', authLimiter, async (req: Request, res: Response) => {
  const {
    login_id,
    email,
    phone = '',
    address = '',
    name,
    exocad_id = '',
    password,
    confirm_password,
    language,
  } = req.body as Record<string, string>;

  if (!login_id?.trim() || !email?.trim() || !name?.trim() || !password) {
    res.status(400).json({ error: 'error_required' });
    return;
  }
  if (password !== confirm_password) {
    res.status(400).json({ error: 'error_pw_mismatch' });
    return;
  }
  const pwError = validatePassword(password);
  if (pwError) { res.status(400).json({ error: pwError }); return; }

  if (loginIdExists(login_id.trim())) {
    res.status(409).json({ error: 'login_id_taken' });
    return;
  }

  const hash = await bcrypt.hash(password, 12);
  const accountId = createAccount({
    login_id: login_id.trim(),
    email: email.trim(),
    phone: phone.trim(),
    address: address.trim(),
    name: name.trim(),
    exocad_id: exocad_id.trim(),
    password_hash: hash,
    language: toLanguage(language),
  });

  const { token, csrfToken } = createSession(accountId);
  setSessionCookie(res, token);
  res.json({ account_id: accountId, csrf_token: csrfToken });
});

// POST /portal/auth/login
router.post('/login', authLimiter, async (req: Request, res: Response) => {
  const { login_id, password } = req.body as Record<string, string>;

  if (!login_id || !password) {
    res.status(400).json({ error: GENERIC_ERROR });
    return;
  }

  const account = findAccountByLoginId(login_id.trim());
  if (!account || account.status !== 'active') {
    // 타이밍 균등화 — 계정 없어도 bcrypt 비용 소모
    await bcrypt.compare('dummy', '$2b$12$invalidhashinvalidhashinvalidhas');
    res.status(401).json({ error: GENERIC_ERROR });
    return;
  }

  const ok = await bcrypt.compare(password, account.password_hash);
  if (!ok) {
    res.status(401).json({ error: GENERIC_ERROR });
    return;
  }

  const { token, csrfToken } = createSession(account.id);
  setSessionCookie(res, token);
  res.json({ account_id: account.id, language: account.language, csrf_token: csrfToken });
});

// POST /portal/auth/logout
router.post('/logout', requirePortalAuth, requireCsrf, (req: Request, res: Response) => {
  const pr = req as PortalRequest;
  const sessionToken = pr.portalCookies?.[SESSION_COOKIE];
  if (sessionToken) destroySession(sessionToken);
  clearSessionCookie(res);
  res.json({ ok: true });
});

// POST /portal/auth/reset-request — 등록 이메일로 일회용 재설정 링크 발송
router.post('/reset-request', authLimiter, async (req: Request, res: Response) => {
  const { login_id, email } = req.body as Record<string, string>;
  if (!login_id?.trim() || !email?.trim()) {
    res.status(400).json({ error: 'missing_fields' });
    return;
  }

  const account = findAccountByLoginId(login_id.trim());
  if (!account || account.email.toLowerCase() !== email.trim().toLowerCase()) {
    res.status(400).json({ error: 'email_not_matched' });
    return;
  }

  const resetToken = generateToken(32);
  createResetToken(account.id, resetToken);

  const baseUrl = process.env.PORTAL_BASE_URL ||
    `${req.protocol}://${req.get('host')}`;
  // 주의: /portal/* 은 백엔드 API 전용 경로. 포털 프론트엔드(SPA)는 루트(/)에서 서빙되며
  // 비밀번호 재설정 페이지의 실제 라우트는 /reset 이다(App.tsx 참조). /portal/reset으로 보내면
  // 백엔드 라우터를 거쳐 결국 SPA가 로드되어도 React Router가 해당 경로를 몰라 빈 화면/로그인으로 빠진다.
  const resetUrl = `${baseUrl}/reset?token=${resetToken}`;

  try {
    await sendTemplate('portal_reset_password', account.email, {
      NAME: account.name,
      RESET_URL: resetUrl,
    });
  } catch (err) {
    logger.error(`[portal] reset-request: SMTP 발송 실패: ${err instanceof Error ? err.message : String(err)}`);
    res.status(500).json({ error: 'mail_send_failed' });
    return;
  }

  res.json({ ok: true, code: 'reset_link_sent' });
});

// POST /portal/auth/reset-confirm — 토큰 + 새 비밀번호로 재설정
router.post('/reset-confirm', authLimiter, async (req: Request, res: Response) => {
  const { token, password, confirm_password } = req.body as Record<string, string>;

  if (!token || !password) {
    res.status(400).json({ error: 'missing_fields' });
    return;
  }
  if (password !== confirm_password) {
    res.status(400).json({ error: 'pw_mismatch' });
    return;
  }
  const pwError = validatePassword(password);
  if (pwError) { res.status(400).json({ error: pwError }); return; }

  const resetToken = consumeResetToken(token);
  if (!resetToken) {
    res.status(400).json({ error: 'invalid_reset_link' });
    return;
  }

  const hash = await bcrypt.hash(password, 12);
  updateAccountPassword(resetToken.account_id, hash);
  res.json({ ok: true });
});

// GET /portal/auth/me — 현재 로그인 계정 정보 (비밀번호 해시 제외)
router.get('/me', requirePortalAuth, (req: Request, res: Response) => {
  const pr = req as PortalRequest;
  const account = findAccountById(pr.portalSession!.account_id);
  if (!account) { res.status(404).json({ error: 'Not found' }); return; }
  const { password_hash: _, ...safe } = account;
  res.json({ ...safe, csrf_token: pr.portalSession!.csrf_token });
});

export default router;
