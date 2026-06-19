import { ipcMain, dialog } from 'electron';
import { IPC_CHANNELS } from '../shared/types';
import { serialService } from './services/serial.service';
import { customerService } from './services/customer.service';
import { excelService } from './services/excel.service';
import { cancelService } from './services/cancel.service';
import { notificationService } from './services/notification.service';
import { detectLegacy, listLegacySerials, findMergeCandidatesForLegacy, importSerial } from './services/legacy-import.service';
import { listLogs, getFailureLogs } from './services/activity-log.service';
import {
  getPendingOrders, getAllOrders,
  updatePendingOrder, approvePendingOrder, rejectPendingOrder, deletePendingOrder,
  pollNow, pollDryRun, getPollStatus, startPollingScheduler, listGroupedOrders, updateDataFromPendingOrder,
} from './services/order.service';
import { listTemplates, getTemplate, upsertTemplate, deleteTemplate, previewTemplate } from './services/mail/template.service';
import { sendTemplate as smtpSendTemplate, testSmtp, sendTestDryRun } from './services/mail/smtp.service';
import { runStopLifecycleNoticeDryRun, sendStopRequestReceivedNotice } from './services/mail/lifecycle-notice.service';
import { checkInboundNow, inboundDryRun, testMailConnection, listInboundMails, confirmStopRequestFromMail, sendMissingInfoTemplateForMail } from './services/mail/inbound.service';
import { restartPreExpiryTask, runExpiryNoticeDryRun, sendDailyReportNow, startDailyReportTasks, startExpiryNoticeTask, startMailCheck } from './scheduler';
import { runAutoRenewNow, runAutoCancelNow, runLimboFallbackNow } from './services/automation.service';
import { refreshSchedulersForSettingsChange } from './services/scheduler-refresh.service';
import { getSettings, redactSettingsForClient, saveSettings } from './settings';
import { logger } from './utils/logger';
import { getWebhookStatus, startWebhookServer, stopWebhookServer } from './webhook-server';
import type { AppSettings, LegacyImportInput, LogFilter, MailTemplateUpsert, SerialWithCustomer } from '../shared/types';
import {
  parseAddOnInput,
  parseSerialExportQuery,
  parseSerialInput,
  parseSerialListQuery,
  parseSerialUpdateInput,
} from '../shared/serial-contract';
import {
  parseCustomerInput,
  parseCustomerMergeQuery,
  parseCustomerSearchQuery,
  parseCustomerUpdateInput,
} from '../shared/customer-contract';
import {
  parseOrderApproveInput,
  parseOrderId,
  parseOrderPollDryRunInput,
  parseOrderPollNowInput,
  parseOrderUpdateDataInput,
  parseOrderUpdateInput,
} from '../shared/order-contract';

type LegacyMergeQuery = {
  customer_name?: string;
  customer_email?: string;
  customer_phone?: string;
  dealer?: string;
};
type ExpiryNoticeDryRunInput = {
  days_before: number;
  template_code: string;
  test_email?: string;
  use_stop_template?: boolean;
};
type StopLifecycleNoticeDryRunInput = {
  kind: 'stop_request' | 'cancel_complete';
  template_code: string;
  test_email: string;
};

