const BASE = '/portal';

let csrfToken: string | null = null;

export function setCsrf(token: string): void { csrfToken = token; }
export function clearCsrf(): void { csrfToken = null; }

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
  if (!res.ok) throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  return data as T;
}

export const api = {
  get:   <T>(path: string)                  => request<T>('GET',   path),
  post:  <T>(path: string, body?: unknown)  => request<T>('POST',  path, body),
  patch: <T>(path: string, body?: unknown)  => request<T>('PATCH', path, body),
};
