import cron from 'node-cron';
import { serialService } from './services/serial.service';
import { cancelService, cleanOldScreenshots } from './services/cancel.service';
import { checkInboundNow } from './services/mail/inbound.service';
import { notificationService, buildScheduleSummary } from './services/notification.service';
import { runAutoRenewNow, runCandidateFailsafeCancelNow, runLimboFallbackNow } from './services/automation.service';
import { sendTemplate as sendMailTemplate } from './services/mail/smtp.service';
import { sendCancelCompleteNotice } from './services/mail/lifecycle-notice.service';
import { deleteOldActivityLogs } from './services/activity-log.service';
import { deleteExpiredSerialMailNoticeLogs, logSerialMailNotice } from './services/serial-mail-notice-log.service';
import { getSettings } from './settings';
import { getDb } from './database';
import { logger } from './utils/logger';
import { getDateString, getTodayDateString, getYesterdayDateString } from './utils/date-utils';
import type { DailyReport, CancelResult, ExpiryNoticeRule, SerialWithCustomer } from '../shared/types';

const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

let mailCheckTasks: cron.ScheduledTask[] = [];
let dailyCancelTask: cron.ScheduledTask | null = null;
let preExpiryCancelTask: cron.ScheduledTask | null = null;
let autoRenewTask: cron.ScheduledTask | null = null;
let dailyReportTasks: cron.ScheduledTask[] = [];
let monthlyReportTask: cron.ScheduledTask | null = null;
let dailySummaryTask: cron.ScheduledTask | null = null;
let retryCancelTask: cron.ScheduledTask | null = null;
let expiryNoticeTask: cron.ScheduledTask | null = null;

// 하루 동안의 cancel 결과를 모아둠 (앱 재시작 대비 DB 영속)
interface PersistedCancelResult extends CancelResult { date: string; }
let limboCronTask: cron.ScheduledTask | null = null;
let dailyCancelResults: PersistedCancelResult[] = [];
// lastReportSentDate를 메모리에만 두면 앱 재시작 시 초기화되어 중복 리포트 발송.
// DB settings에 영속화하여 재시작 후에도 중복 방지.
function getLastReportSentDate(): string {
  try {
    const row = getDb()
      .prepare("SELECT value FROM settings WHERE key='last_report_sent_date'")
      .get() as { value: string } | undefined;
    return row?.value ?? '';
  } catch { return ''; }
}

function setLastReportSentDate(date: string): void {
  try {
    getDb()
      .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('last_report_sent_date', ?)")
      .run(date);
  } catch { /* DB 미초기화 시 무시 */ }
}

// ── Cron catch-up (VM 점검 등으로 다운된 동안 스킵된 cron 보정) ──────────────────
// 날짜 범위 쿼리(autoRenew/limbo)는 다음 실행 때 자연히 따라잡지만, 정확한 날짜를
// 조회하는 작업(만료예고메일/사전취소)과 전일자 리포트는 그날을 놓치면 영구 손실되므로
// "마지막 실행일"을 settings에 기록해 서버 시작 시 보정 실행한다.
function getJobLastRunDate(jobKey: string): string {
  try {
    const row = getDb()
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get(`cron_last_run:${jobKey}`) as { value: string } | undefined;
    return row?.value ?? '';
  } catch { return ''; }
}

function setJobLastRunDate(jobKey: string, date: string): void {
  try {
    getDb()
      .prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
      .run(`cron_last_run:${jobKey}`, date);
  } catch { /* DB 미초기화 시 무시 */ }
}

// 설정된 HH:MM(Asia/Tokyo)이 오늘 이미 지났는지 여부 — timeToCron과 동일한 파싱 사용
function hasScheduledTimePassedToday(timeStr: string): boolean {
  const cronExpr = timeToCron(timeStr);
  const [mStr, hStr] = cronExpr.split(' ');
  const scheduledMinutes = parseInt(hStr, 10) * 60 + parseInt(mStr, 10);
  const nowTokyo = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
  return nowTokyo.getHours() * 60 + nowTokyo.getMinutes() >= scheduledMinutes;
}

function addDaysToDateString(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + days);
  return getDateString(d);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function persistSchedulerSummary(summary: string): void {
  try {
    const payload = JSON.stringify({
      summary,
      updated_at: new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' }),
    });
    getDb()
      .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('scheduler_summary', ?)")
      .run(payload);
  } catch { /* DB 미초기화 시 무시 */ }
}

function persistDailyCancelResults(): void {
  try {
    getDb().prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('daily_cancel_results', ?)")
      .run(JSON.stringify(dailyCancelResults));
  } catch { /* DB 미초기화 시 무시 */ }
}

