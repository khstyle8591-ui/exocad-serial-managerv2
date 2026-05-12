import cron from 'node-cron';
import { serialService } from './services/serial.service';
import { cancelService, cleanOldScreenshots } from './services/cancel.service';
import { checkInboundNow } from './services/mail/inbound.service';
import { notificationService, buildScheduleSummary } from './services/notification.service';
import { runAutoRenewNow, runLimboFallbackNow } from './services/automation.service';
import { sendTemplate as sendMailTemplate } from './services/mail/smtp.service';
import { sendCancelCompleteNotice } from './services/mail/lifecycle-notice.service';
import { getSettings } from './settings';
import { getDb } from './database';
import { logger } from './utils/logger';
import { getTodayDateString, getYesterdayDateString } from './utils/date-utils';
import type { DailyReport, CancelResult, ExpiryNoticeRule, SerialWithCustomer } from '../shared/types';

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
let dailyCancelResults: CancelResult[] = [];
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

function persistDailyCancelResults(): void {
  try {
    const today = getTodayDateString();
    const data: PersistedCancelResult[] = dailyCancelResults.map(r => ({ ...r, date: today }));
    getDb().prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('daily_cancel_results', ?)")
      .run(JSON.stringify(data));
  } catch { /* DB 미초기화 시 무시 */ }
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
        .map(r => ({ serial_number: r.serial_number, success: r.success, error: r.error, verified: r.verified, verified_status: r.verified_status, screenshot_path: r.screenshot_path }));
      if (dailyCancelResults.length > 0) {
        logger.info(`[스케줄러] 당일 취소 실패 이력 복원: ${dailyCancelResults.length}건`);
      }
    }
  } catch { /* 저장 데이터 없음 */ }
}

// 시간 문자열 (HH:MM 또는 HH:MM AM/PM) → cron expression (M H * * *)
function timeToCron(timeStr: string): string {
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
  logger.info('스케줄러 시작');
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
  }, { timezone: 'Asia/Tokyo' });

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
  }, { timezone: 'Asia/Tokyo' });
  */

  // 3. 설정된 시각에 만료 N일 전 자동 cancel (갱신 요청 없으면)
  startPreExpiryTask();

  // 3-b. 매일 00:10 KST — 만료된 시리얼 자동 갱신 (renewal_stop_requested = 0)
  startAutoRenewTask();

  // 4. 설정된 시각에 전일 작업 일일 리포트 전송
  startDailyReportTasks();

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
  }, { timezone: 'Asia/Tokyo' });

  // 6. Limbo 보정 — 매일 03:00 JST (stop=1인데 만료 후에도 cancelled가 안 된 경우)
  limboCronTask = cron.schedule('0 3 * * *', async () => {
    logger.info('[Limbo] 보정 시작');
    try {
      const result = await runLimboFallbackNow();
      if (result.processed > 0) {
        logger.info(`[Limbo] 완료: ${result.success}건 성공, ${result.failed}건 실패`);
      } else {
        logger.info('[Limbo] 보정 대상 없음');
      }
    } catch (err: any) {
      logger.error(`[Limbo] 오류: ${err.message}`);
    }
  }, { timezone: 'Asia/Tokyo' });

  // 7. 만료 예고 메일 — UI 설정 기반
  startExpiryNoticeTask();

  // 8. 매일 아침 08:30 일일 요약 Slack 알림
  // cancel 예정 시리얼, 갱신의뢰 접수, 전일 작업 요약
  dailySummaryTask = cron.schedule('30 8 * * *', async () => {
    logger.info('일일 요약 Slack 알림 시작');
    try {
      const settings = getSettings();

      // 오늘 cancel 예정 시리얼 (만료 N일 전)
      const daysBefore = settings.auto_cancel_days_before ?? 1;
      const cancelTargetDate = new Date();
      cancelTargetDate.setDate(cancelTargetDate.getDate() + daysBefore);
      const cancelTargetDateStr = cancelTargetDate.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
      const cancelCandidates = serialService.getExpiringSerialsOnDate(cancelTargetDateStr);
      const cancelTargets = cancelCandidates.map(s => {
        let has_renewal = true;
        try {
          // hasStopRequested=1 → 취소 원함 → 갱신 안 됨 → has_renewal=false
          has_renewal = !serialService.hasStopRequested(s.id);
        } catch (e: any) {
          logger.warn(`[dailySummary] hasStopRequested(${s.id}) 오류: ${e.message}`);
        }
        return {
          serial_number: s.serial_number,
          customer_name: s.customer?.name || '',
          expiry_date: s.expiry_date,
          has_renewal,
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
  }, { timezone: 'Asia/Tokyo' });

  // 7. 전체 스케줄링 요약 로그
  const settings = getSettings();
  const mailTimes = settings.mail_check_times || ['12:00', '17:00'];
  const cancelTime = settings.auto_cancel_time || '09:00';
  const reportTimes = settings.daily_report_times?.length ? settings.daily_report_times : ['10:00'];
  const summary = buildScheduleSummary(mailTimes, cancelTime, reportTimes, settings.expiry_notice_time || '05:00');
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
        persistDailyCancelResults();
        logger.info(`만료 전 자동 cancel 완료: ${results.length}건`);

        // cancel 결과를 개별적으로 Slack으로 전송
        for (const result of results) {
          await notificationService.sendCancelResultSlack(result).catch(() => { });
        }
      }
    } catch (err: any) {
      logger.error(`만료 전 자동 cancel 오류: ${err.message}`);
    }
  }, { timezone: 'Asia/Tokyo' });

  // 실패 건 재시도 스케줄링 (설정된 시각 2시간 후 실행)
  if (retryCancelTask) {
    retryCancelTask.stop();
    retryCancelTask = null;
  }

  const [hStr, mStr] = (settings.auto_cancel_time || '09:00').split(':');
  let h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  if (isNaN(h) || isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    logger.warn(`[Retry] auto_cancel_time 형식 오류 ("${settings.auto_cancel_time}") → 기본값 09:00 사용`);
    h = 9;
  }
  const retryH = (h + 2) % 24; // 2시간 후
  const retryCron = `${m} ${retryH} * * *`;

  retryCancelTask = cron.schedule(retryCron, async () => {
    await retryFailedCancellations();
  }, { timezone: 'Asia/Tokyo' });

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
        if (serial) {
          const updated = serialService.cancelSubscription(serial.id);
          if (updated) await sendCancelCompleteNotice(updated).catch(() => {});
        }
        
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
  persistDailyCancelResults();
}

