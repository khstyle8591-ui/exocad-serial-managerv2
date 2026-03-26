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
let retryCancelTask: cron.ScheduledTask | null = null;

// 하루 동안의 cancel 결과를 모아둠
let dailyCancelResults: CancelResult[] = [];

// 시간 문자열 (HH:MM 또는 HH:MM AM/PM) → cron expression (M H * * *)
function timeToCron(timeStr: string): string {
  const clean = (timeStr || '09:00').trim().toUpperCase();
  const isPM = clean.includes('PM');
  const isAM = clean.includes('AM');

  // AM/PM 제거 후 숫자만 추출
  const timePart = clean.replace(/[AP]M/g, '').trim();
  const parts = timePart.split(':');

  let h = parseInt(parts[0], 10) || 0;
  const m = parts.length > 1 ? parseInt(parts[1], 10) || 0 : 0;

  if (isPM && h < 12) h += 12;
  else if (isAM && h === 12) h = 0;
  else if (!isAM && !isPM && h > 0 && h <= 6) {
    // 24시간제 입력이 안된 경우 (1~6시 입력 시 13~18시로 간주)
    h += 12;
  }

  // 0-23 범위 보장
  h = h % 24;

  return `${m} ${h} * * *`;
}

export function startScheduler(): void {
  logger.info('스케줄러 시작');

  // 1. 메일 체크 — 설정된 시각 또는 기본값 (12:00, 17:00)
  startMailCheck();

   // [제거됨] 2. 매일 자정에 만료된 시리얼 cancel 처리 (새벽 리포트 폭풍의 원인)
   // 대신 실패 건만 재시도하는 로직이 startPreExpiryTask 내에서 별도로 스케줄링됩니다.
  /*
  dailyCancelTask = cron.schedule('0 0 * * *', async () => {
    const settings = getSettings();
    if (!settings.auto_cancel_enabled) {
      logger.info('만료 시리얼 cancel 작업 비활성화 되어있음 (skip)');
      return;
    }

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
  }, { timezone: 'Asia/Seoul' });
  */

  // 3. 설정된 시각에 만료 N일 전 자동 cancel (갱신 요청 없으면)
  startPreExpiryTask();

  // 4. 매일 아침 10:00에 전일 작업 일일 리포트 전송
  dailyReportTask = cron.schedule('0 10 * * *', async () => {
    logger.info('일일 리포트 생성 시작 (어제 데이터 기준)');
    try {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const targetDateStr = yesterday.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
      
      const yesterdayLogs = serialService.getLogsForDate(targetDateStr);

      const report: DailyReport = {
        date: targetDateStr,
        new_registrations: yesterdayLogs.filter(l => l.action === 'registered' || l.action === 'bulk_imported').length,
        renewals: yesterdayLogs.filter(l => l.action === 'renewed').length,
        cancellations: yesterdayLogs.filter(l => l.action === 'cancelled').length,
        failed_cancellations: dailyCancelResults.filter(r => !r.success),
        details: yesterdayLogs,
      };

      await notificationService.sendDailyReport(report);
      // 리포트 발송 후 여전히 실패한 건은 남겨두거나 비워야 함. 여기서는 아침 리포트 이후 초기화
      dailyCancelResults = dailyCancelResults.filter(r => !r.success); // 실패건 목록 리셋
      logger.info('일일 리포트 전송 완료');
    } catch (err: any) {
      logger.error(`일일 리포트 오류: ${err.message}`);
    }
  }, { timezone: 'Asia/Seoul' });

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
  }, { timezone: 'Asia/Seoul' });

  // 6. 매일 아침 08:30 일일 요약 Slack 알림
  // cancel 예정 시리얼, 갱신의뢰 접수, 전일 작업 요약
  dailySummaryTask = cron.schedule('30 8 * * *', async () => {
    logger.info('일일 요약 Slack 알림 시작');
    try {
      const settings = getSettings();

      // 오늘 cancel 예정 시리얼 (만료 N일 전)
      const daysBefore = settings.auto_cancel_days_before ?? 1;
      const cancelTargetDate = new Date();
      cancelTargetDate.setDate(cancelTargetDate.getDate() + daysBefore);
      const cancelTargetDateStr = cancelTargetDate.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
      const cancelCandidates = serialService.getExpiringSerialsOnDate(cancelTargetDateStr);
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
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayDateStr = yesterday.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
      const yesterdayLogs = serialService.getLogsForDate(yesterdayDateStr);
      
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
  }, { timezone: 'Asia/Seoul' });

  // 7. 전체 스케줄링 요약 로그
  const settings = getSettings();
  const mailTimes = settings.mail_check_times || ['12:00', '17:00'];
  const cancelTime = settings.auto_cancel_time || '09:00';
  const summary = `메일체크(${mailTimes.join(', ')}), 자동취소(${cancelTime}), 일일리포트(23:59), 월간리포트(매월 10일 09:00), 일일요약(08:30)`;
  logger.info(`[스케줄 요약] ${summary}`);
  notificationService.sendSchedulerStartupSlack(summary).catch(() => {});
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
  }, { timezone: 'Asia/Seoul' });

  // 실패 건 재시도 스케줄링 (설정된 시각 2시간 후 실행)
  if (retryCancelTask) {
    retryCancelTask.stop();
    retryCancelTask = null;
  }

  const [hStr, mStr] = (settings.auto_cancel_time || '09:00').split(':');
  let h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  const retryH = (h + 2) % 24; // 2시간 후
  const retryCron = `${m} ${retryH} * * *`;

  retryCancelTask = cron.schedule(retryCron, async () => {
    await retryFailedCancellations();
  }, { timezone: 'Asia/Seoul' });

  logger.info(`실패 건 재시도 스케줄: ${retryCron} (자동 캔슬 2시간 후)`);
}

