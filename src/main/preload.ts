import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // Serial CRUD
  getSerials: () => ipcRenderer.invoke('serial:getAll'),
  getSerialById: (id: number) => ipcRenderer.invoke('serial:getById', id),
  createSerial: (input: any) => ipcRenderer.invoke('serial:create', input),
  updateSerial: (id: number, input: any) => ipcRenderer.invoke('serial:update', id, input),
  deleteSerial: (id: number) => ipcRenderer.invoke('serial:delete', id),
  searchSerials: (query: string) => ipcRenderer.invoke('serial:search', query),
  addAddon: (id: number, addon: any) => ipcRenderer.invoke('serial:addAddon', id, addon),
  bulkImport: () => ipcRenderer.invoke('serial:bulkImport'),
  downloadExcelTemplate: () => ipcRenderer.invoke('excel:downloadTemplate'),

  // Cancel
  cancelSubscription: (serialNumber: string) => ipcRenderer.invoke('cancel:subscription', serialNumber),
  checkExpiring: () => ipcRenderer.invoke('cancel:checkExpiring'),

  // Renewal
  checkRenewalEmails: () => ipcRenderer.invoke('renewal:checkEmails'),
  processRenewal: (serialId: number) => ipcRenderer.invoke('renewal:process', serialId),
  renewalDryRun: () => ipcRenderer.invoke('renewal:dryRun'),
  renewalTestConnection: (settingsOverride?: any) => ipcRenderer.invoke('renewal:testConnection', settingsOverride),

  // Reports
  getDailyReport: () => ipcRenderer.invoke('report:daily'),
  getMonthlyExpiryReport: () => ipcRenderer.invoke('report:monthlyExpiry'),
  sendReport: (type: string) => ipcRenderer.invoke('report:send', type),
  smtpTestEmail: (settingsOverride?: any) => ipcRenderer.invoke('smtp:testEmail', settingsOverride),
  slackTestWebhook: (settingsOverride?: any) => ipcRenderer.invoke('slack:testWebhook', settingsOverride),

  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: any) => ipcRenderer.invoke('settings:save', settings),

  // Logs
  getLogs: (limit?: number, offset?: number) => ipcRenderer.invoke('logs:get', limit, offset),
  getTodayLogs: () => ipcRenderer.invoke('logs:getToday'),

  // Stats
  getStats: () => ipcRenderer.invoke('stats:get'),

  // 주문 폴링 & 대기함
  getOrders: () => ipcRenderer.invoke('order:getPending'),
  approveOrder: (id: number, options?: any) => ipcRenderer.invoke('order:approve', id, options),
  rejectOrder: (id: number) => ipcRenderer.invoke('order:reject', id),
  updateOrder: (id: number, data: any) => ipcRenderer.invoke('order:update', id, data),
  deleteOrder: (id: number) => ipcRenderer.invoke('order:delete', id),
  pollNow: (sourceId?: string) => ipcRenderer.invoke('order:pollNow', sourceId),
  pollDryRun: (sourceId?: string, sourceOverrides?: any) => ipcRenderer.invoke('order:pollDryRun', sourceId, sourceOverrides),
  getPollStatus: () => ipcRenderer.invoke('order:getPollStatus'),
  restartScheduler: () => ipcRenderer.invoke('order:restartScheduler'),

  // Cancel dry-run & scheduler
  cancelDryRun: () => ipcRenderer.invoke('cancel:dryRun'),
  cancelRestartScheduler: () => ipcRenderer.invoke('cancel:restartScheduler'),

  // Webhook server control
  getWebhookStatus: () => ipcRenderer.invoke('webhook:getStatus'),
  startWebhookServer: () => ipcRenderer.invoke('webhook:start'),
  stopWebhookServer: () => ipcRenderer.invoke('webhook:stop'),
});