// 설정 import 시 허용된 키만 통과시키는 allowlist.
// 외부 JSON 파일에서 임의 키가 DB에 주입되지 않도록 방어.
const SETTINGS_ALLOWED_KEYS = new Set<keyof AppSettings>([
  'mail_protocol',
  'pop3_host', 'pop3_port', 'pop3_user', 'pop3_password', 'pop3_tls', 'pop3_keep_copy',
  'imap_host', 'imap_port', 'imap_user', 'imap_password', 'imap_tls', 'imap_mark_seen_after_check',
  'smtp_host', 'smtp_port', 'smtp_user', 'smtp_password', 'smtp_tls', 'smtp_from_name',
  'report_email_to', 'smtp_test_address',
  'slack_webhook_url', 'slack_webhook_url_related', 'slack_enabled', 'slack_language',
  'critical_alert_emails', 'slack_alert_enabled', 'alert_suppress_minutes',
  'exocad_site_url', 'exocad_login_url', 'exocad_username', 'exocad_password',
  'cancel_button_text', 'cancel_confirm_text', 'cancel_option_button_text',
  'poll_sources',
  'renewal_product_keywords', 'renewal_action_keywords', 'renewal_exclude_keywords',
  'require_serial_format', 'mail_serial_pattern',
  'missing_info_auto_reply_enabled', 'missing_info_template',
  'invalid_response_auto_reply_enabled', 'invalid_response_template',
  'renewal_keywords',
  'mail_check_times',
  'auto_cancel_enabled', 'auto_cancel_days_before', 'auto_cancel_time',
  'app_language',
  'dedicated_email',
  'custom_product_code_rules',
  'daily_report_times',
  'expiry_notice_enabled',
  'expiry_notice_time',
  'expiry_notice_rules',
  'expiry_notice_days',
  'expiry_notice_renewal_template',
  'expiry_notice_stop_template',
  'stop_request_notice_enabled',
  'stop_request_notice_template',
  'cancel_complete_notice_enabled',
  'cancel_complete_notice_template',
  'product_list',
]);