/**
 * 당일 발생한 실패 건만 골라서 재시도하는 로직
 */
async function retryFailedCancellations() {
  const failures = dailyCancelResults.filter(r => !r.success);
  if (failures.length === 0) {
    logger.info('[Retry] 재시도할 실패 건이 없습니다.');
    return;
  }

  // 이미 성공한 기록이 나중에 추가되었을 수도 있으므로 (수동 처리 등) 최종 확인
  const actualFailures = failures.filter(f => {
    return !dailyCancelResults.some(r => r.serial_number === f.serial_number && r.success);
  });

  if (actualFailures.length === 0) {
    logger.info('[Retry] 이미 모두 처리되었거나 재시도할 대상이 없습니다.');
    return;
  }

  logger.info(`[Retry] 장애/타임아웃 실패 건 재시도 시작 (${actualFailures.length}건)`);
  
  for (const fail of actualFailures) {
    logger.info(`[Retry] 재시도 실행: ${fail.serial_number}`);
    try {
      const result = await cancelService.cancelSubscription(fail.serial_number, true);
      if (result.success) {
        const serial = serialService.getBySerialNumber(fail.serial_number);
        if (serial) serialService.cancelSubscription(serial.id);
        
        // 성공으로 상태 업데이트 (일일 리포트에서 실패 목록 제거됨)
        fail.success = true;
        fail.verified = result.verified;
        fail.verified_status = result.verified_status;
        fail.screenshot_path = result.screenshot_path;
        fail.error = undefined;

        logger.info(`[Retry] 재시도 성공: ${fail.serial_number}`);
        await notificationService.sendCancelResultSlack(result).catch(() => {});
      } else {
        fail.error = `[재시도 실패] ${result.error}`;
        logger.warn(`[Retry] 재시도 역시 실패: ${fail.serial_number} - ${result.error}`);
      }
    } catch (err: any) {
      logger.error(`[Retry] 재시도 중 에러: ${err.message}`);
    }
    // 연속 요청 방지
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
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
    const task = cron.schedule(cronExpr, runMailCheck, { timezone: 'Asia/Seoul' });
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
  if (retryCancelTask) retryCancelTask.stop();
  logger.info('스케줄러 중지');
}