function withCancelResultDate(result: CancelResult, date = getTodayDateString()): PersistedCancelResult {
  return { ...result, date };
}

function initDailyCancelResults(): void {
  const today = getTodayDateString();
  try {
    const row = getDb().prepare("SELECT value FROM settings WHERE key = 'daily_cancel_results'")
      .get() as { value: string } | undefined;
    if (row) {
      const parsed: PersistedCancelResult[] = JSON.parse(row.value);
      dailyCancelResults = parsed
        .filter(r => r.date === today)
        .map(r => ({ serial_number: r.serial_number, success: r.success, error: r.error, verified: r.verified, verified_status: r.verified_status, screenshot_path: r.screenshot_path, date: r.date }));
      if (dailyCancelResults.length > 0) {
        logger.info(`[Scheduler] Restored today's cancel failure history: ${dailyCancelResults.length}`);
      }
    }
  } catch { /* 저장 데이터 없음 */ }
}

// 시간 문자열 (HH:MM 또는 HH:MM AM/PM) → cron expression (M H * * *)
export function timeToCron(timeStr: string): string {
  const clean = (timeStr || '09:00').trim().toUpperCase();
  const isPM = clean.includes('PM');
  const isAM = clean.includes('AM');

  // AM/PM 제거 후 숫자만 추출
  const timePart = clean.replace(/[AP]M/g, '').trim();
  const parts = timePart.split(':');

  let h = parseInt(parts[0], 10) || 0;
  const mRaw = parts.length > 1 ? parseInt(parts[1], 10) : 0;
  const m = Math.max(0, Math.min(59, isNaN(mRaw) ? 0 : mRaw));

  if (isPM && h < 12) h += 12;
  else if (isAM && h === 12) h = 0;
  // No special case for 1-6: treat all inputs without AM/PM as 24-hour format

  // 0-23 범위 보장
  h = Math.max(0, Math.min(23, isNaN(h) ? 0 : h % 24));

  return `${m} ${h} * * *`;
}

