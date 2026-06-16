/**
 * Global type declaration for window.electronAPI (exposed via preload.ts).
 * This file is included by the renderer tsconfig so all .tsx files can type-check.
 */

import type {
  Customer, CustomerInput, CustomerSerialSummary, MergeCandidate,
  SerialWithCustomer, SerialInput, Serial,
  ActivityLog, LogFilter,
  LegacyImportInput, LegacyImportResult,
  InboundMail, MailConnectionResult, MailTemplate, MailTemplateUpsert,
  PendingOrder, PollDryRunResult, PollSource,
  StatsCountsResult, StatsSeries,
  AppSettings, GroupedOrder, SerialExportQuery, SerialListQuery, SerialListResult, SerialVersionSummary,
} from '../shared/types';

type CustomerMergeQuery = { email?: string; name?: string; phone?: string; dealer?: string };
type MailTemplateVars = Record<string, string>;
type MailSendOptions = Record<string, unknown>;
type OrderApproveOptions = {
  serial_status?: Serial['status'];
  customer_id?: number;
  customer_data?: CustomerInput;
};
type OrderApprovalResult = { success: boolean; error?: string; customer_id?: number; was_renewed?: boolean };
type OrderUpdateDataResult = { success: boolean; data?: SerialWithCustomer; error?: string };
type GenericResult = { success: boolean; message?: string; error?: string };

