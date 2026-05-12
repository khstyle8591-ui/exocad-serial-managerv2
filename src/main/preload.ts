import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // ── Serial CRUD ──────────────────────────────────────────────────────────────
  getSerials: () => ipcRenderer.invoke('serial:getAll'),
  getSerialById: (id: number) => ipcRenderer.invoke('serial:getById', id),
  createSerial: (input: any) => ipcRenderer.invoke('serial:create', input),
  updateSerial: (id: number, input: any) => ipcRenderer.invoke('serial:update', id, input),
  deleteSerial: (id: number) => ipcRenderer.invoke('serial:delete', id),
  searchSerials: (query: string) => ipcRenderer.invoke('serial:search', query),
  addAddon: (id: number, addon: any) => ipcRenderer.invoke('serial:addAddon', id, addon),
  bulkImport: () => ipcRenderer.invoke('serial:bulkImport'),
  downloadExcelTemplate: () => ipcRenderer.invoke('excel:downloadTemplate'),
  exportSerials: (serials: any[]) => ipcRenderer.invoke('excel:exportSerials', serials),

  // ── Serial domain actions ────────────────────────────────────────────────────
  activateSerial: (id: number) => ipcRenderer.invoke('serial:activate', id),
  setStopRequested: (id: number, flag: boolean, triggerId?: string) =>
    ipcRenderer.invoke('serial:setStopRequested', id, flag, triggerId),
  renewSerial: (id: number) => ipcRenderer.invoke('serial:renew', id),
  cancelSerialDb: (id: number) => ipcRenderer.invoke('serial:cancelDb', id),
  removeModule: (id: number, moduleName: string) =>
    ipcRenderer.invoke('serial:removeModule', id, moduleName),

  // ── Customer CRUD ────────────────────────────────────────────────────────────
  listCustomers: () => ipcRenderer.invoke('customer:list'),
  getCustomerById: (id: number) => ipcRenderer.invoke('customer:getById', id),
  createCustomer: (input: any) => ipcRenderer.invoke('customer:create', input),
  updateCustomer: (id: number, input: any) => ipcRenderer.invoke('customer:update', id, input),
  deleteCustomer: (id: number) => ipcRenderer.invoke('customer:delete', id),
  searchCustomers: (query: string) => ipcRenderer.invoke('customer:search', query),
  getCustomerMergeCandidates: (query: any) =>
    ipcRenderer.invoke('customer:mergeCandidates', query),

  // ── Cancel (Playwright) ──────────────────────────────────────────────────────
  cancelSubscription: (serialNumber: string) =>
    ipcRenderer.invoke('cancel:subscription', serialNumber),
  checkExpiring: () => ipcRenderer.invoke('cancel:checkExpiring'),
  cancelDryRun: () => ipcRenderer.invoke('cancel:dryRun'),
  cancelRestartScheduler: () => ipcRenderer.invoke('cancel:restartScheduler'),

  // ── Automation crons ─────────────────────────────────────────────────────────
  runAutoRenewNow: () => ipcRenderer.invoke('automation:runAutoRenewNow'),
  runAutoCancelNow: () => ipcRenderer.invoke('automation:runAutoCancelNow'),
  runLimboFallbackNow: () => ipcRenderer.invoke('automation:runLimboFallbackNow'),

  // ── Mail — Inbound ───────────────────────────────────────────────────────────
  checkInboundNow: () => ipcRenderer.invoke('mail:checkInboundNow'),
  inboundDryRun: () => ipcRenderer.invoke('mail:inboundDryRun'),
  testMailConnection: (settingsOverride?: any) =>
    ipcRenderer.invoke('mail:testConnection', settingsOverride),
  listInboundMails: (filter?: any) => ipcRenderer.invoke('mail:listInbound', filter),
  confirmStopRequestFromMail: (id: number) => ipcRenderer.invoke('mail:confirmStopRequest', id),
  sendMissingInfoTemplateForMail: (id: number) =>
    ipcRenderer.invoke('mail:sendMissingInfoTemplate', id),

  // ── Mail — Outbound + Templates ──────────────────────────────────────────────
  sendMailTemplate: (code: string, to: string, vars: any, options?: any) =>
    ipcRenderer.invoke('mail:sendTemplate', code, to, vars, options),
  testSmtp: (settingsOverride?: any) => ipcRenderer.invoke('mail:testSmtp', settingsOverride),
  sendTestDryRun: (settingsOverride?: any) =>
    ipcRenderer.invoke('mail:sendTestDryRun', settingsOverride),
  listMailTemplates: () => ipcRenderer.invoke('mailTemplate:list'),
  getMailTemplate: (code: string) => ipcRenderer.invoke('mailTemplate:get', code),
  upsertMailTemplate: (template: any) => ipcRenderer.invoke('mailTemplate:upsert', template),
  deleteMailTemplate: (code: string) => ipcRenderer.invoke('mailTemplate:delete', code),
  previewMailTemplate: (code: string, serialId: number) =>
    ipcRenderer.invoke('mailTemplate:preview', code, serialId),

  // ── Stats ────────────────────────────────────────────────────────────────────
  getStatsCounts: () => ipcRenderer.invoke('stats:counts'),
  getStatsSeries: (granularity: string, range: number) =>
    ipcRenderer.invoke('stats:series', granularity, range),
  getStatsFailures: () => ipcRenderer.invoke('stats:failures'),

  // ── Settings ─────────────────────────────────────────────────────────────────
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: any) => ipcRenderer.invoke('settings:save', settings),
  exportSettings: () => ipcRenderer.invoke('settings:export'),
  importSettings: () => ipcRenderer.invoke('settings:import'),

  // ── Logs ─────────────────────────────────────────────────────────────────────
  listLogs: (filter?: any) => ipcRenderer.invoke('logs:list', filter),

  // logs:push — main→renderer push event (returns cleanup function)
  onLogsPush: (callback: (payload: { id: number }) => void) => {
    const handler = (_event: any, payload: { id: number }) => callback(payload);
    ipcRenderer.on('logs:push', handler);
    return () => ipcRenderer.removeListener('logs:push', handler);
  },

  // ── Orders ───────────────────────────────────────────────────────────────────
  getOrders: () => ipcRenderer.invoke('order:getPending'),
  listGroupedOrders: () => ipcRenderer.invoke('order:listGrouped'),
  approveOrder: (id: number, options?: any) => ipcRenderer.invoke('order:approve', id, options),
  rejectOrder: (id: number) => ipcRenderer.invoke('order:reject', id),
  updateOrder: (id: number, data: any) => ipcRenderer.invoke('order:update', id, data),
  deleteOrder: (id: number) => ipcRenderer.invoke('order:delete', id),
  pollNow: (sourceId?: string) => ipcRenderer.invoke('order:pollNow', sourceId),
  pollDryRun: (sourceId?: string, sourceOverrides?: any) =>
    ipcRenderer.invoke('order:pollDryRun', sourceId, sourceOverrides),
  getPollStatus: () => ipcRenderer.invoke('order:getPollStatus'),
  restartScheduler: () => ipcRenderer.invoke('order:restartScheduler'),

  // ── Notification ─────────────────────────────────────────────────────────────
  testSlackWebhook: (settingsOverride?: any) =>
    ipcRenderer.invoke('notification:testSlack', settingsOverride),
  sendDailyReportNow: () => ipcRenderer.invoke('notification:sendDailyReportNow'),
  listReportTimes: () => ipcRenderer.invoke('notification:listReportTimes'),
  setReportTimes: (times: string[]) =>
    ipcRenderer.invoke('notification:setReportTimes', times),
  runExpiryNoticeDryRun: (input: any) => ipcRenderer.invoke('expiryNotice:dryRun', input),
  runStopLifecycleNoticeDryRun: (input: any) => ipcRenderer.invoke('stopLifecycleNotice:dryRun', input),

  // ── Legacy Import ─────────────────────────────────────────────────────────────
  detectLegacy: () => ipcRenderer.invoke('legacy:detect'),
  listLegacySerials: (filter?: any) => ipcRenderer.invoke('legacy:listSerials', filter),
  suggestLegacyMerge: (legacyRow: any) =>
    ipcRenderer.invoke('legacy:suggestMerge', legacyRow),
  importLegacySerial: (input: any) => ipcRenderer.invoke('legacy:import', input),

  // ── Webhook server control ────────────────────────────────────────────────────
  getWebhookStatus: () => ipcRenderer.invoke('webhook:getStatus'),
  startWebhookServer: () => ipcRenderer.invoke('webhook:start'),
  stopWebhookServer: () => ipcRenderer.invoke('webhook:stop'),
});
