/**
 * electronMock.ts
 *
 * Browser-mode bridge: maps window.electronAPI → api.ts REST calls.
 * Installed on window when running outside Electron (Vite dev/preview).
 * Handles data-shape transformations (flat serial → nested customer).
 */
import { api } from './api';

function transformSerial(s: any): any {
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

const mock: any = {
  // ── Serials ────────────────────────────────────────────────────────────────
  getSerials: async () => {
    const list = await api.getSerials() as any[];
    return list.map(transformSerial);
  },
  getSerialById: async (id: number) => {
    const s = await api.getSerialById(id) as any;
    return s ? transformSerial(s) : undefined;
  },
  createSerial: async (input: any) => transformSerial(await api.createSerial(input)),
  updateSerial: async (id: number, input: any) => {
    const s = await api.updateSerial(id, input) as any;
    return s ? transformSerial(s) : undefined;
  },
  deleteSerial: (id: number) => api.deleteSerial(id),
  searchSerials: async (q: string) => {
    const list = await api.searchSerials(q) as any[];
    return list.map(transformSerial);
  },
  addAddon: (id: number, addon: any) => api.addAddon(id, addon),
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
          resolve(result as any);
        } catch (e: any) {
          reject(e);
        }
      };
      input.click();
    }),
  downloadExcelTemplate: async () => {
    api.downloadTemplate();
    return { success: true };
  },
  exportSerials: (serials: any[]) => api.exportSerials(serials),

  // ── Serial domain actions ──────────────────────────────────────────────────
  activateSerial: async (id: number) => transformSerial(await api.activateSerial(id)),
  setStopRequested: (id: number, flag: boolean, triggerId?: string) =>
    api.setStopRequested(id, flag, triggerId),
  renewSerial: async (id: number) => transformSerial(await api.renewSerial(id)),
  cancelSerialDb: async (id: number) => transformSerial(await api.cancelSerialDb(id)),
  removeModule: (id: number, name: string) => api.removeModule(id, name),

  // ── Customer CRUD ──────────────────────────────────────────────────────────
  listCustomers: () => api.listCustomers(),
  getCustomerById: (id: number) => api.getCustomerById(id),
  createCustomer: (input: any) => api.createCustomer(input),
  updateCustomer: (id: number, input: any) => api.updateCustomer(id, input),
  deleteCustomer: (id: number) => api.deleteCustomer(id),
  searchCustomers: (q: string) => api.searchCustomers(q),
  getCustomerMergeCandidates: (q: any) => api.getCustomerMergeCandidates(q),

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
  testMailConnection: (override?: any) => api.testMailConnection(override),
  listInboundMails: (filter?: any) => api.listInboundMails(filter),
  confirmStopRequestFromMail: (id: number) => api.confirmStopRequestFromMail(id),
  sendMissingInfoTemplateForMail: (id: number) => api.sendMissingInfoTemplateForMail(id),

  // ── Mail Templates ────────────────────────────────────────────────────────
  sendMailTemplate: (code: string, to: string, vars: Record<string, string>, options?: any) =>
    api.sendMailTemplate(code, to, vars, options),
  testSmtp: (override?: any) => api.testSmtp(override),
  sendTestDryRun: (override?: any) => api.sendTestDryRun(override),
  listMailTemplates: () => api.listMailTemplates(),
  getMailTemplate: (code: string) => api.getMailTemplate(code),
  upsertMailTemplate: (tmpl: any) => api.upsertMailTemplate(tmpl),
  deleteMailTemplate: (code: string) => api.deleteMailTemplate(code),
  previewMailTemplate: (code: string, serialId: number) => api.previewMailTemplate(code, serialId),

  // ── Stats ─────────────────────────────────────────────────────────────────
  getStatsCounts: () => api.getStatsCounts(),
  getStatsSeries: (g: any, r: number) => api.getStatsSeries(g, r),
  getStatsFailures: () => api.getStatsFailures(),

  // ── Settings ──────────────────────────────────────────────────────────────
  getSettings: () => api.getSettings(),
  saveSettings: (settings: any) => api.saveSettings(settings),
  exportSettings: () => api.exportSettings(),
  importSettings: () => api.importSettings(),

  // ── Logs ──────────────────────────────────────────────────────────────────
  listLogs: (filter?: any) => api.listLogs(filter),
  onLogsPush: (cb: (payload: { id: number }) => void): () => void => api.onLogsPush(cb),

  // ── Orders ────────────────────────────────────────────────────────────────
  getOrders: () => api.getOrders(),
  listGroupedOrders: () => api.listGroupedOrders(),
  approveOrder: (id: number, options?: any) => api.approveOrder(id, options),
  rejectOrder: (id: number) => api.rejectOrder(id),
  updateOrder: (id: number, data: any) => api.updateOrder(id, data),
  deleteOrder: (id: number) => api.deleteOrder(id),
  pollNow: (sourceId?: string) => api.pollNow(sourceId),
  pollDryRun: (sourceId?: string, overrides?: any) => api.pollDryRun(sourceId, overrides),
  getPollStatus: () => api.getPollStatus(),
  restartScheduler: () => api.restartOrderScheduler(),

  // ── Extra stubs ───────────────────────────────────────────────────────────
  checkRenewalEmails: () => api.checkRenewalEmails(),
  renewalDryRun: () => api.renewalDryRun(),
  testSlackRelated: (override?: any) => api.testSlackRelated(override),
  updateDataOrder: (id: number, data: any) => api.updateDataOrder(id, data),

  // ── Notification ──────────────────────────────────────────────────────────
  testSlackWebhook: (override?: any) => api.testSlackWebhook(override),
  sendDailyReportNow: () => api.sendDailyReportNow(),
  listReportTimes: () => api.listReportTimes(),
  setReportTimes: (times: string[]) => api.setReportTimes(times),
  runExpiryNoticeDryRun: (input: any) => api.runExpiryNoticeDryRun(input),
  runStopLifecycleNoticeDryRun: (input: any) => api.runStopLifecycleNoticeDryRun(input),

  // ── Legacy Import ─────────────────────────────────────────────────────────
  detectLegacy: () => api.detectLegacy(),
  listLegacySerials: (filter?: any) => api.listLegacySerials(filter),
  suggestLegacyMerge: (row: any) => api.suggestLegacyMerge(row),
  importLegacySerial: (input: any) => api.importLegacySerial(input),

  // ── Webhook ───────────────────────────────────────────────────────────────
  getWebhookStatus: () => api.getWebhookStatus(),
  startWebhookServer: () => api.startWebhookServer(),
  stopWebhookServer: () => api.stopWebhookServer(),
};

if (!(window as any).electronAPI) {
  (window as any).electronAPI = mock;
}
