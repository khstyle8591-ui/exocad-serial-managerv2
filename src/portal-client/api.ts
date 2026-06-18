const BASE = '/portal';

let csrfToken: string | null = null;

export function setCsrf(token: string): void { csrfToken = token; }
export function clearCsrf(): void { csrfToken = null; }

// HTTP 상태/서버 코드까지 보존하는 에러 (미매치 팝업 판별용)
export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (csrfToken && method !== 'GET') headers['X-CSRF-Token'] = csrfToken;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    credentials: 'include',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const d = data as { error?: string; code?: string };
    throw new ApiError(d.error || `HTTP ${res.status}`, res.status, d.code);
  }
  return data as T;
}

export const api = {
  get:   <T>(path: string)                  => request<T>('GET',   path),
  post:  <T>(path: string, body?: unknown)  => request<T>('POST',  path, body),
  patch: <T>(path: string, body?: unknown)  => request<T>('PATCH', path, body),
};
