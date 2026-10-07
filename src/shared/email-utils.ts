const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type SecondaryEmailCheck =
  | { ok: true }
  | { ok: false; reason: 'invalid' | 'duplicate' };

/** email_2(추가 수신 이메일) 저장 전 검증 — 형식 오류 또는 1번 이메일과 동일하면 거부. */
export function checkSecondaryEmail(email2: string, primaryEmail: string): SecondaryEmailCheck {
  const trimmed = email2.trim();
  if (!trimmed) return { ok: true };
  if (!EMAIL_RE.test(trimmed)) return { ok: false, reason: 'invalid' };
  if (trimmed.toLowerCase() === primaryEmail.trim().toLowerCase()) return { ok: false, reason: 'duplicate' };
  return { ok: true };
}