// Settings 저장 후 호출하여 시각 변경을 즉시 반영
export function restartPreExpiryTask(): void {
  logger.info('만료 전 자동 cancel 스케줄 재시작');
  startPreExpiryTask();
}

// 매일 00:10 KST — 만료 시리얼 자동 갱신 (renewal_stop_requested = 0)
function startAutoRenewTask(): void {
  if (autoRenewTask) {
    autoRenewTask.stop();
    autoRenewTask = null;
  }

  autoRenewTask = cron.schedule('10 0 * * *', async () => {
    logger.info('[AutoRenew] 자동 갱신 시작');
    try {
      const result = await runAutoRenewNow();
      if (result.renewed > 0) {
        logger.info(`[AutoRenew] 완료: ${result.renewed}건 갱신 (${result.serials.join(', ')})`);
      } else {
        logger.info('[AutoRenew] 갱신 대상 없음');
      }
    } catch (err: any) {
      logger.error(`[AutoRenew] 오류: ${err.message}`);
    }
  }, { timezone: 'Asia/Tokyo' });

  logger.info('[AutoRenew] 스케줄 등록 완료: 00:10 KST');
}

export function startMailCheck(): void {
  // 기존 태스크 정지
  for (const task of mailCheckTasks) {
    task.stop();
  }
  mailCheckTasks = [];

  const runMailCheck = async () => {
    logger.info('수신 메일 체크 시작');
    try {
      const result = await checkInboundNow();
      if (result.saved > 0 || result.processed > 0) {
        logger.info(`수신 처리 완료: 저장 ${result.saved}건, 갱신의뢰 ${result.processed}건`);
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
    const task = cron.schedule(cronExpr, runMailCheck, { timezone: 'Asia/Tokyo' });
    mailCheckTasks.push(task);
  }

  logger.info(`메일 체크 스케줄 설정 완료: ${times.join(', ')}`);
}

function normalizeExpiryNoticeRules(settings: ReturnType<typeof getSettings>): ExpiryNoticeRule[] {
  const rawRules = Array.isArray(settings.expiry_notice_rules) ? settings.expiry_notice_rules : [];
  const fallbackTemplate = settings.expiry_notice_renewal_template || 'renewal_reminder';
  const fromRules = rawRules
    .map((rule: any) => ({
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
    logger.info('[ExpiryNotice] 만료 예고 메일 비활성화');
    return;
  }

  const cronExpr = timeToCron(settings.expiry_notice_time || '05:00');
  logger.info(`[ExpiryNotice] 스케줄: ${cronExpr} (time: ${settings.expiry_notice_time || '05:00'})`);

  expiryNoticeTask = cron.schedule(cronExpr, async () => {
    logger.info('[ExpiryNotice] 만료 예고 메일 발송 시작');
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
            logger.info(`[ExpiryNotice] D-${rule.days_before} 메일 발송: ${serial.serial_number} → ${serial.customer.email} (${code})`);
          } else {
            logger.error(`[ExpiryNotice] D-${rule.days_before} 발송 실패: ${serial.serial_number} - ${result.message}`);
          }
        } catch (err: any) {
          logger.error(`[ExpiryNotice] 발송 실패: ${serial.serial_number} - ${err.message}`);
        }
      }
    }
  }, { timezone: 'Asia/Tokyo' });
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
    renewals: logs.filter(l => l.action === 'renewed').length,
    cancellations: logs.filter(l => l.action === 'cancelled').length,
    failed_cancellations: lastSent === targetDateStr ? [] : dailyCancelResults.filter(r => !r.success),
    details: logs,
  };

  await notificationService.sendDailyReport(report);
  setLastReportSentDate(targetDateStr);
  dailyCancelResults = dailyCancelResults.filter(r => !r.success);
  persistDailyCancelResults();
}

export async function sendDailyReportNow(): Promise<void> {
  await sendDailyReportForDate(getTodayDateString());
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
      logger.info(`일일 리포트 생성 시작 (${time}, 어제 데이터 기준)`);
      try {
        await sendDailyReportForDate(getYesterdayDateString());
        logger.info('일일 리포트 전송 완료');
      } catch (err: any) {
        logger.error(`일일 리포트 오류: ${err.message}`);
      }
    }, { timezone: 'Asia/Tokyo' });

    dailyReportTasks.push(task);
  }

  logger.info(`일일 리포트 스케줄 설정 완료: ${times.join(', ')}`);
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
  logger.info('스케줄러 중지');
}