export function startScheduler(): void {
  logger.info('Scheduler started');
  initDailyCancelResults();

  // 앱 시작 시 즉시 1회 실행 — 장시간 오프라인 후 재시작 시 만료 상태 즉시 반영
  try { serialService.syncExpired(); } catch { /* ignore */ }

  // 매일 00:05 JST — 만료 상태 일괄 동기화 (getAll에서 제거된 syncExpiredStatus 대체)
  cron.schedule('5 0 * * *', () => {
    try { serialService.syncExpired(); } catch { /* ignore */ }
  }, { timezone: 'Asia/Tokyo' });

  // 매일 00:10 JST — 30일 이상 된 Playwright 스크린샷 정리 (디스크 고갈 방지)
  cron.schedule('10 0 * * *', () => {
    cleanOldScreenshots(30);
    const deleted = deleteOldActivityLogs(Number(process.env.ACTIVITY_LOG_RETENTION_DAYS) || 180);
    if (deleted > 0) logger.info(`[activity_logs] deleted old rows: ${deleted}`);
    const deletedNoticeLogs = deleteExpiredSerialMailNoticeLogs();
    if (deletedNoticeLogs > 0) logger.info(`[serial_mail_notice_logs] deleted expired rows: ${deletedNoticeLogs}`);
  }, { timezone: 'Asia/Tokyo' });

  // 1. 메일 체크 — 설정된 시각 또는 기본값 (12:00, 17:00)
  startMailCheck();

   // [제거됨] 2. 매일 자정에 만료된 시리얼 cancel 처리 (새벽 리포트 폭풍의 원인)
   // 대신 실패 건만 재시도하는 로직이 startPreExpiryTask 내에서 별도로 스케줄링됩니다.
  /*
  dailyCancelTask = cron.schedule('0 0 * * *', async () => {
    const settings = getSettings();
    if (!settings.auto_cancel_enabled) {
      logger.info('Expired serial cancel task is disabled (skip)');
      return;
    }

    logger.info('Expired serial cancel task started');
    try {
      const results = await cancelService.processExpiredSerials();
      dailyCancelResults.push(...results);
      logger.info(`Cancel task completed: success=${results.filter(r => r.success).length}, failed=${results.filter(r => !r.success).length}`);

      // cancel 결과를 개별적으로 Slack으로 전송
      for (const result of results) {
        await notificationService.sendCancelResultSlack(result).catch(() => { });
      }
    } catch (err: unknown) {
      logger.error(`Cancel task error: ${getErrorMessage(err)}`);
    }
  }, { timezone: 'Asia/Tokyo' });
  */

  // 3. 설정된 시각에 만료 N일 전 자동 cancel (갱신 중단 요청이 있으면)
  startPreExpiryTask();

  // 3-b. 매일 00:10 KST — 만료된 시리얼 자동 갱신 (renewal_stop_requested = 0)
  startAutoRenewTask();

  // 4. 설정된 시각에 전일 작업 일일 리포트 전송
  startDailyReportTasks();

  // 5. 매월 10일 09:00에 3개월 후 만료 시리얼 리포트
  monthlyReportTask = cron.schedule('0 9 10 * *', async () => {
    logger.info('Monthly expiry report generation started');
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
        report_date: getDateString(now),
        target_month: targetMonthStr,
        expiring_serials: expiringSerials,
        total_count: expiringSerials.length,
      });

      logger.info(`Monthly report sent: ${targetMonthStr}, expiring=${expiringSerials.length}`);
    } catch (err: unknown) {
      logger.error(`Monthly report error: ${getErrorMessage(err)}`);
    }
  }, { timezone: 'Asia/Tokyo' });

  // 6. Limbo 보정 — 매일 03:00 JST (stop=1인데 만료 후에도 cancelled가 안 된 경우)
  limboCronTask = cron.schedule('0 3 * * *', () => runLimboFallbackOnce(), { timezone: 'Asia/Tokyo' });

  // 7. 만료 예고 메일 — UI 설정 기반
  startExpiryNoticeTask();

  // 8. 매일 아침 08:30 일일 요약 Slack 알림
  // cancel 예정 시리얼, 갱신의뢰 접수, 전일 작업 요약
  dailySummaryTask = cron.schedule('30 8 * * *', async () => {
    logger.info('Daily summary Slack notification started');
    try {
      const settings = getSettings();

      // 오늘 cancel 예정 시리얼 (만료 N일 전)
      const daysBefore = settings.auto_cancel_days_before ?? 1;
      const cancelTargetDate = new Date();
      cancelTargetDate.setDate(cancelTargetDate.getDate() + daysBefore);
      const cancelTargetDateStr = cancelTargetDate.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
      const cancelCandidates = serialService.getExpiringSerialsOnDate(cancelTargetDateStr);
      const cancelTargets = cancelCandidates.map(s => {
        let cancel_skipped = true;
        try {
          // hasStopRequested=1 means customer requested renewal stop, so cancel should run.
          cancel_skipped = !serialService.hasStopRequested(s.id);
        } catch (e: unknown) {
          logger.warn(`[dailySummary] hasStopRequested(${s.id}) error: ${getErrorMessage(e)}`);
        }
        return {
          serial_number: s.serial_number,
          customer_name: s.customer?.name || '',
          expiry_date: s.expiry_date,
          cancel_skipped,
        };
      });

      // 갱신의뢰 미처리 목록 (pending_orders 기준)
      const db = getDb();
      const pendingRenewals = db.prepare(`
        SELECT serial_number, customer_name, created_at
        FROM pending_orders
        WHERE order_type = 'renewal' AND status = 'pending'
        ORDER BY created_at DESC
        LIMIT 20
      `).all() as { serial_number: string; customer_name: string; created_at: string }[];

      const renewalRequests = pendingRenewals.map(r => ({
        serial_number: r.serial_number,
        customer_name: r.customer_name,
        request_date: r.created_at?.slice(0, 10) || '',
      }));

      // 전일 작업 요약
      const yesterdayDateStr = getYesterdayDateString();
      const yesterdayLogs = serialService.getLogsForDate(yesterdayDateStr);
      
      const yesterdayStats = {
        registered: yesterdayLogs.filter(l => l.action === 'registered' || l.action === 'bulk_imported').length,
        autoRenewed: yesterdayLogs.filter(l => l.action === 'renewed' && l.actor === 'auto').length,
        manualRenewed: yesterdayLogs.filter(l => l.action === 'renewed' && l.actor !== 'auto').length,
        cancelled: yesterdayLogs.filter(l => l.action === 'cancelled').length,
        failed: dailyCancelResults.filter(r => r.date === yesterdayDateStr && !r.success).length,
      };

      await notificationService.sendDailySummarySlack({
        cancelTargets,
        renewalRequests,
        yesterdayStats,
      });

      logger.info('Daily summary Slack notification sent');
    } catch (err: unknown) {
      logger.error(`Daily summary Slack notification error: ${getErrorMessage(err)}`);
    }
  }, { timezone: 'Asia/Tokyo' });

  // 7. 전체 스케줄링 요약 로그
  const settings = getSettings();
  const mailTimes = settings.mail_check_times || ['12:00', '17:00'];
  const cancelTime = settings.auto_cancel_time || '09:00';
  const reportTimes = settings.daily_report_times?.length ? settings.daily_report_times : ['10:00'];
  const summary = buildScheduleSummary(mailTimes, cancelTime, reportTimes, settings.expiry_notice_time || '05:00');
  logger.info(`[Schedule Summary] ${summary}`);
  persistSchedulerSummary(summary);

  // 9. VM 점검 등으로 다운된 동안 스킵된 cron 보정 (서버 시작 후 1회, 순차 실행)
  void runStartupCatchup();
}

