/**
 * electronMock.ts
 *
 * Browser-mode bridge: maps window.electronAPI → api.ts REST calls.
 * Installed on window when running outside Electron (Vite dev/preview).
 * Handles data-shape transformations (flat serial → nested customer).
 */
import { api } from './api';
import type {
  AddOn,
  AppSettings,
  CustomerInput,
  LogFilter,
  MailTemplateUpsert,
  PendingOrder,
  PollSource,
  SerialExportQuery,
  SerialInput,
  SerialWithCustomer,
} from '../shared/types';

type FlatSerial = Partial<SerialWithCustomer> & {
  customer_name?: string;
  customer_email?: string;
  customer_phone?: string;
  customer_address?: string;
  customer_dealer?: string;
  customer_manager?: string;
};

function transformSerial(s: FlatSerial | null | undefined): SerialWithCustomer | null | undefined {
  if (!s) return s;
  if (s.customer && typeof s.customer === 'object') return s;
  return {
    ...s,
    customer: {
      id: s.customer_id ?? 0,
      name: s.customer_name ?? '',
      email: s.customer_email ?? '',
      phone: s.customer_phone ?? '',
      address: s.customer_address ?? '',
      dealer: s.dealer ?? s.customer_dealer ?? '',
      sales_manager: s.sales_manager ?? s.customer_manager ?? '',
    },
  };
}

function stub<T>(name: string, fallback: T): () => Promise<T> {
  return async () => {
    console.warn(`[electronMock] ${name} not available in browser mode`);
    return fallback;
  };
}

