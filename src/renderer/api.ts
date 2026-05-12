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

export const api = {
    // ── Serials ────────────────────────────────────────────────────────────────
    getSerials: () => get('/serials'),
    getSerial: (id: number) => get(`/serials/${id}`),
    getSerialById: (id: number) => get(`/serials/${id}`),
    searchSerials: (q: string) => get(`/serials/search?q=${encodeURIComponent(q)}`),
    getStats: () => get('/serials/stats'),
    createSerial: (data: unknown) => post('/serials', data),
    updateSerial: (id: number, data: unknown) => put(`/serials/${id}`, data),
    deleteSerial: (id: number) => del(`/serials/${id}`),
    addAddon: (id: number, addon: unknown) => post(`/serials/${id}/addon`, addon),
    activateSerial: (id: number) => post(`/serials/${id}/activate`),
    setStopRequested: (id: number, flag: boolean, triggerId?: string) =>
        post(`/serials/${id}/stop-requested`, { flag, triggerId }),
    cancelSerialDb: (id: number) => post(`/serials/${id}/cancel-db`),
    removeModule: (id: number, name: string) => post(`/serials/${id}/remove-module`, { name }),
    renewSerial: (id: number) => post(`/serials/${id}/renew`),
    exportSerials: async (serials: unknown[]) => {
        try {
            await post('/serials/export', { serials });
            return { success: true };
        } catch {
            return { success: false, error: 'Export not supported in browser mode' };
        }
    },

    // 엑셀 템플릿 다운로드
    downloadTemplate: () => { window.location.href = `${BASE}/serials/template/download`; },

    // 엑셀 대량 임포트 (multipart)
    bulkImport: async (file: File) => {
        const fd = new FormData();
        fd.append('file', file);
        const res = await fetch(`${BASE}/serials/bulk-import`, { method: 'POST', body: fd });
        if (!res.ok) throw new Error((await res.json()).error);
        return res.json();
    },

    // ── Customers ─────────────────────────────────────────────────────────────
    listCustomers: () => get('/customers'),
    getCustomerById: (id: number) => get(`/customers/${id}`),
    createCustomer: (data: unknown) => post('/customers', data),
    updateCustomer: (id: number, data: unknown) => put(`/customers/${id}`, data),
    deleteCustomer: (id: number) => del(`/customers/${id}`),
    searchCustomers: (q: string) => get(`/customers/search?q=${encodeURIComponent(q)}`),
    getCustomerMergeCandidates: (q: unknown) => post('/customers/merge-candidates', q),

    // ── Orders ────────────────────────────────────────────────────────────────
    getOrders: () => get('/orders'),
    listGroupedOrders: () => get('/orders/grouped'),
    getPollStatus: () => get('/orders/poll-status'),
    pollNow: (sourceId?: string) => post('/orders/poll-now', { sourceId }),
    pollDryRun: (sourceId?: string, overrides?: unknown) =>
        post('/orders/poll-dry-run', { sourceId, sourceOverrides: overrides }),
    restartOrderScheduler: () => post('/orders/restart-scheduler'),
    updateOrder: (id: number, data: unknown) => put(`/orders/${id}`, data),
    approveOrder: (id: number, data?: unknown) => post(`/orders/${id}/approve`, data),
    rejectOrder: (id: number) => post(`/orders/${id}/reject`),
    deleteOrder: (id: number) => del(`/orders/${id}`),

    // ── Cancel ────────────────────────────────────────────────────────────────
    cancelSubscription: (serialNumber: string) => post(`/cancel/${encodeURIComponent(serialNumber)}`),
    checkExpiring: () => post('/cancel/run/expired'),
    cancelDryRun: () => post('/cancel/run/dry-run'),
    cancelRestartScheduler: () => post('/cancel/restart-scheduler'),

    // ── Automation ────────────────────────────────────────────────────────────
    runAutoRenewNow: () => post('/automation/run-auto-renew'),
    runAutoCancelNow: () => post('/automation/run-auto-cancel'),
    runLimboFallbackNow: () => post('/automation/run-limbo-fallback'),

    // ── Mail Inbound ──────────────────────────────────────────────────────────
    checkInboundNow: () => post('/mail/check-inbound-now'),
    inboundDryRun: () => post('/mail/inbound-dry-run'),
    testMailConnection: (override?: unknown) => post('/mail/test-connection', override),
    listInboundMails: (filter?: unknown) => post('/mail/inbound-mails', filter),
    confirmStopRequestFromMail: (id: number) => post(`/mail/inbound-mails/${id}/confirm-stop`),
    sendMissingInfoTemplateForMail: (id: number) => post(`/mail/inbound-mails/${id}/send-missing-info`),

    // ── Mail Templates ────────────────────────────────────────────────────────
    listMailTemplates: () => get('/mail-templates'),
    getMailTemplate: (code: string) => get(`/mail-templates/${code}`),
    upsertMailTemplate: (data: unknown) => post('/mail-templates', data),
    deleteMailTemplate: (code: string) => del(`/mail-templates/${encodeURIComponent(code)}`),
    previewMailTemplate: (code: string, serialId: number) =>
        get(`/mail-templates/${encodeURIComponent(code)}/preview?serialId=${serialId}`),
    sendMailTemplate: (code: string, to: string, vars: Record<string, string>, options?: unknown) =>
        post('/mail/send-template', { code, to, vars, options }),
    sendTestDryRun: (override?: unknown) => post('/mail/send-test-dry-run', override),

    // ── Stats ─────────────────────────────────────────────────────────────────
    getStatsCounts: () => get('/serials/stats/counts'),
    getStatsSeries: (granularity: string, range: number) =>
        get(`/serials/stats/series?granularity=${granularity}&range=${range}`),
    getStatsFailures: () => get('/logs?type=failure&limit=20'),

    // ── Settings ──────────────────────────────────────────────────────────────
    getSettings: () => get('/settings'),
    saveSettings: (data: unknown) => post('/settings', data),
    testSmtp: (override?: unknown) => post('/mail/test-smtp', override),
    testSlack: (override?: unknown) => post('/settings/test-slack', override),
    testSlackWebhook: (override?: unknown) => post('/settings/test-slack', override),
    testSlackRelated: (override?: unknown) => post('/settings/test-slack-related', override),
    renewalDryRun: () => post('/mail/inbound-dry-run'),
    checkRenewalEmails: () => post('/mail/check-inbound-now'),
    updateDataOrder: (id: number, data: unknown) => post(`/orders/${id}/update-data`, data),
    exportSettings: () => post('/settings/export'),
    importSettings: () => post('/settings/import'),
    listReportTimes: () => get('/settings/report-times'),
    setReportTimes: (times: string[]) => post('/settings/report-times', { times }),
    sendDailyReportNow: () => post('/reports/send-daily'),
    runExpiryNoticeDryRun: (input: unknown) => post('/settings/expiry-notice-dry-run', input),
    runStopLifecycleNoticeDryRun: (input: unknown) => post('/settings/stop-lifecycle-notice-dry-run', input),

    // ── Logs ──────────────────────────────────────────────────────────────────
    getLogs: (limit = 100, offset = 0) => get(`/logs?limit=${limit}&offset=${offset}`),
    getTodayLogs: () => get('/logs/today'),
    getSystemLogs: (date?: string) => get('/logs/system' + (date ? `?date=${date}` : '')),
    getCapturedMail: (id: number) => fetch(`${BASE}/logs/mail/${id}`).then(r => r.text()),
    listLogs: (filter?: unknown) => post('/logs/list', filter),
    onLogsPush: (callback: (payload: { id: number }) => void): () => void => {
        const interval = setInterval(() => callback({ id: 0 }), 30000);
        return () => clearInterval(interval);
    },

    // ── Legacy Import ─────────────────────────────────────────────────────────
    detectLegacy: () => get('/legacy/detect'),
    listLegacySerials: (filter?: unknown) => post('/legacy/serials', filter),
    suggestLegacyMerge: (row: unknown) => post('/legacy/suggest-merge', row),
    importLegacySerial: (input: unknown) => post('/legacy/import', input),

    // ── Reports ───────────────────────────────────────────────────────────────
    getDailyReport: () => get('/reports/daily'),
    getMonthlyExpiry: () => get('/reports/monthly-expiry'),
    sendReport: (type: 'daily' | 'monthly') => post(`/reports/send-${type}`),

    // ── Webhook ───────────────────────────────────────────────────────────────
    getWebhookStatus: () => get<{ running: boolean; port: number }>('/webhook/status'),
    startWebhook: () => post<{ running: boolean; port: number }>('/webhook/start'),
    stopWebhook: () => post<{ running: boolean; port: number }>('/webhook/stop'),
    startWebhookServer: () => post<{ running: boolean; port: number }>('/webhook/start'),
    stopWebhookServer: () => post<{ running: boolean; port: number }>('/webhook/stop'),
};

export type Api = typeof api;