async function runLimboFallbackOnce(): Promise<void> {
  const today = getTodayDateString();
  if (getJobLastRunDate('limbo_fallback') === today) {
    logger.info('[Limbo] already ran today, skip');
    return;
  }

  logger.info('[Limbo] fallback started');
  try {
    const result = await runLimboFallbackNow();
    if (result.processed > 0) {
      logger.info(`[Limbo] completed: success=${result.success}, failed=${result.failed}`);
    } else {
      logger.info('[Limbo] no fallback targets');
    }
  } catch (err: unknown) {
    logger.error(`[Limbo] error: ${getErrorMessage(err)}`);
  }
  setJobLastRunDate('limbo_fallback', today);
}

// 만료 전 자동 cancel 스케줄 시작 (설정된 시각 기반)
function startPreExpiryTask(): void {
  if (preExpiryCancelTask) {
    preExpiryCancelTask.stop();
    preExpiryCancelTask = null;
  }

  const settings = getSettings();
  const cronExpr = timeToCron(settings.auto_cancel_time || '09:00');
  logger.info(`Pre-expiry auto-cancel schedule: ${cronExpr} (auto_cancel_time: ${settings.auto_cancel_time})`);

  preExpiryCancelTask = cron.schedule(cronExpr, () => runPreExpiryCancelOnce(), { timezone: 'Asia/Tokyo' });

  // 실패 건 재시도 스케줄링 (설정된 시각 2시간 후 실행)
  if (retryCancelTask) {
    retryCancelTask.stop();
    retryCancelTask = null;
  }

  const [hStr, mStr] = (settings.auto_cancel_time || '09:00').split(':');
  let h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  if (isNaN(h) || isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    logger.warn(`[Retry] invalid auto_cancel_time ("${settings.auto_cancel_time}") -> using default 09:00`);
    h = 9;
  }
  const retryH = (h + 2) % 24; // 2시간 후
  const retryCron = `${m} ${retryH} * * *`;

  retryCancelTask = cron.schedule(retryCron, async () => {
    await retryFailedCancellations();
  }, { timezone: 'Asia/Tokyo' });

  logger.info(`Failure retry schedule: ${retryCron} (2 hours after auto-cancel)`);
}

async function runPreExpiryCancelOnce(): Promise<void> {
  const today = getTodayDateString();
  if (getJobLastRunDate('pre_expiry_cancel') === today) {
    logger.info('[PreExpiryCancel] already ran today, skip');
    return;
  }

  logger.info('Pre-expiry auto-cancel check started');
  try {
    const results = await cancelService.processPreExpiryAutoCancel();
    if (results.length > 0) {
      dailyCancelResults.push(...results.map(r => withCancelResultDate(r)));
      persistDailyCancelResults();
      logger.info(`Pre-expiry auto-cancel completed: ${results.length}`);

      // cancel 결과를 개별적으로 Slack으로 전송
      for (const result of results) {
        await notificationService.sendCancelResultSlack(result).catch(() => { });
      }
    }

    const failsafe = await runCandidateFailsafeCancelNow();
    if (failsafe.results.length > 0) {
      dailyCancelResults.push(...failsafe.results.map(r => withCancelResultDate(r)));
      persistDailyCancelResults();
      logger.warn(
        `[Failsafe] candidate auto-cancel completed: processed=${failsafe.processed}, ` +
        `success=${failsafe.success}, failed=${failsafe.failed}`
      );
      for (const result of failsafe.results) {
        await notificationService.sendCancelResultSlack(result).catch(() => {});
      }
    }
  } catch (err: unknown) {
    logger.error(`Pre-expiry auto-cancel error: ${getErrorMessage(err)}`);
  }
  setJobLastRunDate('pre_expiry_cancel', today);
}

/**
 * 당일 발생한 실패 건만 골라서 재시도하는 로직
 */
