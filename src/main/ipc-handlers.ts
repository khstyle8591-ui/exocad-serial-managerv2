import { ipcMain, dialog } from 'electron';
import { IPC_CHANNELS } from '../shared/types';
import { serialService } from './services/serial.service';
import { excelService } from './services/excel.service';
import { cancelService } from './services/cancel.service';
import { emailMonitorService } from './services/email-monitor.service';
import { notificationService } from './services/notification.service';
import {
  getPendingOrders, getAllOrders,
  updatePendingOrder, approvePendingOrder, rejectPendingOrder, deletePendingOrder,
  pollNow, pollDryRun, getPollStatus, startPollingScheduler, stopPollingScheduler,
} from './services/order.service';
import { restartPreExpiryTask } from './scheduler';
import { getSettings, saveSettings } from './settings';
import { logger } from './utils/logger';
import type { SerialInput, AddOn, AppSettings } from '../shared/types';

export function registerIpcHandlers(): void {
  // === Serial CRUD ===
  ipcMain.handle(IPC_CHANNELS.SERIAL_GET_ALL, () => {
    return serialService.getAll();
  });

  ipcMain.handle(IPC_CHANNELS.SERIAL_GET_BY_ID, (_event, id: number) => {
    return serialService.getById(id);
  });

  ipcMain.handle(IPC_CHANNELS.SERIAL_CREATE, (_event, input: SerialInput) => {
    return serialService.create(input);
  });

  ipcMain.handle(IPC_CHANNELS.SERIAL_UPDATE, (_event, id: number, input: Partial<SerialInput>) => {
    return serialService.update(id, input);
  });

  ipcMain.handle(IPC_CHANNELS.SERIAL_DELETE, (_event, id: number) => {
    return serialService.delete(id);
  });

  ipcMain.handle(IPC_CHANNELS.SERIAL_SEARCH, (_event, query: string) => {
    return serialService.search(query);
  });

  ipcMain.handle(IPC_CHANNELS.SERIAL_ADD_ADDON, (_event, id: number, addon: AddOn) => {
    return serialService.addAddon(id, addon);
  });

  // === 엑셀 템플릿 다운로드 ===
  ipcMain.handle('excel:downloadTemplate', async (_event) => {
    const result = await dialog.showSaveDialog({
      title: '엑셀 템플릿 저장',
      defaultPath: 'serial_template.xlsx',
      filters: [{ name: 'Excel Files', extensions: ['xlsx'] }],
    });

    if (result.canceled || !result.filePath) return { success: false };

    try {
      excelService.generateTemplate(result.filePath);
      return { success: true, filePath: result.filePath };
    } catch (err: any) {
      return { success: false, error: err.message };
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
    const { serials, errors: parseErrors } = excelService.parseExcelFile(filePath);

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

  // 만료 N일 전 자동 cancel (갱신 요청 없을 때)
  ipcMain.handle('cancel:preExpiryAutoCancel', async () => {
    return cancelService.processPreExpiryAutoCancel();
  });

  // Cancel Dry-Run: Playwright 확인 (confirm 버튼은 누르지 않음)
  ipcMain.handle('cancel:dryRun', async () => {
    return cancelService.processPreExpiryDryRun();
  });

  // Cancel 스케줄러 재시작 (auto_cancel_time 변경 후 호출)
  ipcMain.handle('cancel:restartScheduler', () => {
    restartPreExpiryTask();
    return true;
  });

  // === Renewal ===
  ipcMain.handle(IPC_CHANNELS.RENEWAL_CHECK_EMAILS, async () => {
    return emailMonitorService.checkForRenewalRequests();
  });

  ipcMain.handle(IPC_CHANNELS.RENEWAL_PROCESS, (_event, serialId: number) => {
    return serialService.renewSerial(serialId, 'manual');
  });

  // Renewal Dry-Run: 이메일 스캔만 (DB 저장 없음)
  ipcMain.handle(IPC_CHANNELS.RENEWAL_DRY_RUN, async () => {
    return emailMonitorService.renewalDryRun();
  });

  // Mail Connection Test: POP3/IMAP 연결 상태 확인 (저장 전 form 값도 수락)
  ipcMain.handle(IPC_CHANNELS.RENEWAL_TEST_CONNECTION, async (_event, settingsOverride?: any) => {
    return emailMonitorService.testMailConnection(settingsOverride);
  });


  // === Reports ===
  ipcMain.handle(IPC_CHANNELS.REPORT_DAILY, () => {
    const todayLogs = serialService.getTodayLogs();
    const today = new Date().toISOString().slice(0, 10);
    return {
      date: today,
      new_registrations: todayLogs.filter(l => l.action === 'registered' || l.action === 'bulk_imported').length,
      renewals: todayLogs.filter(l => l.action === 'renewed').length,
      cancellations: todayLogs.filter(l => l.action === 'cancelled').length,
      failed_cancellations: [],
      details: todayLogs,
    };
  });

  ipcMain.handle(IPC_CHANNELS.REPORT_MONTHLY_EXPIRY, () => {
    const now = new Date();
    const targetMonth = now.getMonth() + 3; // 3개월 후 (getMonth()는 0-indexed이므로 +3)
    const targetYear = now.getFullYear() + (targetMonth > 12 ? 1 : 0);
    const adjustedMonth = targetMonth > 12 ? targetMonth - 12 : targetMonth;
    const expiringSerials = serialService.getExpiringInMonth(targetYear, adjustedMonth);
    return {
      report_date: now.toISOString().slice(0, 10),
      target_month: `${targetYear}-${String(adjustedMonth).padStart(2, '0')}`,
      expiring_serials: expiringSerials,
      total_count: expiringSerials.length,
    };
  });

  ipcMain.handle(IPC_CHANNELS.REPORT_SEND, async (_event, type: 'daily' | 'monthly') => {
    if (type === 'daily') {
      const todayLogs = serialService.getTodayLogs();
      const today = new Date().toISOString().slice(0, 10);
      await notificationService.sendDailyReport({
        date: today,
        new_registrations: todayLogs.filter(l => l.action === 'registered' || l.action === 'bulk_imported').length,
        renewals: todayLogs.filter(l => l.action === 'renewed').length,
        cancellations: todayLogs.filter(l => l.action === 'cancelled').length,
        failed_cancellations: [],
        details: todayLogs,
      });
    }
    return true;
  });

  // SMTP Test Email
  ipcMain.handle(IPC_CHANNELS.SMTP_TEST_EMAIL, async (_event, settingsOverride?: any) => {
    return notificationService.testSmtpConnection(settingsOverride);
  });

  // Slack Webhook Test
  ipcMain.handle('slack:testWebhook', async (_event, settingsOverride?: any) => {
    return notificationService.testSlackWebhook(settingsOverride);
  });

  // === Settings ===
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, () => {
    return getSettings();
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS_SAVE, (_event, settings: Partial<AppSettings>) => {
    saveSettings(settings);
    return getSettings();
  });

  // === Logs ===
  ipcMain.handle(IPC_CHANNELS.LOGS_GET, (_event, limit: number = 100, offset: number = 0) => {
    return serialService.getLogs(limit, offset);
  });

  ipcMain.handle(IPC_CHANNELS.LOGS_GET_TODAY, () => {
    return serialService.getTodayLogs();
  });

  // === Stats ===
  ipcMain.handle('stats:get', () => {
    return serialService.getStats();
  });

  // === 주문 폴링 & 대기함 ===
  ipcMain.handle(IPC_CHANNELS.ORDER_GET_PENDING, () => getAllOrders());

  ipcMain.handle(IPC_CHANNELS.ORDER_APPROVE, (_event, id: number) => approvePendingOrder(id));

  ipcMain.handle(IPC_CHANNELS.ORDER_REJECT, (_event, id: number) => {
    rejectPendingOrder(id);
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.ORDER_UPDATE, (_event, id: number, data: any) => updatePendingOrder(id, data));

  ipcMain.handle(IPC_CHANNELS.ORDER_DELETE, (_event, id: number) => {
    deletePendingOrder(id);
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.ORDER_POLL_NOW, async (_event, sourceId?: string) => pollNow(sourceId));

  // Order Dry-Run: 수집만 하고 DB에 저장하지 않음
  ipcMain.handle('order:pollDryRun', async (_event, sourceId?: string, sourceOverrides?: any) =>
    pollDryRun(sourceId, sourceOverrides)
  );

  ipcMain.handle(IPC_CHANNELS.ORDER_GET_POLL_STATUS, () => getPollStatus());

  ipcMain.handle('order:restartScheduler', () => {
    startPollingScheduler();
    return true;
  });

  // === Webhook Server ===
  // 현재 Webhook 서버는 별도 Express 구현이 준비 중이므로
  // 상태만 관리하여 Dashboard UI 오류를 방지
  let webhookRunning = false;
  let webhookPort = 3000;

  ipcMain.handle('webhook:getStatus', () => {
    return { running: webhookRunning, port: webhookPort };
  });

  ipcMain.handle('webhook:start', () => {
    webhookRunning = true;
    logger.info(`Webhook 서버 시작 요청 (포트 ${webhookPort}) — 구현 예정`);
    return { running: webhookRunning, port: webhookPort };
  });

  ipcMain.handle('webhook:stop', () => {
    webhookRunning = false;
    logger.info('Webhook 서버 중지 요청 — 구현 예정');
    return { running: webhookRunning, port: webhookPort };
  });
}
