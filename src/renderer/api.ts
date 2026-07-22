/**
 * Web 서버 모드용 API 클라이언트 (fetch 기반)
 * Electron의 window.electronAPI를 대체합니다
 */
import type {
    ActivityLog,
    AppSettings,
    AutoRenewalOrderNoticeLog,
    CancelDryRunResult,
    CancelResult,
    Customer,
    CustomerCreditLog,
    CustomerPortalInfo,
    CustomerSerialSummary,
    DailyReport,
    InboundDryRunResult,
    InboundMail,
    LegacyImportResult,
    MailConnectionResult,
    MailTemplate,
    MergeCandidate,
    MonthlyExpiryReport,
    PendingOrder,
    GroupedOrder,
    PollDryRunResult,
    SerialListResult,
    SerialMailNoticeLog,
    SerialVersionSummary,
    SerialWithCustomer,
    StatsCountsResult,
    StatsSeries,
    BulkUpdatePreview,
    SerialMailSettings,
} from '../shared/types';

// 서버 전용 응답 모양(main 프로세스에 정의되어 있으나 shared/types.ts에는 없음) — 여기서만 쓰는 최소 형태로 로컬 정의
interface TestResult {
    success: boolean;
    message: string;
}

interface AdminReviewRow {
    id: number;
    received_at: string;
    mail_from: string;
    subject: string;
    extracted_serial: string | null;
    response_errors: string;
    response_attempt: number;
}

interface SystemLogsResult {
    systemLogs: string[];
    relatedEmails: string[];
    adminReviews: AdminReviewRow[];
}

interface SchedulerSummary {
    summary: string;
    updated_at: string;
}

interface PollStatus {
    running: boolean;
    lastRun: string;
    message: string;
}

interface LegacyDetectResult {
    available: boolean;
    path: string;
    serial_count: number;
    last_modified: string | null;
}