async function retryFailedCancellations() {
  const failures = dailyCancelResults.filter(r => !r.success);
  if (failures.length === 0) {
    logger.info('[Retry] no failed items to retry.');
    return;
  }

  // 이미 성공한 기록이 나중에 추가되었을 수도 있으므로 (수동 처리 등) 최종 확인
  const actualFailures = failures.filter(f => {
    return !dailyCancelResults.some(r => r.serial_number === f.serial_number && r.success);
  });

  if (actualFailures.length === 0) {
    logger.info('[Retry] all items already handled or no retry targets.');
    return;
  }

  logger.info(`[Retry] retrying error/timeout failures (${actualFailures.length})`);
  
  for (const fail of actualFailures) {
    logger.info(`[Retry] retry started: ${fail.serial_number}`);
    try {
      const result = await cancelService.cancelSubscription(fail.serial_number, true);
      if (result.success && result.verified) {
        const serial = serialService.getBySerialNumber(fail.serial_number);
        if (serial) {
          const updated = serialService.cancelSubscription(serial.id);
          if (updated) await sendCancelCompleteNotice(updated).catch(() => {});
        }

        // 검증된 성공만 상태 업데이트 (일일 리포트에서 실패 목록 제거됨)
        fail.success = true;
        fail.verified = result.verified;
        fail.verified_status = result.verified_status;
        fail.screenshot_path = result.screenshot_path;
        fail.error = undefined;

        logger.info(`[Retry] retry succeeded: ${fail.serial_number}`);
        await notificationService.sendCancelResultSlack(result).catch(() => {});
      } else if (result.success && !result.verified) {
        // 사이트 작업은 끝났으나 미검증 → 실패로 남겨 다음 회차/수동 확인 대상으로 유지
        fail.error = `[재시도 미검증] status=${result.verified_status || 'unknown'}`;
        logger.warn(`[Retry] retry completed but UNVERIFIED; kept as failure: ${fail.serial_number}`);
      } else {
        fail.error = `[재시도 실패] ${result.error}`;
        logger.warn(`[Retry] retry failed again: ${fail.serial_number} - ${result.error}`);
      }
    } catch (err: unknown) {
      logger.error(`[Retry] retry error: ${getErrorMessage(err)}`);
    }
    // 연속 요청 방지
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  persistDailyCancelResults();
}

// Settings 저장 후 호출하여 시각 변경을 즉시 반영
export function restartPreExpiryTask(): void {
  logger.info('Pre-expiry auto-cancel schedule restarted');
  startPreExpiryTask();
}

// 매일 00:10 KST — 만료 시리얼 자동 갱신 (renewal_stop_requested = 0)
function startAutoRenewTask(): void {
  if (autoRenewTask) {
    autoRenewTask.stop();
    autoRenewTask = null;
  }

  autoRenewTask = cron.schedule('10 0 * * *', async () => {
    logger.info('[AutoRenew] auto-renew started');
    try {
      const result = await runAutoRenewNow();
      if (result.renewed > 0) {
        logger.info(`[AutoRenew] completed: renewed=${result.renewed} (${result.serials.join(', ')})`);
      } else {
        logger.info('[AutoRenew] no renewal targets');
      }
    } catch (err: unknown) {
      logger.error(`[AutoRenew] error: ${getErrorMessage(err)}`);
    }
  }, { timezone: 'Asia/Tokyo' });

  logger.info('[AutoRenew] schedule registered: 00:10 KST');
}

export function startMailCheck(): void {
  // 기존 태스크 정지
  for (const task of mailCheckTasks) {
    task.stop();
  }
  mailCheckTasks = [];

  const runMailCheck = async () => {
    logger.info('Inbound mail check started');
    try {
      const result = await checkInboundNow();
      if (result.saved > 0 || result.processed > 0) {
        logger.info(`Inbound processing completed: saved=${result.saved}, renewal_requests=${result.processed}`);
      }
      if (result.errors.length > 0) {
        logger.warn(`Mail processing errors: ${result.errors.join(', ')}`);
      }
    } catch (err: unknown) {
      logger.error(`Mail check error: ${getErrorMessage(err)}`);
    }
  };

  const settings = getSettings();
  const times = settings.mail_check_times || ['12:00', '17:00'];

  for (const time of times) {
    const cronExpr = timeToCron(time);
    const task = cron.schedule(cronExpr, runMailCheck, { timezone: 'Asia/Tokyo' });
    mailCheckTasks.push(task);
  }

  logger.info(`Mail check schedule registered: ${times.join(', ')}`);
}

function normalizeExpiryNoticeRules(settings: ReturnType<typeof getSettings>): ExpiryNoticeRule[] {
  const rawRules = Array.isArray(settings.expiry_notice_rules) ? settings.expiry_notice_rules : [];
  const fallbackTemplate = settings.expiry_notice_renewal_template || 'renewal_reminder';
  const fromRules = rawRules
    .map((rule: Partial<ExpiryNoticeRule>) => ({
      id: String(rule.id || `d${rule.days_before ?? ''}`),
      days_before: Number(rule.days_before),
      renewal_template: String(rule.renewal_template || fallbackTemplate),
    }))
    .filter(rule => Number.isInteger(rule.days_before) && rule.days_before >= 0 && rule.days_before <= 365 && !!rule.renewal_template);

  if (fromRules.length > 0) {
    return Array.from(new Map(fromRules.map(rule => [rule.id, rule])).values())
      .sort((a, b) => b.days_before - a.days_before);
  }

  const legacyDays = Array.isArray(settings.expiry_notice_days) ? settings.expiry_notice_days : [90, 30, 10];
  return Array.from(new Set(
    legacyDays
      .map(day => Number(day))
      .filter(day => Number.isInteger(day) && day >= 0 && day <= 365)
  ))
    .sort((a, b) => b - a)
    .map(day => ({ id: `d${day}`, days_before: day, renewal_template: fallbackTemplate }));
}

function buildExpiryNoticeVars(serial: SerialWithCustomer | null, today: string): Record<string, string> {
  if (!serial) {
    return {
      CUSTOMER_NAME: 'Sample Customer',
      CUSTOMER_EMAIL: 'sample@example.com',
      SERIAL_NUMBER: 'SAMPLE-0000',
      EXPIRY_DATE: today,
      PURCHASE_DATE: today,
      MAIN_PRODUCT: 'exocad DentalCAD',
      MODULES: 'Sample Add-on',
      TODAY: today,
      DEALER: 'Sample Dealer',
      SALES_MANAGER: 'Sample Manager',
    };
  }

  return {
    CUSTOMER_NAME: serial.customer.name,
    CUSTOMER_EMAIL: serial.customer.email,
    SERIAL_NUMBER: serial.serial_number,
    EXPIRY_DATE: serial.expiry_date ?? '',
    PURCHASE_DATE: serial.purchase_date ?? '',
    MAIN_PRODUCT: serial.main_product,
    MODULES: (JSON.parse(serial.modules || '[]') as string[]).join(', '),
    TODAY: today,
    DEALER: serial.customer.dealer,
    SALES_MANAGER: serial.customer.sales_manager,
  };
}

// 만료 예고 메일 스케줄 시작 (설정된 시각/템플릿 기반)
export function startExpiryNoticeTask(): void {
  if (expiryNoticeTask) {
    expiryNoticeTask.stop();
    expiryNoticeTask = null;
  }

  const settings = getSettings();
  if (settings.expiry_notice_enabled === false) {
    logger.info('[ExpiryNotice] expiry notice email disabled');
    return;
  }

  const cronExpr = timeToCron(settings.expiry_notice_time || '05:00');
  logger.info(`[ExpiryNotice] 스케줄: ${cronExpr} (time: ${settings.expiry_notice_time || '05:00'})`);

  expiryNoticeTask = cron.schedule(cronExpr, () => runExpiryNoticeOnce(settings), { timezone: 'Asia/Tokyo' });
}

async function runExpiryNoticeOnce(settings: ReturnType<typeof getSettings>): Promise<void> {
  const today = getTodayDateString();
  if (getJobLastRunDate('expiry_notice') === today) {
    logger.info('[ExpiryNotice] already ran today, skip');
    return;
  }

  logger.info('[ExpiryNotice] expiry notice email started');
  {
    const now = new Date();
    const rules = normalizeExpiryNoticeRules(settings);
    const stopTemplate = settings.expiry_notice_stop_template || 'stop_expiry_reminder';
    const tokyoDateStr = (daysAhead: number): string =>
      new Date(now.getTime() + daysAhead * 86400000)
        .toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });

    for (const rule of rules) {
      const targetDate = tokyoDateStr(rule.days_before);
      const serials = serialService.getExpiringSerialsOnDate(targetDate)
        .filter(s => s.customer.email);

      for (const serial of serials) {
        const code = serial.renewal_stop_requested ? stopTemplate : rule.renewal_template;
        try {
          const result = await sendMailTemplate(
            code,
            serial.customer.email,
            buildExpiryNoticeVars(serial, tokyoDateStr(0)),
            { serial_id: serial.id, actor: 'auto' }
          );

          if (result.success) {
            logSerialMailNotice({
              serial_id: serial.id,
              serial_number: serial.serial_number,
              template_code: code,
              notice_kind: serial.renewal_stop_requested ? 'expiry_stop' : 'expiry_renewal',
              days_before: rule.days_before,
              recipient_email: serial.customer.email,
              status: 'sent',
              message: result.message,
            });
            logger.info(`[ExpiryNotice] D-${rule.days_before} email sent: ${serial.serial_number} -> ${serial.customer.email} (${code})`);
          } else {
            logSerialMailNotice({
              serial_id: serial.id,
              serial_number: serial.serial_number,
              template_code: code,
              notice_kind: serial.renewal_stop_requested ? 'expiry_stop' : 'expiry_renewal',
              days_before: rule.days_before,
              recipient_email: serial.customer.email,
              status: 'failed',
              message: result.message,
            });
            logger.error(`[ExpiryNotice] D-${rule.days_before} send failed: ${serial.serial_number} - ${result.message}`);
          }
        } catch (err: unknown) {
          const message = getErrorMessage(err);
          logSerialMailNotice({
            serial_id: serial.id,
            serial_number: serial.serial_number,
            template_code: code,
            notice_kind: serial.renewal_stop_requested ? 'expiry_stop' : 'expiry_renewal',
            days_before: rule.days_before,
            recipient_email: serial.customer.email,
            status: 'failed',
            message,
          });
          logger.error(`[ExpiryNotice] send failed: ${serial.serial_number} - ${message}`);
        }
      }
    }
  }
  setJobLastRunDate('expiry_notice', today);
}