declare global {
  interface Window {
    electronAPI: {
      // ── Serial CRUD ────────────────────────────────────────────────────────
      /** @deprecated Compatibility API. New UI should use listSerials or exportSerialsByFilter. */
      getSerials(): Promise<SerialWithCustomer[]>;
      listSerials(query: SerialListQuery): Promise<SerialListResult>;
      getExpiringSoonSerials(days?: number, limit?: number): Promise<SerialWithCustomer[]>;
      getSerialVersionSummary(): Promise<SerialVersionSummary[]>;
      getSerialById(id: number): Promise<SerialWithCustomer | undefined>;
      createSerial(input: SerialInput): Promise<SerialWithCustomer>;
      updateSerial(id: number, input: Partial<SerialInput>): Promise<SerialWithCustomer | undefined>;
      deleteSerial(id: number): Promise<{ success: boolean; error?: string }>;
      searchSerials(query: string): Promise<SerialWithCustomer[]>;
      addAddon(id: number, addon: { name: string; added_date: string }): Promise<SerialWithCustomer | undefined>;
      bulkImport(): Promise<{ imported: number; errors: string[] }>;
      downloadExcelTemplate(): Promise<{ success: boolean; filePath?: string }>;
      exportSerials(serials: SerialWithCustomer[]): Promise<{ success: boolean; filePath?: string; error?: string }>;
      exportSerialsByFilter(query: SerialExportQuery): Promise<{ success: boolean; filePath?: string; error?: string; count?: number }>;

      // ── Serial domain actions ──────────────────────────────────────────────
      activateSerial(id: number): Promise<SerialWithCustomer | undefined>;
      setStopRequested(id: number, flag: boolean, triggerId?: string): Promise<void>;
      renewSerial(id: number): Promise<SerialWithCustomer | undefined>;
      cancelSerialDb(id: number): Promise<SerialWithCustomer | undefined>;
      removeModule(id: number, moduleName: string): Promise<void>;

      // ── Customer CRUD ──────────────────────────────────────────────────────
      listCustomers(): Promise<Customer[]>;
      listCustomerSerialSummaries(): Promise<CustomerSerialSummary[]>;
      getCustomerById(id: number): Promise<Customer | undefined>;
      createCustomer(input: CustomerInput): Promise<Customer>;
      updateCustomer(id: number, input: Partial<CustomerInput>): Promise<Customer | undefined>;
      deleteCustomer(id: number): Promise<{ success: boolean; error?: string }>;
      searchCustomers(query: string): Promise<Customer[]>;
      getCustomerMergeCandidates(query: CustomerMergeQuery): Promise<MergeCandidate[]>;

      // ── Cancel ────────────────────────────────────────────────────────────
      cancelSubscription(serialNumber: string): Promise<unknown>;
      checkExpiring(): Promise<unknown>;
      cancelDryRun(): Promise<unknown>;
      cancelRestartScheduler(): Promise<boolean>;

      // ── Automation ────────────────────────────────────────────────────────
      runAutoRenewNow(): Promise<unknown>;
      runAutoCancelNow(): Promise<unknown>;
      runLimboFallbackNow(): Promise<unknown>;

      // ── Mail Inbound ──────────────────────────────────────────────────────
      checkInboundNow(): Promise<{ processed: number; saved: number; errors: string[] }>;
      inboundDryRun(): Promise<unknown>;
      testMailConnection(settingsOverride?: Partial<AppSettings>): Promise<MailConnectionResult>;
      listInboundMails(filter?: { classification?: InboundMail['classification'][]; limit?: number; offset?: number }): Promise<InboundMail[]>;
      confirmStopRequestFromMail(id: number): Promise<{ success: boolean; error?: string; serial_number?: string }>;
      sendMissingInfoTemplateForMail(id: number): Promise<{ success: boolean; message: string }>;

      // ── Mail Templates ────────────────────────────────────────────────────
      sendMailTemplate(code: string, to: string, vars: MailTemplateVars, options?: MailSendOptions): Promise<GenericResult>;
      testSmtp(settingsOverride?: Partial<AppSettings>): Promise<MailConnectionResult>;
      sendTestDryRun(settingsOverride?: Partial<AppSettings>): Promise<GenericResult>;
      listMailTemplates(): Promise<MailTemplate[]>;
      getMailTemplate(code: string): Promise<MailTemplate | null>;
      upsertMailTemplate(template: MailTemplateUpsert): Promise<MailTemplate>;
      deleteMailTemplate(code: string): Promise<{ success: boolean }>;
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
      getOrders(): Promise<PendingOrder[]>;
      listGroupedOrders(): Promise<GroupedOrder[]>;
      approveOrder(id: number, options?: OrderApproveOptions): Promise<OrderApprovalResult>;
      rejectOrder(id: number): Promise<boolean>;
      updateOrder(id: number, data: Partial<PendingOrder>): Promise<PendingOrder | undefined>;
      updateDataOrder(id: number, data: Partial<PendingOrder>): Promise<OrderUpdateDataResult>;
      deleteOrder(id: number): Promise<boolean>;
      pollNow(sourceId?: string): Promise<unknown>;
      pollDryRun(sourceId?: string, sourceOverrides?: Partial<PollSource>): Promise<PollDryRunResult>;
      getPollStatus(): Promise<unknown>;
      restartScheduler(): Promise<boolean>;

      // ── Notification ──────────────────────────────────────────────────────
      testSlackWebhook(settingsOverride?: Partial<AppSettings>): Promise<GenericResult>;
      sendDailyReportNow(): Promise<GenericResult>;
      listReportTimes(): Promise<string[]>;
      setReportTimes(times: string[]): Promise<AppSettings>;
      runExpiryNoticeDryRun(input: unknown): Promise<unknown>;
      runStopLifecycleNoticeDryRun(input: unknown): Promise<unknown>;

      // ── Legacy Import ─────────────────────────────────────────────────────
      detectLegacy(): Promise<{ available: boolean; path: string; serial_count: number; last_modified: string | null }>;
      listLegacySerials(filter?: { status?: string[]; limit?: number; offset?: number }): Promise<unknown[]>;
      suggestLegacyMerge(legacyRow: unknown): Promise<MergeCandidate[]>;
      importLegacySerial(input: LegacyImportInput): Promise<LegacyImportResult>;

      // ── Webhook ───────────────────────────────────────────────────────────
      getWebhookStatus(): Promise<{ running: boolean; port: number }>;
      startWebhookServer(): Promise<{ running: boolean; port: number }>;
      stopWebhookServer(): Promise<{ running: boolean; port: number }>;
    };
  }
}

export {};
