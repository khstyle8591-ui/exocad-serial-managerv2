/**
 * Web 서버 모드용 API 클라이언트 (fetch 기반)
 * Electron의 window.electronAPI를 대체합니다
 */
const BASE = '/api';

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const opts: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(`${BASE}${path}`, opts);
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || res.statusText);
    }
    return res.json();
}

const get = <T>(path: string) => req<T>('GET', path);
const post = <T>(path: string, body?: unknown) => req<T>('POST', path, body);
const put = <T>(path: string, body?: unknown) => req<T>('PUT', path, body);
const del = <T>(path: string) => req<T>('DELETE', path);

// ── Serials ────────────────────────────────────────────────────────────────
export const api = {
    getSerials: () => get('/serials'),
    getSerial: (id: number) => get(`/serials/${id}`),
    searchSerials: (q: string) => get(`/serials/search?q=${encodeURIComponent(q)}`),
    getStats: () => get('/serials/stats'),
    createSerial: (data: unknown) => post('/serials', data),
    updateSerial: (id: number, data: unknown) => put(`/serials/${id}`, data),
    deleteSerial: (id: number) => del(`/serials/${id}`),
    addAddon: (id: number, addon: unknown) => post(`/serials/${id}/addon`, addon),

    // 엑셀 템플릿 다운로드 (직접 링크 방식)
    downloadTemplate: () => { window.location.href = `${BASE}/serials/template/download`; },

    // 엑셀 대량 임포트 (multipart)
    bulkImport: async (file: File) => {
        const fd = new FormData();
        fd.append('file', file);
        const res = await fetch(`${BASE}/serials/bulk-import`, { method: 'POST', body: fd });
        if (!res.ok) throw new Error((await res.json()).error);
        return res.json();
    },

    // ── Orders ────────────────────────────────────────────────────────────────
    getOrders: () => get('/orders'),
    getPollStatus: () => get('/orders/poll-status'),
    pollNow: (sourceId?: string) => post('/orders/poll-now', { sourceId }),
    pollDryRun: (sourceId?: string, overrides?: unknown) =>
        post('/orders/poll-dry-run', { sourceId, sourceOverrides: overrides }),
    restartOrderScheduler: () => post('/orders/restart-scheduler'),
    updateOrder: (id: number, data: unknown) => put(`/orders/${id}`, data),
    approveOrder: (id: number) => post(`/orders/${id}/approve`),
    rejectOrder: (id: number) => post(`/orders/${id}/reject`),
    deleteOrder: (id: number) => del(`/orders/${id}`),

    // ── Cancel ────────────────────────────────────────────────────────────────
    cancelSubscription: (serialNumber: string) => post(`/cancel/${encodeURIComponent(serialNumber)}`),
    checkExpiring: () => post('/cancel/run/expired'),
    preExpiryAutoCancel: () => post('/cancel/run/pre-expiry'),
    cancelDryRun: () => post('/cancel/run/dry-run'),
    restartCancelScheduler: () => post('/cancel/restart-scheduler'),

    // ── Renewal ───────────────────────────────────────────────────────────────
    checkRenewalEmails: () => post('/logs/renewal-check'),
    renewalDryRun: () => post('/logs/renewal-dry-run'),
    renewSerial: (id: number) => post(`/serials/${id}/renew`),
    testMailConnection: (override?: unknown) => post('/settings/test-mail-connection', override),

    // ── Reports ───────────────────────────────────────────────────────────────
    getDailyReport: () => get('/reports/daily'),
    getMonthlyExpiry: () => get('/reports/monthly-expiry'),
    sendReport: (type: 'daily' | 'monthly') => post(`/reports/send-${type}`),

    // ── Settings ──────────────────────────────────────────────────────────────
    getSettings: () => get('/settings'),
    saveSettings: (data: unknown) => post('/settings', data),
    testSmtp: (override?: unknown) => post('/settings/test-smtp', override),
    testSlack: (override?: unknown) => post('/settings/test-slack', override),
    testSlackRelated: (override?: unknown) => post('/settings/test-slack-related', override),

    // ── Logs ──────────────────────────────────────────────────────────────────
    getLogs: (limit = 100, offset = 0) => get(`/logs?limit=${limit}&offset=${offset}`),
    getTodayLogs: () => get('/logs/today'),
    getSystemLogs: (date?: string) => get('/logs/system' + (date ? `?date=${date}` : '')),
    getCapturedMail: (id: number) => fetch(`${BASE}/logs/mail/${id}`).then(r => r.text()),

    // ── Webhook (stub) ────────────────────────────────────────────────────────
    getWebhookStatus: () => Promise.resolve({ running: false, port: 3000 }),
    startWebhook: () => Promise.resolve({ running: false, port: 3000 }),
    stopWebhook: () => Promise.resolve({ running: false, port: 3000 }),
};

export type Api = typeof api;
