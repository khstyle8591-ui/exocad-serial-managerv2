import type { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { getDb } from '../../main/database';

export const SESSION_COOKIE = 'psid';
const CSRF_HEADER = 'x-csrf-token';
const SESSION_TTL_HOURS = 24;

function expiresAt(hours: number): string {
  return new Date(Date.now() + hours * 3_600_000)
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ');
}

export function generateToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    out[key] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export interface PortalSession {
  id: number;
  account_id: number;
  csrf_token: string;
}

export interface PortalRequest extends Request {
  portalSession?: PortalSession;
  portalCookies?: Record<string, string>;
}

export function createSession(accountId: number): { token: string; csrfToken: string } {
  const token = generateToken(32);
  const csrfToken = generateToken(16);
  getDb()
    .prepare(
      'INSERT INTO portal_sessions (token, account_id, csrf_token, expires_at) VALUES (?, ?, ?, ?)',
    )
    .run(token, accountId, csrfToken, expiresAt(SESSION_TTL_HOURS));
  return { token, csrfToken };
}

export function destroySession(token: string): void {
  getDb().prepare('DELETE FROM portal_sessions WHERE token = ?').run(token);
}

export function getSessionByToken(token: string): PortalSession | null {
  const row = getDb()
    .prepare<[string], PortalSession>(
      "SELECT id, account_id, csrf_token FROM portal_sessions WHERE token = ? AND expires_at > datetime('now','localtime')",
    )
    .get(token);
  return row ?? null;
}

export function setSessionCookie(res: Response, token: string): void {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  const age = SESSION_TTL_HOURS * 3600;
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${token}; Max-Age=${age}; Path=/; HttpOnly; SameSite=Strict${secure}`,
  );
}

export function clearSessionCookie(res: Response): void {
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict`,
  );
}

export function cookieMiddleware(req: PortalRequest, _res: Response, next: NextFunction): void {
  req.portalCookies = parseCookies(req.headers.cookie);
  next();
}

export function requirePortalAuth(req: Request, res: Response, next: NextFunction): void {
  const pr = req as PortalRequest;
  const token = pr.portalCookies?.[SESSION_COOKIE];
  if (!token) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const session = getSessionByToken(token);
  if (!session) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  pr.portalSession = session;
  next();
}

export function requireCsrf(req: Request, res: Response, next: NextFunction): void {
  const session = (req as PortalRequest).portalSession;
  const csrf = req.headers[CSRF_HEADER];
  if (!session || !csrf || csrf !== session.csrf_token) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  next();
}