const mock: Record<string, unknown> = {
  // ── Serials ────────────────────────────────────────────────────────────────
  // @deprecated Compatibility API. New browser UI should use listSerials.
  getSerials: async () => {
    const list = await api.getSerials() as FlatSerial[];
    return list.map(transformSerial);
  },
  listSerials: async (query: unknown) => {
    const result = await api.listSerials(query as Record<string, unknown>) as { items: FlatSerial[] };
    return { ...result, items: result.items.map(transformSerial) };
  },
  getExpiringSoonSerials: async (days?: number, limit?: number) => {
    const list = await api.getExpiringSoonSerials(days, limit) as FlatSerial[];
    return list.map(transformSerial);
  },
  getSerialVersionSummary: () => api.getSerialVersionSummary(),
  getSerialById: async (id: number) => {
    const s = await api.getSerialById(id) as FlatSerial | undefined;
    return s ? transformSerial(s) : undefined;
  },
  createSerial: async (input: SerialInput) => transformSerial(await api.createSerial(input) as FlatSerial),
  updateSerial: async (id: number, input: Partial<SerialInput>) => {
    const s = await api.updateSerial(id, input) as FlatSerial;
    return s ? transformSerial(s) : undefined;
  },
  deleteSerial: (id: number) => api.deleteSerial(id),
  searchSerials: async (q: string) => {
    const list = await api.searchSerials(q) as FlatSerial[];
    return list.map(transformSerial);
  },
  addAddon: (id: number, addon: AddOn) => api.addAddon(id, addon),
  bulkImport: (): Promise<{ imported: number; errors: string[] }> =>
    new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.xlsx,.xls';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) { resolve({ imported: 0, errors: [] }); return; }
        try {
          const result = await api.bulkImport(file);
          resolve(result);
        } catch (e: unknown) {
          reject(e);
        }
      };
      input.click();
    }),
  downloadExcelTemplate: async () => {
    api.downloadTemplate();
    return { success: true };
  },
  exportSerials: (serials: SerialWithCustomer[]) => api.exportSerials(serials),
  exportSerialsByFilter: (query: SerialExportQuery) => api.exportSerialsByFilter(query),

  // ── Serial domain actions ──────────────────────────────────────────────────
  activateSerial: async (id: number) => transformSerial(await api.activateSerial(id)),
  setStopRequested: (id: number, flag: boolean, triggerId?: string) =>
    api.setStopRequested(id, flag, triggerId),
  renewSerial: async (id: number) => transformSerial(await api.renewSerial(id)),
  cancelSerialDb: async (id: number) => transformSerial(await api.cancelSerialDb(id)),
  removeModule: (id: number, name: string) => api.removeModule(id, name),

  // ── Customer CRUD ──────────────────────────────────────────────────────────
  listCustomers: () => api.listCustomers(),
  listCustomerSerialSummaries: () => api.listCustomerSerialSummaries(),
  getCustomerById: (id: number) => api.getCustomerById(id),
  createCustomer: (input: CustomerInput) => api.createCustomer(input),
  updateCustomer: (id: number, input: Partial<CustomerInput>) => api.updateCustomer(id, input),
  deleteCustomer: (id: number) => api.deleteCustomer(id),
  searchCustomers: (q: string) => api.searchCustomers(q),
  getCustomerMergeCandidates: (q: { email?: string; name?: string; phone?: string; dealer?: string }) =>
    api.getCustomerMergeCandidates(q),

  // ── Cancel ────────────────────────────────────────────────────────────────
  cancelSubscription: (serialNumber: string) => api.cancelSubscription(serialNumber),
  checkExpiring: () => api.checkExpiring(),
  cancelDryRun: () => api.cancelDryRun(),
  cancelRestartScheduler: () => api.cancelRestartScheduler(),

  // ── Automation ────────────────────────────────────────────────────────────
  runAutoRenewNow: () => api.runAutoRenewNow(),
  runAutoCancelNow: () => api.runAutoCancelNow(),
  runLimboFallbackNow: () => api.runLimboFallbackNow(),

  // ── Mail Inbound ──────────────────────────────────────────────────────────
  checkInboundNow: () => api.checkInboundNow(),
  inboundDryRun: () => api.inboundDryRun(),
  testMailConnection: (override?: Partial<AppSettings>) => api.testMailConnection(override),
  listInboundMails: (filter?: { classification?: string[]; limit?: number; offset?: number }) =>
    api.listInboundMails(filter),
  confirmStopRequestFromMail: (id: number) => api.confirmStopRequestFromMail(id),
  sendMissingInfoTemplateForMail: (id: number) => api.sendMissingInfoTemplateForMail(id),

  // ── Mail Templates ────────────────────────────────────────────────────────
  sendMailTemplate: (code: string, to: string, vars: Record<string, string>, options?: Record<string, unknown>) =>
    api.sendMailTemplate(code, to, vars, options),
  testSmtp: (override?: Partial<AppSettings>) => api.testSmtp(override),
  sendTestDryRun: (override?: Partial<AppSettings>) => api.sendTestDryRun(override),
  listMailTemplates: () => api.listMailTemplates(),
  getMailTemplate: (code: string) => api.getMailTemplate(code),
  upsertMailTemplate: (tmpl: MailTemplateUpsert) => api.upsertMailTemplate(tmpl),
  deleteMailTemplate: (code: string) => api.deleteMailTemplate(code),
  previewMailTemplate: (code: string, serialId: number) => api.previewMailTemplate(code, serialId),

  // ── Stats ─────────────────────────────────────────────────────────────────
  getStatsCounts: () => api.getStatsCounts(),
  getStatsSeries: (g: 'day' | 'month' | 'year', r: number) => api.getStatsSeries(g, r),
  getStatsFailures: () => api.getStatsFailures(),

  // ── Settings ──────────────────────────────────────────────────────────────
  getSettings: () => api.getSettings(),
  saveSettings: (settings: Partial<AppSettings>) => api.saveSettings(settings),
  exportSettings: () => api.exportSettings(),
  importSettings: () => api.importSettings(),

  // ── Logs ──────────────────────────────────────────────────────────────────
  listLogs: (filter?: LogFilter) => api.listLogs(filter),
  onLogsPush: (cb: (payload: { id: number }) => void): () => void => api.onLogsPush(cb),

  // ── Orders ────────────────────────────────────────────────────────────────
  getOrders: () => api.getOrders(),
  listGroupedOrders: () => api.listGroupedOrders(),
  approveOrder: (id: number, options?: { serial_status?: string; customer_id?: number; customer_data?: CustomerInput }) =>
    api.approveOrder(id, options),
  rejectOrder: (id: number) => api.rejectOrder(id),
  updateOrder: (id: number, data: Partial<PendingOrder>) => api.updateOrder(id, data),
  updateDataOrder: (id: number, data: Partial<PendingOrder>) => api.updateDataOrder(id, data),
  deleteOrder: (id: number) => api.deleteOrder(id),
  pollNow: (sourceId?: string) => api.pollNow(sourceId),
  pollDryRun: (sourceId?: string, overrides?: Partial<PollSource>) => api.pollDryRun(sourceId, overrides),
  getPollStatus: () => api.getPollStatus(),
  restartScheduler: () => api.restartOrderScheduler(),

  // ── Extra stubs ───────────────────────────────────────────────────────────
  checkRenewalEmails: () => api.checkRenewalEmails(),
  renewalDryRun: () => api.renewalDryRun(),
  testSlackRelated: (override?: Partial<AppSettings>) => api.testSlackRelated(override),
  // ── Notification ──────────────────────────────────────────────────────────
  testSlackWebhook: (override?: Partial<AppSettings>) => api.testSlackWebhook(override),
  sendDailyReportNow: () => api.sendDailyReportNow(),
  listReportTimes: () => api.listReportTimes(),
  setReportTimes: (times: string[]) => api.setReportTimes(times),
  runExpiryNoticeDryRun: (input: unknown) => api.runExpiryNoticeDryRun(input),
  runStopLifecycleNoticeDryRun: (input: unknown) => api.runStopLifecycleNoticeDryRun(input),

  // ── Legacy Import ─────────────────────────────────────────────────────────
  detectLegacy: () => api.detectLegacy(),
  listLegacySerials: (filter?: { status?: string[]; limit?: number; offset?: number }) => api.listLegacySerials(filter),
  suggestLegacyMerge: (row: unknown) => api.suggestLegacyMerge(row),
  importLegacySerial: (input: unknown) => api.importLegacySerial(input),

  // ── Webhook ───────────────────────────────────────────────────────────────
  getWebhookStatus: () => api.getWebhookStatus(),
  startWebhookServer: () => api.startWebhookServer(),
  stopWebhookServer: () => api.stopWebhookServer(),
};

const browserWindow = window as Window & { electronAPI?: unknown };
if (!browserWindow.electronAPI) {
  browserWindow.electronAPI = mock;
}