function sanitizeSettingsImport(raw: unknown): Partial<AppSettings> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('설정 파일 형식 오류: JSON 객체여야 합니다');
  }
  const clean: Partial<AppSettings> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!SETTINGS_ALLOWED_KEYS.has(k as keyof AppSettings)) continue;
    if (typeof v === 'string' && v.length > 4096) {
      throw new Error(`설정값이 너무 깁니다: ${k} (최대 4096자)`);
    }
    (clean as Record<string, unknown>)[k] = v;
  }
  return clean;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function registerIpcHandlers(): void {
  // === Serial CRUD ===
  // Compatibility only. New code should not call serial:getAll.
  ipcMain.handle(IPC_CHANNELS.SERIAL_GET_ALL, () => {
    return serialService.getAll();
  });

  ipcMain.handle(IPC_CHANNELS.SERIAL_LIST, (_event, query: unknown = {}) => {
    return serialService.list(parseSerialListQuery(query));
  });

  ipcMain.handle(IPC_CHANNELS.SERIAL_GET_EXPIRING_SOON, (_event, days: number = 60, limit: number = 50) => {
    return serialService.getExpiringSoon(days, limit);
  });

  ipcMain.handle(IPC_CHANNELS.SERIAL_GET_VERSION_SUMMARY, () => {
    return serialService.getVersionSummary();
  });

  ipcMain.handle(IPC_CHANNELS.SERIAL_GET_BY_ID, (_event, id: number) => {
    return serialService.getById(id);
  });

  ipcMain.handle(IPC_CHANNELS.SERIAL_CREATE, (_event, input: unknown) => {
    return serialService.create(parseSerialInput(input));
  });

  ipcMain.handle(IPC_CHANNELS.SERIAL_UPDATE, (_event, id: number, input: unknown) => {
    return serialService.update(id, parseSerialUpdateInput(input));
  });

  ipcMain.handle(IPC_CHANNELS.SERIAL_DELETE, (_event, id: number) => {
    try {
      const deleted = serialService.delete(id);
      return { success: deleted };
    } catch (err: unknown) {
      return { success: false, error: errorMessage(err) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.SERIAL_SEARCH, (_event, query: string) => {
    return serialService.search(query);
  });

  ipcMain.handle(IPC_CHANNELS.SERIAL_ADD_ADDON, (_event, id: number, addon: unknown) => {
    return serialService.addAddon(id, parseAddOnInput(addon));
  });

  ipcMain.handle(IPC_CHANNELS.SERIAL_ACTIVATE, (_event, id: number) => {
    return serialService.activate(id);
  });

  ipcMain.handle(IPC_CHANNELS.SERIAL_SET_STOP_REQUESTED, async (_event, id: number, flag: boolean, triggerId?: string) => {
    const before = serialService.getById(id);
    const result = serialService.setStopRequested(id, flag, triggerId);
    if (flag && before && before.renewal_stop_requested !== 1 && result) {
      await sendStopRequestReceivedNotice(result).catch((err: unknown) =>
        logger.error(`Failed to send stop request receipt email: ${errorMessage(err)}`)
      );
    }
    return result;
  });

  ipcMain.handle(IPC_CHANNELS.SERIAL_RENEW, (_event, id: number) => {
    return serialService.renewManual(id);
  });

  ipcMain.handle(IPC_CHANNELS.SERIAL_CANCEL_DB, (_event, id: number) => {
    return serialService.cancelManual(id);
  });

  ipcMain.handle(IPC_CHANNELS.SERIAL_REMOVE_MODULE, (_event, id: number, moduleName: string) => {
    return serialService.removeModule(id, moduleName);
  });

  // === Customer CRUD ===
  ipcMain.handle(IPC_CHANNELS.CUSTOMER_LIST, () => {
    return customerService.list();
  });

  ipcMain.handle(IPC_CHANNELS.CUSTOMER_SERIAL_SUMMARIES, () => {
    return customerService.serialSummaries();
  });

  ipcMain.handle(IPC_CHANNELS.CUSTOMER_GET_BY_ID, (_event, id: number) => {
    return customerService.getById(id);
  });

  ipcMain.handle(IPC_CHANNELS.CUSTOMER_CREATE, (_event, input: unknown) => {
    return customerService.create(parseCustomerInput(input));
  });

  ipcMain.handle(IPC_CHANNELS.CUSTOMER_UPDATE, (_event, id: number, input: unknown) => {
    return customerService.update(id, parseCustomerUpdateInput(input));
  });

  ipcMain.handle(IPC_CHANNELS.CUSTOMER_DELETE, (_event, id: number) => {
    return customerService.delete(id);
  });

  ipcMain.handle(IPC_CHANNELS.CUSTOMER_SEARCH, (_event, query: unknown) => {
    return customerService.search(parseCustomerSearchQuery(query));
  });

  ipcMain.handle(IPC_CHANNELS.CUSTOMER_MERGE_CANDIDATES, (_event, query: unknown) => {
    return customerService.mergeCandidates(parseCustomerMergeQuery(query));
  });

  // === Legacy Import ===
  ipcMain.handle(IPC_CHANNELS.LEGACY_DETECT, () => detectLegacy());

  ipcMain.handle(IPC_CHANNELS.LEGACY_LIST_SERIALS, (_event, filter?: { status?: string[]; limit?: number; offset?: number }) => {
    return listLegacySerials(filter);
  });

  ipcMain.handle(IPC_CHANNELS.LEGACY_SUGGEST_MERGE, (_event, legacyRow: LegacyMergeQuery) => {
    return findMergeCandidatesForLegacy(legacyRow);
  });

  ipcMain.handle(IPC_CHANNELS.LEGACY_IMPORT, (_event, input: LegacyImportInput) => {
    return importSerial(input);
  });

  // === 엑셀 템플릿 다운로드 ===
  ipcMain.handle(IPC_CHANNELS.EXCEL_DOWNLOAD_TEMPLATE, async (_event) => {
    const result = await dialog.showSaveDialog({
      title: '엑셀 템플릿 저장',
      defaultPath: 'serial_template.xlsx',
      filters: [{ name: 'Excel Files', extensions: ['xlsx'] }],
    });

    if (result.canceled || !result.filePath) return { success: false };

    try {
      await excelService.generateTemplate(result.filePath);
      return { success: true, filePath: result.filePath };
    } catch (err: unknown) {
      return { success: false, error: errorMessage(err) };
    }
  });

  // === 엑셀 내보내기 ===
  ipcMain.handle(IPC_CHANNELS.EXCEL_EXPORT_SERIALS, async (_event, serials: SerialWithCustomer[]) => {
    const result = await dialog.showSaveDialog({
      title: '엑셀 내보내기',
      defaultPath: `serials_${new Date().toISOString().slice(0, 10)}.xlsx`,
      filters: [{ name: 'Excel Files', extensions: ['xlsx'] }],
    });
    if (result.canceled || !result.filePath) return { success: false };
    try {
      await excelService.exportSerials(serials, result.filePath);
      return { success: true, filePath: result.filePath };
    } catch (err: unknown) {
      return { success: false, error: errorMessage(err) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.EXCEL_EXPORT_SERIALS_BY_FILTER, async (_event, query: unknown = {}) => {
    const result = await dialog.showSaveDialog({
      title: '엑셀 내보내기',
      defaultPath: `serials_${new Date().toISOString().slice(0, 10)}.xlsx`,
      filters: [{ name: 'Excel Files', extensions: ['xlsx'] }],
    });
    if (result.canceled || !result.filePath) return { success: false };
    try {
      const serials = serialService.listForExport(parseSerialExportQuery(query));
      await excelService.exportSerials(serials, result.filePath);
      return { success: true, filePath: result.filePath, count: serials.length };
    } catch (err: unknown) {
      return { success: false, error: errorMessage(err) };
    }
  });

  // === Bulk Import ===
  ipcMain.handle(IPC_CHANNELS.SERIAL_BULK_IMPORT, async (_event) => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Excel Files', extensions: ['xlsx', 'xls', 'csv'] }],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { imported: 0, errors: ['파일 선택 취소'] };
    }

    const filePath = result.filePaths[0];
    const { serials, errors: parseErrors } = await excelService.parseExcelFile(filePath);

    if (serials.length === 0) {
      return { imported: 0, errors: parseErrors.length > 0 ? parseErrors : ['유효한 데이터가 없습니다'] };
    }

    const importResult = serialService.bulkImport(serials);
    return {
      imported: importResult.imported,
      errors: [...parseErrors, ...importResult.errors],
    };
  });

  // === Cancel ===
  ipcMain.handle(IPC_CHANNELS.CANCEL_SUBSCRIPTION, async (_event, serialNumber: string) => {
    return cancelService.cancelSubscription(serialNumber, false); // 수동 실행: 브라우저 창 표시
  });

  ipcMain.handle(IPC_CHANNELS.CANCEL_CHECK_EXPIRING, async () => {
    return cancelService.processExpiredSerials();
  });

  // 만료 N일 전 자동 cancel (갱신 중단 요청이 있을 때)
  ipcMain.handle(IPC_CHANNELS.CANCEL_PRE_EXPIRY_AUTO, async () => {
    return cancelService.processPreExpiryAutoCancel();
  });

  // Cancel Dry-Run: Playwright 확인 (confirm 버튼은 누르지 않음)
  ipcMain.handle(IPC_CHANNELS.CANCEL_DRY_RUN, async () => {
    return cancelService.processPreExpiryDryRun();
  });

  // Cancel 스케줄러 재시작 (auto_cancel_time 변경 후 호출)
  ipcMain.handle(IPC_CHANNELS.CANCEL_RESTART_SCHEDULER, () => {
    restartPreExpiryTask();
    return true;
  });

  // === Automation crons ===
  ipcMain.handle(IPC_CHANNELS.AUTOMATION_RUN_AUTO_RENEW, async () => runAutoRenewNow());
  ipcMain.handle(IPC_CHANNELS.AUTOMATION_RUN_AUTO_CANCEL, async () => runAutoCancelNow());
  ipcMain.handle(IPC_CHANNELS.AUTOMATION_RUN_LIMBO, async () => runLimboFallbackNow());

  // === Settings ===
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, () => {
    return redactSettingsForClient();
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS_SAVE, (_event, settings: Partial<AppSettings>) => {
    const beforeSettings = getSettings(true);
    saveSettings(settings);
    const afterSettings = getSettings(true);
    refreshSchedulersForSettingsChange(beforeSettings, afterSettings);

    return redactSettingsForClient(afterSettings);
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS_EXPORT, async () => {
    const result = await dialog.showSaveDialog({
      title: '설정 내보내기',
      defaultPath: 'exocad-settings.json',
      filters: [{ name: 'JSON Files', extensions: ['json'] }],
    });

    if (result.canceled || !result.filePath) {
      return { success: false };
    }

    const fs = await import('fs/promises');
    await fs.writeFile(result.filePath, JSON.stringify(redactSettingsForClient(), null, 2), 'utf8');
    return { success: true, filePath: result.filePath };
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS_IMPORT, async () => {
    const result = await dialog.showOpenDialog({
      title: '설정 가져오기',
      properties: ['openFile'],
      filters: [{ name: 'JSON Files', extensions: ['json'] }],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false };
    }

    const fs = await import('fs/promises');
    const raw = await fs.readFile(result.filePaths[0], 'utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { success: false, error: '설정 파일이 올바른 JSON 형식이 아닙니다' };
    }
    let sanitized: Partial<AppSettings>;
    try {
      sanitized = sanitizeSettingsImport(parsed);
    } catch (err: unknown) {
      return { success: false, error: errorMessage(err) };
    }
    const beforeSettings = getSettings(true);
    saveSettings(sanitized);
    const afterSettings = getSettings(true);
    refreshSchedulersForSettingsChange(beforeSettings, afterSettings);
    return { success: true, settings: redactSettingsForClient(afterSettings) };
  });

  // === Logs ===
  ipcMain.handle(IPC_CHANNELS.LOGS_LIST, (_event, filter: LogFilter = {}) => {
    return listLogs(filter);
  });

  // === Stats ===
  ipcMain.handle(IPC_CHANNELS.STATS_COUNTS, () => {
    return serialService.getStats();
  });

  ipcMain.handle(IPC_CHANNELS.STATS_SERIES, (_event, granularity: 'day'|'month'|'year' = 'day', range: number = 30) => {
    return serialService.getStatsSeries(granularity, range);
  });

  ipcMain.handle(IPC_CHANNELS.STATS_FAILURES, () => {
    return getFailureLogs(50);
  });

  // === 주문 폴링 & 대기함 ===
  // @deprecated Channel name is legacy; it returns the all-orders list.
  ipcMain.handle(IPC_CHANNELS.ORDER_GET_PENDING, () => getAllOrders());
  ipcMain.handle(IPC_CHANNELS.ORDER_LIST_GROUPED, () => listGroupedOrders());

  ipcMain.handle(IPC_CHANNELS.ORDER_APPROVE, (_event, id: unknown, options?: unknown) =>
    approvePendingOrder(parseOrderId(id), parseOrderApproveInput(options))
  );

  ipcMain.handle(IPC_CHANNELS.ORDER_REJECT, (_event, id: unknown) => {
    rejectPendingOrder(parseOrderId(id));
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.ORDER_UPDATE, (_event, id: unknown, data: unknown) =>
    updatePendingOrder(parseOrderId(id), parseOrderUpdateInput(data))
  );

  ipcMain.handle(IPC_CHANNELS.ORDER_UPDATE_DATA, (_event, id: unknown, data: unknown) =>
    updateDataFromPendingOrder(parseOrderId(id), parseOrderUpdateDataInput(data))
  );

  ipcMain.handle(IPC_CHANNELS.ORDER_DELETE, (_event, id: unknown) => {
    deletePendingOrder(parseOrderId(id));
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.ORDER_POLL_NOW, async (_event, sourceId?: unknown) =>
    pollNow(parseOrderPollNowInput(sourceId))
  );

  // Order Dry-Run: 수집만 하고 DB에 저장하지 않음
  ipcMain.handle(IPC_CHANNELS.ORDER_POLL_DRY_RUN, async (_event, sourceId?: unknown, sourceOverrides?: unknown) => {
    const input = parseOrderPollDryRunInput({ sourceId, sourceOverrides });
    return pollDryRun(input.sourceId, input.sourceOverrides);
  });

  ipcMain.handle(IPC_CHANNELS.ORDER_GET_POLL_STATUS, () => getPollStatus());

  ipcMain.handle(IPC_CHANNELS.ORDER_RESTART_SCHEDULER, () => {
    startPollingScheduler();
    return true;
  });

  // === Notification ===
  ipcMain.handle(IPC_CHANNELS.NOTIFICATION_TEST_SLACK, (_event, settingsOverride?: Partial<AppSettings>) =>
    notificationService.testSlackWebhook(settingsOverride)
  );

  ipcMain.handle(IPC_CHANNELS.NOTIFICATION_SEND_DAILY_NOW, async () => {
    await sendDailyReportNow();
    return { success: true };
  });

  ipcMain.handle(IPC_CHANNELS.NOTIFICATION_LIST_REPORT_TIMES, () =>
    getSettings().daily_report_times || ['10:00']
  );

  ipcMain.handle(IPC_CHANNELS.NOTIFICATION_SET_REPORT_TIMES, (_event, times: string[]) => {
    saveSettings({ daily_report_times: times });
    startDailyReportTasks();
    return getSettings().daily_report_times;
  });

  ipcMain.handle(IPC_CHANNELS.EXPIRY_NOTICE_DRY_RUN, (_event, input: ExpiryNoticeDryRunInput) =>
    runExpiryNoticeDryRun(input)
  );

  ipcMain.handle(IPC_CHANNELS.STOP_LIFECYCLE_NOTICE_DRY_RUN, (_event, input: StopLifecycleNoticeDryRunInput) =>
    runStopLifecycleNoticeDryRun(input)
  );

  // === Webhook Server ===
  ipcMain.handle(IPC_CHANNELS.WEBHOOK_GET_STATUS, () => getWebhookStatus());

  ipcMain.handle(IPC_CHANNELS.WEBHOOK_START, async () => {
    return startWebhookServer();
  });

  ipcMain.handle(IPC_CHANNELS.WEBHOOK_STOP, async () => {
    return stopWebhookServer();
  });

  // === Mail — Inbound ===
  ipcMain.handle(IPC_CHANNELS.MAIL_CHECK_INBOUND, () => checkInboundNow());

  ipcMain.handle(IPC_CHANNELS.MAIL_INBOUND_DRY_RUN, () => inboundDryRun());

  ipcMain.handle(IPC_CHANNELS.MAIL_TEST_CONNECTION, (_event, settingsOverride?: Partial<AppSettings>) =>
    testMailConnection(settingsOverride)
  );

  ipcMain.handle(IPC_CHANNELS.MAIL_LIST_INBOUND, (_event, filter?: { classification?: string[]; limit?: number; offset?: number }) =>
    listInboundMails(filter)
  );

  ipcMain.handle(IPC_CHANNELS.MAIL_CONFIRM_STOP_REQUEST, (_event, id: number) =>
    confirmStopRequestFromMail(id)
  );

  ipcMain.handle(IPC_CHANNELS.MAIL_SEND_MISSING_INFO_TEMPLATE, (_event, id: number) =>
    sendMissingInfoTemplateForMail(id)
  );

  // === Mail Templates ===
  ipcMain.handle(IPC_CHANNELS.MAIL_TEMPLATE_LIST, () => listTemplates());

  ipcMain.handle(IPC_CHANNELS.MAIL_TEMPLATE_GET, (_event, code: string) =>
    getTemplate(code) ?? null
  );

  ipcMain.handle(IPC_CHANNELS.MAIL_TEMPLATE_UPSERT, (_event, input: MailTemplateUpsert) =>
    upsertTemplate(input)
  );

  ipcMain.handle(IPC_CHANNELS.MAIL_TEMPLATE_DELETE, (_event, code: string) => {
    deleteTemplate(code);
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.MAIL_TEMPLATE_PREVIEW, (_event, code: string, serialId: number) =>
    previewTemplate(code, serialId)
  );

  // === Mail SMTP ===
  ipcMain.handle(IPC_CHANNELS.MAIL_TEST_SMTP, (_event, settingsOverride?: Partial<AppSettings>) =>
    testSmtp(settingsOverride)
  );

  ipcMain.handle(IPC_CHANNELS.MAIL_SEND_TEST_DRY_RUN, (_event, settingsOverride?: Partial<AppSettings>) =>
    sendTestDryRun(settingsOverride)
  );

  ipcMain.handle(
    IPC_CHANNELS.MAIL_SEND_TEMPLATE,
    (_event, code: string, to: string, vars: Record<string, string>, options?: Record<string, unknown>) =>
      smtpSendTemplate(code, to, vars, options)
  );
}