interface LegacySerialRow {
    id: number;
    serial_number: string;
    customer_name: string;
    customer_email: string;
    customer_phone: string;
    customer_address: string;
    customer_manager: string;
    purchase_date: string | null;
    expiry_date: string | null;
    status: string;
    engine_build: string;
    version: string;
    add_ons: string;
    notes: string;
    created_at: string;
    updated_at: string;
    has_unprocessed_stop_request: boolean;
}

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
        return get<SerialListResult>(`/serials?${params.toString()}`);
    },
    getExpiringSoonSerials: (days = 60, limit = 50) =>
        get<SerialWithCustomer[]>(`/serials/expiring-soon?days=${days}&limit=${limit}`),
    getSerialVersionSummary: () => get<SerialVersionSummary[]>('/serials/version-summary'),
    getSerial: (id: number) => get<SerialWithCustomer>(`/serials/${id}`),
    listSerialMailNoticeLogs: (id: number) => get<SerialMailNoticeLog[]>(`/serials/${id}/mail-notice-logs`),
    listSerialActivityLogs: (id: number) => get<ActivityLog[]>(`/serials/${id}/activity-logs`),
    searchSerials: (q: string) => get<SerialWithCustomer[]>(`/serials/search?q=${encodeURIComponent(q)}`),
    getStats: () => get<StatsCountsResult & { notActivated: number }>('/serials/stats'),
    createSerial: (data: unknown) => post<SerialWithCustomer>('/serials', data),
    updateSerial: (id: number, data: unknown) => put<SerialWithCustomer | undefined>(`/serials/${id}`, data),
    deleteSerial: (id: number) => del<{ ok: boolean }>(`/serials/${id}`),
    addAddon: (id: number, addon: unknown) => post<SerialWithCustomer | undefined>(`/serials/${id}/addon`, addon),
    activateSerial: (id: number) => post<SerialWithCustomer | undefined>(`/serials/${id}/activate`),
    setStopRequested: (id: number, flag: boolean, triggerId?: string) =>
        post<SerialWithCustomer | undefined>(`/serials/${id}/stop-requested`, { flag, triggerId }),
    cancelSerialDb: (id: number) => post<SerialWithCustomer | undefined>(`/serials/${id}/cancel-db`),
    updateSerialMailSettings: (id: number, settings: SerialMailSettings) =>
        post<SerialWithCustomer | undefined>(`/serials/${id}/mail-settings`, settings),
    removeModule: (id: number, name: string) => post<SerialWithCustomer | undefined>(`/serials/${id}/remove-module`, { name }),
    renewSerial: (id: number) => post<SerialWithCustomer | undefined>(`/serials/${id}/renew`),
    sendRenewalPo: (id: number, previousExpiryDate: string | null) =>
        post<TestResult>(`/serials/${id}/send-renewal-po`, { previous_expiry_date: previousExpiryDate }),
    sendRenewalNotice: (id: number, previousExpiryDate: string | null) =>
        post<{ ok: true }>(`/serials/${id}/send-renewal-notice`, { previous_expiry_date: previousExpiryDate }),
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
        // 서버에서 필터 전체를 엑셀로 생성 (list API의 500건 캡 우회 — export-filtered는 LIMIT 없음)
        try {
            const res = await fetch(`${BASE}/serials/export-filtered`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(query),
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

    // 엑셀 벌크 업데이트 (multipart). mode='preview'=dry-run 리포트, 'apply'=백업 후 실제 반영
    bulkUpdate: async (file: File, mode: 'preview' | 'apply'): Promise<BulkUpdatePreview> => {
        const fd = new FormData();
        fd.append('file', file);
        const res = await fetch(`${BASE}/serials/bulk-update?mode=${mode}`, { method: 'POST', body: fd });
        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: res.statusText }));
            throw new Error(err.error || res.statusText);
        }
        return res.json();
    },

    // ── Customers ─────────────────────────────────────────────────────────────
    listCustomers: () => get<Customer[]>('/customers'),
    listCustomerSerialSummaries: () => get<CustomerSerialSummary[]>('/customers/serial-summaries'),
    listCustomerPortalInfo: () => get<CustomerPortalInfo[]>('/customers/portal-info'),
    getCustomerById: (id: number) => get<Customer>(`/customers/${id}`),
    createCustomer: (data: unknown) => post<Customer>('/customers', data),
    updateCustomer: (id: number, data: unknown) => put<Customer>(`/customers/${id}`, data),
    deleteCustomer: (id: number) => del<{ success: boolean; error?: string }>(`/customers/${id}`),
    searchCustomers: (q: string) => get<Customer[]>(`/customers/search?q=${encodeURIComponent(q)}`),
    getCustomerMergeCandidates: (q: unknown) => post<MergeCandidate[]>('/customers/merge-candidates', q),
    getCustomerCreditLogs: (id: number, page = 1) =>
        get<{ items: CustomerCreditLog[]; total: number; totalPages: number }>(`/customers/${id}/credits?page=${page}`),

    // ── Orders ────────────────────────────────────────────────────────────────
    getOrders: () => get<PendingOrder[]>('/orders'),
    listGroupedOrders: () => get<GroupedOrder[]>('/orders/grouped'),
    getPollStatus: () => get<PollStatus>('/orders/poll-status'),
    pollNow: (sourceId?: string, targetDate?: string) =>
        post<{ found: number; errors: string[] }>('/orders/poll-now', { sourceId, targetDate }),
    pollDryRun: (sourceId?: string, overrides?: unknown, targetDate?: string) =>
        post<PollDryRunResult>('/orders/poll-dry-run', { sourceId, sourceOverrides: overrides, targetDate }),
    restartOrderScheduler: () => post<{ ok: boolean }>('/orders/restart-scheduler'),
    updateOrder: (id: number, data: unknown) => put<PendingOrder | undefined>(`/orders/${id}`, data),
    approveOrder: (id: number, data?: unknown) =>
        post<{ success: boolean; error?: string; customer_id?: number; was_renewed?: boolean }>(`/orders/${id}/approve`, data),
    rejectOrder: (id: number) => post<{ ok: boolean }>(`/orders/${id}/reject`),
    deleteOrder: (id: number) => del<{ ok: boolean }>(`/orders/${id}`),

    // ── Cancel ────────────────────────────────────────────────────────────────
    cancelSubscription: (serialNumber: string) => post<CancelResult>(`/cancel/${encodeURIComponent(serialNumber)}`),
    checkExpiring: () => post<CancelResult[]>('/cancel/run/expired'),
    cancelDryRun: () => post<CancelDryRunResult[]>('/cancel/run/dry-run'),
    cancelRestartScheduler: () => post<{ ok: boolean }>('/cancel/restart-scheduler'),

    // ── Automation ────────────────────────────────────────────────────────────
    runAutoRenewNow: () => post<{ processed: number; renewed: number; skipped: number; serials: string[] }>('/automation/run-auto-renew'),
    runAutoCancelNow: () => post<{ processed: number; success: number; failed: number; results: CancelResult[] }>('/automation/run-auto-cancel'),
    runLimboFallbackNow: () => post<{ processed: number; success: number; failed: number; results: CancelResult[] }>('/automation/run-limbo-fallback'),

    // ── Mail Inbound ──────────────────────────────────────────────────────────
    checkInboundNow: () => post<{ processed: number; saved: number; errors: string[] }>('/mail/check-inbound-now'),
    inboundDryRun: () => post<InboundDryRunResult>('/mail/inbound-dry-run'),
    testMailConnection: (override?: unknown) => post<MailConnectionResult>('/mail/test-connection', override),
    listInboundMails: (filter?: unknown) => post<InboundMail[]>('/mail/inbound-mails', filter),
    confirmStopRequestFromMail: (id: number) =>
        post<{ success: boolean; error?: string; serial_number?: string }>(`/mail/inbound-mails/${id}/confirm-stop`),
    sendMissingInfoTemplateForMail: (id: number) => post<TestResult>(`/mail/inbound-mails/${id}/send-missing-info`),

    // ── Mail Templates ────────────────────────────────────────────────────────
    listMailTemplates: () => get<MailTemplate[]>('/mail-templates'),
    getMailTemplate: (code: string) => get<MailTemplate>(`/mail-templates/${code}`),
    upsertMailTemplate: (data: unknown) => post<MailTemplate>('/mail-templates', data),
    deleteMailTemplate: (code: string) => del<{ success: boolean }>(`/mail-templates/${encodeURIComponent(code)}`),
    previewMailTemplate: (code: string, serialId: number) =>
        get<{ subject: string; body: string }>(`/mail-templates/${encodeURIComponent(code)}/preview?serialId=${serialId}`),
    sendMailTemplate: (code: string, to: string, vars: Record<string, string>, options?: unknown) =>
        post<TestResult>('/mail/send-template', { code, to, vars, options }),
    sendTestDryRun: (override?: unknown) => post<TestResult>('/mail/send-test-dry-run', override),

    // ── Stats ─────────────────────────────────────────────────────────────────
    getStatsCounts: () => get<StatsCountsResult & { notActivated: number }>('/serials/stats/counts'),
    getStatsSeries: (granularity: string, range: number) =>
        get<StatsSeries>(`/serials/stats/series?granularity=${granularity}&range=${range}`),
    getStatsFailures: () => get<ActivityLog[]>('/logs?type=failure&limit=20'),

    // ── Settings ──────────────────────────────────────────────────────────────
    getSettings: () => get<AppSettings>('/settings'),
    getSchedulerSummary: () => get<SchedulerSummary>('/settings/scheduler-summary'),
    saveSettings: (data: unknown) => post<AppSettings>('/settings', data),
    testSmtp: (override?: unknown) => post<TestResult>('/mail/test-smtp', override),
    testSlack: (override?: unknown) => post<TestResult>('/settings/test-slack', override),
    testSlackRelated: (override?: unknown) => post<TestResult>('/settings/test-slack-related', override),
    updateDataOrder: (id: number, data: unknown) =>
        post<{ success: boolean; data?: SerialWithCustomer; error?: string }>(`/orders/${id}/update-data`, data),
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
    listReportTimes: () => get<string[]>('/settings/report-times'),
    setReportTimes: (times: string[]) => post<string[]>('/settings/report-times', { times }),
    sendDailyReportNow: () => post<{ ok: boolean }>('/reports/send-daily'),
    runExpiryNoticeDryRun: (input: unknown) =>
        post<{
            success: boolean;
            message: string;
            target_date: string;
            matched_count: number;
            sample_serial?: string;
            sample_sent_to?: string;
        }>('/settings/expiry-notice-dry-run', input),
    runStopLifecycleNoticeDryRun: (input: unknown) =>
        post<{ success: boolean; message: string; sample_serial?: string; sample_sent_to?: string }>(
            '/settings/stop-lifecycle-notice-dry-run', input,
        ),

    // ── Logs ──────────────────────────────────────────────────────────────────
    getLogs: (limit = 100, offset = 0) => get<ActivityLog[]>(`/logs?limit=${limit}&offset=${offset}`),
    getTodayLogs: () => get<ActivityLog[]>('/logs/today'),
    getSystemLogs: (date?: string) => get<SystemLogsResult>('/logs/system' + (date ? `?date=${date}` : '')),
    getCapturedMail: (id: number) => fetch(`${BASE}/logs/mail/${id}`).then(r => r.text()),
    listAutoRenewalOrderNotices: (limit = 100) => get<AutoRenewalOrderNoticeLog[]>(`/logs/auto-renewal-order-notices?limit=${limit}`),
    getAutoRenewalOrderNotice: (id: number) => get<AutoRenewalOrderNoticeLog>(`/logs/auto-renewal-order-notices/${id}`),
    resolveAdminReview: (id: number) => post<{ success: boolean }>(`/logs/admin-review/${id}/resolve`, {}),
    listLogs: (filter?: unknown) => post('/logs/list', filter),
    onLogsPush: (callback: (payload: { id: number }) => void): () => void => {
        const interval = setInterval(() => callback({ id: 0 }), 30000);
        return () => clearInterval(interval);
    },

    // ── Legacy Import ─────────────────────────────────────────────────────────
    detectLegacy: () => get<LegacyDetectResult>('/legacy/detect'),
    listLegacySerials: (filter?: unknown) => post<LegacySerialRow[]>('/legacy/serials', filter),
    suggestLegacyMerge: (row: unknown) => post<MergeCandidate[]>('/legacy/suggest-merge', row),
    importLegacySerial: (input: unknown) => post<LegacyImportResult>('/legacy/import', input),

    // ── Reports ───────────────────────────────────────────────────────────────
    getDailyReport: () => get<DailyReport>('/reports/daily'),
    getMonthlyExpiry: () => get<MonthlyExpiryReport>('/reports/monthly-expiry'),
    sendReport: (type: 'daily' | 'monthly') => post<{ ok: boolean }>(`/reports/send-${type}`),

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
        linkAccountSerial: <T>(id: number, serial: string) => preq<T>('POST', `/accounts/${id}/link-serial`, { serial }),
        listRequests: <T>(q?: { type?: string; status?: string }) => {
            const params = new URLSearchParams();
            if (q?.type) params.set('type', q.type);
            if (q?.status) params.set('status', q.status);
            const qs = params.toString();
            return preq<T>('GET', `/requests${qs ? `?${qs}` : ''}`);
        },
        getActionableRequestCount: <T>() => preq<T>('GET', '/requests/actionable-count'),
        decideRequest: (id: number, action: 'approve' | 'reject') =>
            preq('PATCH', `/requests/${id}/decide`, { action }),
        decideCancelRequest: (id: number, action: 'approve' | 'reject') =>
            preq('PATCH', `/requests/${id}/decide-cancel`, { action }),
        dismissRequest: (id: number) =>
            preq('PATCH', `/requests/${id}/dismiss`),
    },
};

export type Api = typeof api;