export async function runExpiryNoticeDryRun(input: {
  days_before: number;
  template_code: string;
  test_email?: string;
  use_stop_template?: boolean;
}): Promise<{
  success: boolean;
  message: string;
  target_date: string;
  matched_count: number;
  sample_serial?: string;
  sample_sent_to?: string;
}> {
  const daysBefore = Number(input.days_before);
  if (!Number.isInteger(daysBefore) || daysBefore < 0 || daysBefore > 365) {
    return { success: false, message: '만료 전 발송일은 0~365 사이의 정수여야 합니다.', target_date: '', matched_count: 0 };
  }

  const templateCode = (input.template_code || '').trim();
  if (!templateCode) {
    return { success: false, message: '템플릿을 선택해주세요.', target_date: '', matched_count: 0 };
  }

  const testEmail = (input.test_email || '').trim();
  if (!testEmail) {
    return { success: false, message: '샘플 메일을 받을 테스트 주소를 입력해주세요.', target_date: '', matched_count: 0 };
  }

  const now = new Date();
  const today = now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  const targetDate = new Date(now.getTime() + daysBefore * 86400000)
    .toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  const matched = serialService.getExpiringSerialsOnDate(targetDate)
    .filter(serial => input.use_stop_template ? !!serial.renewal_stop_requested : !serial.renewal_stop_requested);
  const sample = matched.find(serial => serial.customer.email) ?? matched[0] ?? null;

  const result = await sendMailTemplate(
    templateCode,
    testEmail,
    buildExpiryNoticeVars(sample, today),
    { serial_id: sample?.id, actor: 'manual' }
  );

  return {
    success: result.success,
    message: result.success
      ? `Dry-run 샘플 메일 발송 완료. 대상 ${matched.length}건, 기준일 ${targetDate}.`
      : result.message,
    target_date: targetDate,
    matched_count: matched.length,
    sample_serial: sample?.serial_number,
    sample_sent_to: result.success ? testEmail : undefined,
  };
}

