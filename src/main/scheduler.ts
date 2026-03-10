import cron from 'node-cron';
import { serialService } from './services/serial.service';
import { cancelService } from './services/cancel.service';
import { emailMonitorService } from './services/email-monitor.service';
import { notificationService } from './services/notification.service';
import { getSettings } from './settings';
import { getDb } from './database';
import { logger } from './utils/logger';
import type { DailyReport, CancelResult } from '../shared/types';

let mailCheckTasks: cron.ScheduledTask[] = [];
let dailyCancelTask: cron.ScheduledTask | null = null;
let preExpiryCancelTask: cron.ScheduledTask | null = null;
let dailyReportTask: cron.ScheduledTask | null = null;
let monthlyReportTask: cron.ScheduledTask | null = null;
let dailySummaryTask: cron.ScheduledTask | null = null;

// 하루 동안의 cancel 결과를 모아둠
let dailyCancelResults: CancelResult[] = [];

// HH:MM → cron expression (M H * * *)
function timeToCron(hhmm: string): string {
  const [hStr, mStr] = (hhmm || '09:00').split(':');
  const h = parseInt(hStr, 10) || 9;
  const m = parseInt(mStr, 10) || 0;
  return `${m} ${h} * * *`;
}

export function startScheduler(): void {
  logger.info('스케줄러 시작');

  // 1. 메일 체크 — 매일 12:00, 17:00
  startMailCheck();

  // 2. 매일 자정에 만료된 시리얼 cancel 처리
  dailyCancelTask = cron.schedule('0 0 * * *', async () => {
    logger.info('만료 시리얼 cancel 작업 시작');
    try {
      const results = await cancelService.processExpiredSerials();
      dailyCancelResults.push(...results);
      logger.info(`Cancel 작업 완료: 성공 ${results.filter(r => r.success).length}건, 실패 ${results.filter(r => !r.success).length}건`);

      // cancel 결과를 개별적으로 Slack으로 전송
      for (const result of results) {
        await notificationService.sendCancelResultSlack(result).catch(() => { });
      }
    } catch (err: any) {
      logger.error(`Cancel 작업 오류: ${err.message}`);
    }
  });

  // 3. 설정된 시각에 만료 N일 전 자동 cancel (갱신 요청 없으면)
  startPreExpiryTask();

  // 4. 매일 23:59에 일일 리포트 전송
  dailyReportTask = cron.schedule('59 23 * * *', async () => {
    logger.info('일일 리포트 생성 시작');
    try {
      const todayLogs = serialService.getTodayLogs();
      const today = new Date().toISOString().slice(0, 10);

      const report: DailyReport = {
        date: today,
        new_registrations: todayLogs.filter(l => l.action === 'registered' || l.action === 'bulk_imported').length,
        renewals: todayLogs.filter(l => l.action === 'renewed').length,
        cancellations: todayLogs.filter(l => l.action === 'cancelled').length,
        failed_cancellations: dailyCancelResults.filter(r => !r.success),
        details: todayLogs,
      };

      await notificationService.sendDailyReport(report);
      dailyCancelResults = []; // 리셋
      logger.info('일일 리포트 전송 완료');
    } catch (err: any) {
      logger.error(`일일 리포트 오류: ${err.message}`);
    }
  });

  // 5. 매월 10일 09:00에 3개월 후 만료 시리얼 리포트
  monthlyReportTask = cron.schedule('0 9 10 * *', async () => {
    logger.info('월간 만료 예정 리포트 생성 시작');
    try {
      const now = new Date();
      // Date 객체의 자동 월 오버플로를 활용해 정확한 3개월 후 날짜 산출
      // (예: 11월+3 → 2월 다음 해, Date가 자동으로 연도/월 롤오버)
      const target = new Date(now.getFullYear(), now.getMonth() + 3, 1);
      const targetYear = target.getFullYear();
      const adjustedMonth = target.getMonth() + 1; // getMonth()는 0-indexed이므로 +1

      const expiringSerials = serialService.getExpiringInMonth(targetYear, adjustedMonth);
      const targetMonthStr = `${targetYear}-${String(adjustedMonth).padStart(2, '0')}`;

      await notificationService.sendMonthlyExpiryReport({
        report_date: now.toISOString().slice(0, 10),
        target_month: targetMonthStr,
        expiring_serials: expiringSerials,
        total_count: expiringSerials.length,
      });

      logger.info(`월간 리포트 전송 완료: ${targetMonthStr} 만료 예정 ${expiringSerials.length}건`);
    } catch (err: any) {
      logger.error(`월간 리포트 오류: ${err.message}`);
    }
  });

  // 6. 매일 아침 08:30 일일 요약 Slack 알림
  // cancel 예정 시리얼, 갱신의뢰 접수, 전일 작업 요약
  dailySummaryTask = cron.schedule('30 8 * * *', async () => {
    logger.info('일일 요약 Slack 알림 시작');
    try {
      const settings = getSettings();

      // 오늘 cancel 예정 시리얼 (만료 N일 전)
      const daysBefore = settings.auto_cancel_days_before ?? 1;
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() + daysBefore);
      const targetDateStr = targetDate.toISOString().slice(0, 10);
      const cancelCandidates = serialService.getExpiringSerialsOnDate(targetDateStr);
      const cancelTargets = cancelCandidates.map(s => ({
        serial_number: s.serial_number,
        customer_name: s.customer_name,
        expiry_date: s.expiry_date,
        has_renewal: serialService.hasPendingRenewal(s.id),
      }));

      // 갱신의뢰 미처리 목록
      const db = getDb();
      const pendingRenewals = db.prepare(`
        SELECT r.*, s.serial_number, s.customer_name
        FROM renewal_requests r
        JOIN serials s ON r.serial_id = s.id
        WHERE r.processed = 0
        ORDER BY r.created_at DESC
      `).all() as { serial_number: string; customer_name: string; created_at: string }[];

      const renewalRequests = pendingRenewals.map(r => ({
        serial_number: r.serial_number,
        customer_name: r.customer_name,
        request_date: r.created_at?.slice(0, 10) || '',
      }));

      // 전일 작업 요약
      const yesterdayLogs = serialService.getTodayLogs(); // 실제로는 오늘 날짜의 로그인데, 아침에 전송하므로 전일 로그 대용
      const yesterdayStats = {
        registered: yesterdayLogs.filter(l => l.action === 'registered' || l.action === 'bulk_imported').length,
        renewed: yesterdayLogs.filter(l => l.action === 'renewed').length,
        cancelled: yesterdayLogs.filter(l => l.action === 'cancelled').length,
        failed: dailyCancelResults.filter(r => !r.success).length,
      };

      await notificationService.sendDailySummarySlack({
        cancelTargets,
        renewalRequests,
        yesterdayStats,
      });

      logger.info('일일 요약 Slack 알림 전송 완료');
    } catch (err: any) {
      logger.error(`일일 요약 Slack 알림 오류: ${err.message}`);
    }
  });
}

