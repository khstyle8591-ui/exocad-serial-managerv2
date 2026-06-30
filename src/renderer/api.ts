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

// 포털 admin API는 /portal/admin (BasicAuth는 매니저와 동일 자격증명) — /api 프리픽스 없음
async function preq<T>(method: string, path: string, body?: unknown): Promise<T> {
    const opts: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(`/portal/admin${path}`, opts);
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || res.statusText);
    }
    return res.json();
}

export const api = {
    // ── Serials ────────────────────────────────────────────────────────────────
    listSerials: (query: {
        limit?: number;
        offset?: number;
        search?: string;
        status?: string;
        customer_id?: number;
        renewal_stop_requested?: boolean;
        expiring_this_month?: boolean;
    }) => {
        const params = new URLSearchParams({ paged: '1' });
        for (const [key, value] of Object.entries(query)) {
            if (value !== undefined && value !== '') params.set(key, String(value));
        }
        return get(`/serials?${params.toString()}`);
    },
    getExpiringSoonSerials: (days = 60, limit = 50) =>
        get(`/serials/expiring-soon?days=${days}&limit=${limit}`),
    getSerialVersionSummary: () => get('/serials/version-summary'),
    getSerial: (id: number) => get(`/serials/${id}`),
    listSerialMailNoticeLogs: (id: number) => get(`/serials/${id}/mail-notice-logs`),
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
    sendRenewalPo: (id: number, previousExpiryDate: string | null) =>
        post(`/serials/${id}/send-renewal-po`, { previous_expiry_date: previousExpiryDate }),
    sendRenewalNotice: (id: number, previousExpiryDate: string | null) =>
        post(`/serials/${id}/send-renewal-notice`, { previous_expiry_date: previousExpiryDate }),
    exportSerials: async (serials: unknown[]) => {
        try {
            const res = await fetch(`${BASE}/serials/export`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ serials }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({ error: res.statusText }));
                throw new Error(err.error || res.statusText);
            }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'serials.xlsx';
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            return { success: true };
        } catch (err) {
            return { success: false, error: err instanceof Error ? err.message : 'Export failed' };
        }
    },
    exportSerialsByFilter: async (query: Record<string, unknown>) => {
        const data = await api.listSerials({ ...query, limit: 10000, offset: 0 }) as { items: unknown[] };
        return api.exportSerials(data.items);
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
    listCustomerSerialSummaries: () => get('/customers/serial-summaries'),
    listCustomerPortalInfo: () => get('/customers/portal-info'),
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
    pollNow: (sourceId?: string, targetDate?: string) => post('/orders/poll-now', { sourceId, targetDate }),
    pollDryRun: (sourceId?: string, overrides?: unknown, targetDate?: string) =>
        post('/orders/poll-dry-run', { sourceId, sourceOverrides: overrides, targetDate }),
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
    getSchedulerSummary: () => get('/settings/scheduler-summary'),
    saveSettings: (data: unknown) => post('/settings', data),
    testSmtp: (override?: unknown) => post('/mail/test-smtp', override),
    testSlack: (override?: unknown) => post('/settings/test-slack', override),
    testSlackRelated: (override?: unknown) => post('/settings/test-slack-related', override),
    updateDataOrder: (id: number, data: unknown) => post(`/orders/${id}/update-data`, data),
    exportSettings: async () => {
        const settings = await api.getSettings();
        const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'exocad-settings.json';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        return { success: true };
    },
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
    listAutoRenewalOrderNotices: (limit = 100) => get(`/logs/auto-renewal-order-notices?limit=${limit}`),
    getAutoRenewalOrderNotice: (id: number) => get(`/logs/auto-renewal-order-notices/${id}`),
    resolveAdminReview: (id: number) => post(`/logs/admin-review/${id}/resolve`, {}),
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

    // ── Portal Admin (/portal/admin) ───────────────────────────────────────────
    portal: {
        getSettings: <T>() => preq<T>('GET', '/settings'),
        saveSettings: (data: unknown) => preq('PATCH', '/settings', data),
        listAccounts: <T>() => preq<T>('GET', '/accounts'),
        getAccount: <T>(id: number) => preq<T>('GET', `/accounts/${id}`),
        updateAccount: (id: number, data: unknown) => preq('PATCH', `/accounts/${id}`, data),
        setAccountStatus: (id: number, status: string) => preq('PATCH', `/accounts/${id}/status`, { status }),
        syncAccountToCustomer: (id: number) => preq('POST', `/accounts/${id}/sync-to-customer`, {}),
        listRequests: <T>(q?: { type?: string; status?: string }) => {
            const params = new URLSearchParams();
            if (q?.type) params.set('type', q.type);
            if (q?.status) params.set('status', q.status);
            const qs = params.toString();
            return preq<T>('GET', `/requests${qs ? `?${qs}` : ''}`);
        },
        decideRequest: (id: number, action: 'approve' | 'reject') =>
            preq('PATCH', `/requests/${id}/decide`, { action }),
        decideCancelRequest: (id: number, action: 'approve' | 'reject') =>
            preq('PATCH', `/requests/${id}/decide-cancel`, { action }),
    },
};

export type Api = typeof api;