async function sendDailyReportForDate(targetDateStr: string): Promise<void> {
  const logs = serialService.getLogsForDate(targetDateStr);
  const lastSent = getLastReportSentDate();
  const report: DailyReport = {
    date: targetDateStr,
    new_registrations: logs.filter(l => l.action === 'registered' || l.action === 'bulk_imported').length,
    renewals: logs.filter(l => l.action === 'renewed' && l.actor === 'auto').length,
    auto_renewals: logs.filter(l => l.action === 'renewed' && l.actor === 'auto').length,
    manual_renewals: logs.filter(l => l.action === 'renewed' && l.actor !== 'auto').length,
    cancellations: logs.filter(l => l.action === 'cancelled').length,
    failed_cancellations: lastSent === targetDateStr ? [] : dailyCancelResults.filter(r => r.date === targetDateStr && !r.success),
    details: logs,
  };

  await notificationService.sendDailyReport(report);
  setLastReportSentDate(targetDateStr);
  dailyCancelResults = dailyCancelResults.filter(r => !r.success && r.date !== targetDateStr);
  persistDailyCancelResults();
}

export async function sendDailyReportNow(): Promise<void> {
  await sendDailyReportForDate(getTodayDateString());
}

// lastSent 다음날부터 어제까지 빠진 날짜를 순차적으로 백필 (최대 14일 — 폭주 방지)
async function catchUpDailyReports(): Promise<void> {
  const lastSent = getLastReportSentDate();
  if (!lastSent) return; // 최초 실행 — 백필 대상 없음

  const yesterday = getYesterdayDateString();
  const MAX_BACKFILL_DAYS = 14;
  let cursor = addDaysToDateString(lastSent, 1);
  let count = 0;

  while (cursor <= yesterday && count < MAX_BACKFILL_DAYS) {
    logger.warn(`[Catchup] sending missed daily report for ${cursor}`);
    await sendDailyReportForDate(cursor).catch((err: unknown) =>
      logger.error(`[Catchup] daily report ${cursor} error: ${getErrorMessage(err)}`));
    cursor = addDaysToDateString(cursor, 1);
    count++;
  }
}