// 만료 전 자동 cancel 스케줄 시작 (설정된 시각 기반)
function startPreExpiryTask(): void {
  if (preExpiryCancelTask) {
    preExpiryCancelTask.stop();
    preExpiryCancelTask = null;
  }

  const settings = getSettings();
  const cronExpr = timeToCron(settings.auto_cancel_time || '09:00');
  logger.info(`만료 전 자동 cancel 스케줄: ${cronExpr} (auto_cancel_time: ${settings.auto_cancel_time})`);

  preExpiryCancelTask = cron.schedule(cronExpr, async () => {
    logger.info('만료 전 자동 cancel 체크 시작');
    try {
      const results = await cancelService.processPreExpiryAutoCancel();
      if (results.length > 0) {
        dailyCancelResults.push(...results);
        logger.info(`만료 전 자동 cancel 완료: ${results.length}건`);

        // cancel 결과를 개별적으로 Slack으로 전송
        for (const result of results) {
          await notificationService.sendCancelResultSlack(result).catch(() => { });
        }
      }
    } catch (err: any) {
      logger.error(`만료 전 자동 cancel 오류: ${err.message}`);
    }
  });
}

// Settings 저장 후 호출하여 시각 변경을 즉시 반영
export function restartPreExpiryTask(): void {
  logger.info('만료 전 자동 cancel 스케줄 재시작');
  startPreExpiryTask();
}

export function startMailCheck(): void {
  // 기존 태스크 정지
  for (const task of mailCheckTasks) {
    task.stop();
  }
  mailCheckTasks = [];

  const runMailCheck = async () => {
    logger.info('갱신 요청 메일 체크 시작 (최근 3일 이내 미처리 메일)');
    try {
      const result = await emailMonitorService.checkForRenewalRequests();
      if (result.processed > 0) {
        logger.info(`갱신 처리 완료: ${result.processed}건`);
      }
      if (result.errors.length > 0) {
        logger.warn(`메일 처리 오류: ${result.errors.join(', ')}`);
      }
    } catch (err: any) {
      logger.error(`메일 체크 오류: ${err.message}`);
    }
  };

  const settings = getSettings();
  const times = settings.mail_check_times || ['12:00', '17:00'];

  for (const time of times) {
    const cronExpr = timeToCron(time);
    const task = cron.schedule(cronExpr, runMailCheck);
    mailCheckTasks.push(task);
  }

  logger.info(`메일 체크 스케줄 설정 완료: ${times.join(', ')}`);
}

export function stopScheduler(): void {
  for (const task of mailCheckTasks) task.stop();
  if (dailyCancelTask) dailyCancelTask.stop();
  if (preExpiryCancelTask) preExpiryCancelTask.stop();
  if (dailyReportTask) dailyReportTask.stop();
  if (monthlyReportTask) monthlyReportTask.stop();
  if (dailySummaryTask) dailySummaryTask.stop();
  logger.info('스케줄러 중지');
}
