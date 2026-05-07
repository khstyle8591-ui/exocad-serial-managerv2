/**
 * Global type declaration for window.electronAPI (exposed via preload.ts).
 * This file is included by the renderer tsconfig so all .tsx files can type-check.
 */

import type {
  Customer, CustomerInput, MergeCandidate,
  SerialWithCustomer, SerialInput, Serial,
  ActivityLog, LogFilter,
  LegacyImportInput, LegacyImportResult,
  StatsCountsResult, StatsSeries,
  AppSettings, GroupedOrder,
} from '../shared/types';

declare global {
  interface Window {
    electronAPI: {
      // ── Serial CRUD ────────────────────────────────────────────────────────
      getSerials(): Promise<SerialWithCustomer[]>;
      getSerialById(id: number): Promise<SerialWithCustomer | undefined>;
      createSerial(input: SerialInput): Promise<SerialWithCustomer>;
      updateSerial(id: number, input: Partial<SerialInput>): Promise<SerialWithCustomer | undefined>;
      deleteSerial(id: number): Promise<{ success: boolean; error?: string }>;
      searchSerials(query: string): Promise<SerialWithCustomer[]>;
      addAddon(id: number, addon: { name: string; added_date: string }): Promise<any>;
      bulkImport(): Promise<{ imported: number; errors: string[] }>;
      downloadExcelTemplate(): Promise<{ success: boolean; filePath?: string }>;
      exportSerials(serials: SerialWithCustomer[]): Promise<{ success: boolean; filePath?: string; error?: string }>;

      // ── Serial domain actions ──────────────────────────────────────────────
      activateSerial(id: number): Promise<SerialWithCustomer | undefined>;
      setStopRequested(id: number, flag: boolean, triggerId?: string): Promise<void>;
      renewSerial(id: number): Promise<SerialWithCustomer | undefined>;
      cancelSerialDb(id: number): Promise<SerialWithCustomer | undefined>;
      removeModule(id: number, moduleName: string): Promise<void>;

      // ── Customer CRUD ──────────────────────────────────────────────────────
      listCustomers(): Promise<Customer[]>;
      getCustomerById(id: number): Promise<Customer | undefined>;
      createCustomer(input: CustomerInput): Promise<Customer>;
      updateCustomer(id: number, input: Partial<CustomerInput>): Promise<Customer | undefined>;
      deleteCustomer(id: number): Promise<{ success: boolean; error?: string }>;
      searchCustomers(query: string): Promise<Customer[]>;
      getCustomerMergeCandidates(query: { email?: string; name?: string; phone?: string; dealer?: string }): Promise<MergeCandidate[]>;

      // ── Cancel ────────────────────────────────────────────────────────────
      cancelSubscription(serialNumber: string): Promise<any>;
      checkExpiring(): Promise<any>;
      cancelDryRun(): Promise<any>;
      cancelRestartScheduler(): Promise<boolean>;

      // ── Automation ────────────────────────────────────────────────────────
      runAutoRenewNow(): Promise<any>;
      runAutoCancelNow(): Promise<any>;
      runLimboFallbackNow(): Promise<any>;

      // ── Mail Inbound ──────────────────────────────────────────────────────
      checkInboundNow(): Promise<any>;
      inboundDryRun(): Promise<any>;
      testMailConnection(settingsOverride?: Partial<AppSettings>): Promise<any>;
      listInboundMails(filter?: any): Promise<any[]>;

      // ── Mail Templates ────────────────────────────────────────────────────
      sendMailTemplate(code: string, to: string, vars: Record<string, string>, options?: any): Promise<any>;
      testSmtp(settingsOverride?: Partial<AppSettings>): Promise<any>;
      sendTestDryRun(settingsOverride?: Partial<AppSettings>): Promise<any>;
      listMailTemplates(): Promise<any[]>;
      getMailTemplate(code: string): Promise<any>;
      upsertMailTemplate(template: any): Promise<any>;
      deleteMailTemplate(code: string): Promise<any>;
      previewMailTemplate(code: string, serialId: number): Promise<{ subject: string; body: string }>;

      // ── Stats ─────────────────────────────────────────────────────────────
      getStatsCounts(): Promise<StatsCountsResult>;
      getStatsSeries(granularity: 'day' | 'month' | 'year', range: number): Promise<StatsSeries>;
      getStatsFailures(): Promise<ActivityLog[]>;

      // ── Settings ──────────────────────────────────────────────────────────
      getSettings(): Promise<AppSettings>;
      saveSettings(settings: Partial<AppSettings>): Promise<AppSettings>;
      exportSettings(): Promise<{ success: boolean; filePath?: string }>;
      importSettings(): Promise<{ success: boolean }>;

      // ── Logs ──────────────────────────────────────────────────────────────
      listLogs(filter?: LogFilter): Promise<ActivityLog[]>;
      onLogsPush(callback: (payload: { id: number }) => void): () => void;

      // ── Orders ────────────────────────────────────────────────────────────
      getOrders(): Promise<any[]>;
      listGroupedOrders(): Promise<GroupedOrder[]>;
      approveOrder(id: number, options?: any): Promise<{ success: boolean; error?: string; customer_id?: number }>;
      rejectOrder(id: number): Promise<any>;
      updateOrder(id: number, data: any): Promise<any>;
      deleteOrder(id: number): Promise<any>;
      pollNow(sourceId?: string): Promise<any>;
      pollDryRun(sourceId?: string, sourceOverrides?: any): Promise<any>;
      getPollStatus(): Promise<any>;
      restartScheduler(): Promise<any>;

      // ── Notification ──────────────────────────────────────────────────────
      testSlackWebhook(settingsOverride?: Partial<AppSettings>): Promise<any>;
      sendDailyReportNow(): Promise<any>;
      listReportTimes(): Promise<string[]>;
      setReportTimes(times: string[]): Promise<any>;

      // ── Legacy Import ─────────────────────────────────────────────────────
      detectLegacy(): Promise<{ available: boolean; path: string; serial_count: number; last_modified: string | null }>;
      listLegacySerials(filter?: { status?: string[]; limit?: number; offset?: number }): Promise<any[]>;
      suggestLegacyMerge(legacyRow: any): Promise<MergeCandidate[]>;
      importLegacySerial(input: LegacyImportInput): Promise<LegacyImportResult>;

      // ── Webhook ───────────────────────────────────────────────────────────
      getWebhookStatus(): Promise<{ running: boolean; port: number }>;
      startWebhookServer(): Promise<{ running: boolean; port: number }>;
      stopWebhookServer(): Promise<{ running: boolean; port: number }>;
    };
  }
}

export {};