// 서버 시작 시 1회 — VM 점검 등으로 다운된 동안 오늘 스케줄을 놓친 작업을 순차적으로 보정.
// 자연히 따라잡는 작업(autoRenew/limbo/정리작업)은 대상에서 제외 — 정확한 날짜를 조회해
// 그날을 놓치면 영구 손실되는 작업(만료예고메일/사전취소)과 전일자 리포트만 다룬다.
async function runStartupCatchup(): Promise<void> {
  try {
    logger.info('[Catchup] running inbound mail check on startup');
    await checkInboundNow();
  } catch (err: unknown) {
    logger.error(`[Catchup] mail check error: ${getErrorMessage(err)}`);
  }

  try {
    const today = getTodayDateString();
    const settings = getSettings();
    const noticeTime = settings.expiry_notice_time || '05:00';
    if (
      settings.expiry_notice_enabled !== false &&
      hasScheduledTimePassedToday(noticeTime) &&
      getJobLastRunDate('expiry_notice') !== today
    ) {
      logger.warn(`[Catchup] expiry notice missed today's ${noticeTime} run — executing now`);
      await runExpiryNoticeOnce(settings);
    }
  } catch (err: unknown) {
    logger.error(`[Catchup] expiry notice error: ${getErrorMessage(err)}`);
  }

  try {
    const today = getTodayDateString();
    const settings = getSettings();
    const cancelTime = settings.auto_cancel_time || '09:00';
    if (
      settings.auto_cancel_enabled &&
      hasScheduledTimePassedToday(cancelTime) &&
      getJobLastRunDate('pre_expiry_cancel') !== today
    ) {
      logger.warn(`[Catchup] pre-expiry auto-cancel missed today's ${cancelTime} run — executing now`);
      await runPreExpiryCancelOnce();
      await sleep(10_000); // Playwright 연속 실행 방지 (e2-micro 부하 고려)
      await retryFailedCancellations();
    }
  } catch (err: unknown) {
    logger.error(`[Catchup] pre-expiry auto-cancel error: ${getErrorMessage(err)}`);
  }

  try {
    const today = getTodayDateString();
    if (hasScheduledTimePassedToday('03:00') && getJobLastRunDate('limbo_fallback') !== today) {
      // status='expired'인데 stop=1이라 실제 사이트 취소가 안 됐을 수 있는 시리얼 보정.
      // 다운타임이 자정을 넘기면 위 pre-expiry catchup은 날짜가 바뀌어 대상을 못 찾으므로,
      // 7일 범위로 조회하는 limbo가 그 갭을 닫는 실질적인 안전망이다.
      logger.warn("[Catchup] limbo fallback missed today's 03:00 run — executing now");
      await sleep(10_000);
      await runLimboFallbackOnce();
    }
  } catch (err: unknown) {
    logger.error(`[Catchup] limbo fallback error: ${getErrorMessage(err)}`);
  }

  try {
    await catchUpDailyReports();
  } catch (err: unknown) {
    logger.error(`[Catchup] daily report backfill error: ${getErrorMessage(err)}`);
  }
}

export function startDailyReportTasks(): void {
  for (const task of dailyReportTasks) {
    task.stop();
  }
  dailyReportTasks = [];

  const settings = getSettings();
  const times = settings.daily_report_times?.length ? settings.daily_report_times : ['10:00'];

  for (const time of times) {
    const cronExpr = timeToCron(time);
    const task = cron.schedule(cronExpr, async () => {
      logger.info(`Daily report generation started (${time}, based on yesterday's data)`);
      try {
        await sendDailyReportForDate(getYesterdayDateString());
        logger.info('Daily report sent');
      } catch (err: unknown) {
        logger.error(`Daily report error: ${getErrorMessage(err)}`);
      }
    }, { timezone: 'Asia/Tokyo' });

    dailyReportTasks.push(task);
  }

  logger.info(`Daily report schedule registered: ${times.join(', ')}`);
}

export function stopScheduler(): void {
  for (const task of mailCheckTasks) task.stop();
  if (limboCronTask) limboCronTask.stop();
  if (dailyCancelTask) dailyCancelTask.stop();
  if (preExpiryCancelTask) preExpiryCancelTask.stop();
  if (autoRenewTask) autoRenewTask.stop();
  if (expiryNoticeTask) expiryNoticeTask.stop();
  for (const task of dailyReportTasks) task.stop();
  if (monthlyReportTask) monthlyReportTask.stop();
  if (dailySummaryTask) dailySummaryTask.stop();
  if (retryCancelTask) retryCancelTask.stop();
  logger.info('Scheduler stopped');
}
