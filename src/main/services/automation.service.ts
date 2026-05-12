import { cancelService } from './cancel.service';
import { serialService } from './serial.service';
import { notificationService } from './notification.service';
import { sendCancelCompleteNotice } from './mail/lifecycle-notice.service';
import { logger } from '../utils/logger';
import { getTodayDateString } from '../utils/date-utils';
import { getSettings } from '../settings';
import { getDb } from '../database';
import type { CancelResult, SerialWithCustomer } from '../../shared/types';

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function cancelSerials(serials: SerialWithCustomer[]): Promise<CancelResult[]> {
  const results: CancelResult[] = [];

  for (const serial of serials) {
    logger.info(`[automation] cancel target: ${serial.serial_number}`);
    const result = await cancelService.cancelSubscription(serial.serial_number, true);
    if (result.success) {
      const updated = serialService.cancelSubscription(serial.id);
      if (updated) await sendCancelCompleteNotice(updated).catch(() => {});
    }
    results.push(result);
    await sleep(2000);
  }

  return results;
}

export async function runAutoRenewNow(): Promise<{ processed: number; renewed: number; skipped: number; serials: string[] }> {
  const today = getTodayDateString();
  // getAll() 내부에서 syncExpiredStatus()가 먼저 실행되므로 만료된 시리얼의 status가
  // 이미 'expired'로 바뀐 뒤 반환된다. 따라서 'active' 뿐만 아니라 'expired'도 포함해야 한다.
  const candidates = serialService.getAll().filter(serial =>
    (serial.status === 'active' || serial.status === 'expired') &&
    !!serial.expiry_date &&
    serial.expiry_date < today &&
    !serial.renewal_stop_requested
  );

  const renewed: string[] = [];
  for (const serial of candidates) {
    serialService.renewManual(serial.id);
    renewed.push(serial.serial_number);
  }

  logger.info(`[automation] auto renew manual run: ${renewed.length} renewed`);
  return {
    processed: candidates.length,
    renewed: renewed.length,
    skipped: 0,
    serials: renewed,
  };
}

export async function runAutoCancelNow(): Promise<{ processed: number; success: number; failed: number; results: CancelResult[] }> {
  const settings = getSettings();
  const daysBefore = settings.auto_cancel_days_before ?? 1;
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + daysBefore);
  const targetDateStr = targetDate.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });

  const candidates = serialService.getExpiringSerialsOnDate(targetDateStr).filter(serial =>
    serial.status === 'active' && !!serial.renewal_stop_requested
  );

  const results = await cancelSerials(candidates);
  return {
    processed: candidates.length,
    success: results.filter(result => result.success).length,
    failed: results.filter(result => !result.success).length,
    results,
  };
}

export async function runLimboFallbackNow(): Promise<{ processed: number; success: number; failed: number; results: CancelResult[] }> {
  const today = getTodayDateString();

  // 7일 이상 지난 만료 시리얼은 제외 — 오래된 건을 매일 재시도하면 Playwright 폭주 발생
  const limitDate = new Date();
  limitDate.setDate(limitDate.getDate() - 7);
  const limitStr = limitDate.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });

  const candidates = serialService.getExpiringSerials(today).filter(serial =>
    !!serial.expiry_date &&
    serial.expiry_date > limitStr &&   // 7일 이내 만료만
    serial.expiry_date <= today &&
    (serial.status === 'active' || serial.status === 'expired') &&
    !!serial.renewal_stop_requested
  );

  const results: CancelResult[] = [];
  const triggerDate = getTodayDateString();
  const settings = getSettings();
  const suppressMinutes = settings.alert_suppress_minutes ?? 360;

  for (const serial of candidates) {
    const triggerId = `cron:limbo-fallback:${triggerDate}:${serial.serial_number}`;
    logger.info(`[Limbo] cancel target: ${serial.serial_number}`);
    const result = await cancelService.cancelSubscription(serial.serial_number, true);
    results.push(result);

    if (result.success) {
      const updated = serialService.cancelSubscription(serial.id);
      if (updated) await sendCancelCompleteNotice(updated).catch(() => {});
      await sleep(2000);
      continue;
    }

    serialService.logActivity(
      serial.id,
      'system',
      'auto',
      {},
      `Limbo cancel 실패: ${result.error || 'unknown error'}`,
      triggerId,
      'warn'
    );
    await notificationService.sendCancelResultSlack(result).catch(() => {});

    serialService.forceExpired(
      serial.id,
      `Limbo fallback forced expired after Playwright cancel failure: ${result.error || 'unknown error'}`,
      triggerId
    );

    const suppressKey = `alert_suppress:${serial.serial_number}:status_forced_expired`;
    const db = getDb();
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(suppressKey) as { value: string } | undefined;
    const lastSentMs = row ? Number(row.value) : 0;
    const nowMs = Date.now();
    if (!lastSentMs || nowMs - lastSentMs >= suppressMinutes * 60_000) {
      await notificationService.sendCriticalAutomationAlert({
        serial_number: serial.serial_number,
        customer_name: serial.customer?.name,
        action: 'status_forced_expired',
        error: result.error,
        details: 'Stop-requested serial could not be cancelled through Playwright and was forced to expired in the local DB.',
        trigger_id: triggerId,
      }).catch((err: any) => logger.error(`[Limbo] critical alert failed: ${err.message}`));
      db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(suppressKey, String(nowMs));
    } else {
      logger.info(`[Limbo] critical alert suppressed: ${serial.serial_number}`);
    }

    await sleep(2000);
  }
  return {
    processed: candidates.length,
    success: results.filter(result => result.success).length,
    failed: results.filter(result => !result.success).length,
    results,
  };
}
