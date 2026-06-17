import { cancelService } from './cancel.service';
import { serialService } from './serial.service';
import { notificationService } from './notification.service';
import { sendCancelCompleteNotice } from './mail/lifecycle-notice.service';
import { logAutoRenewalOrderNotice } from './auto-renewal-order-notice-log.service';
import { logger } from '../utils/logger';
import { getTodayDateString } from '../utils/date-utils';
import { getSettings } from '../settings';
import { getDb } from '../database';
import type { CancelResult, SerialWithCustomer } from '../../shared/types';

const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 서로 다른 크론(failsafe/limbo/scheduled)이 같은 시리얼을 동시에 중복 처리하지 않도록 방지
const inProgressSerialIds = new Set<number>();

async function cancelSerials(serials: SerialWithCustomer[]): Promise<CancelResult[]> {
  const results: CancelResult[] = [];

  for (const serial of serials) {
    if (inProgressSerialIds.has(serial.id)) {
      logger.warn(`[automation] skip duplicate in-progress cancel: ${serial.serial_number}`);
      continue;
    }
    inProgressSerialIds.add(serial.id);
    try {
      logger.info(`[automation] cancel target: ${serial.serial_number}`);
      const result = await cancelService.cancelSubscription(serial.serial_number, true);
      if (result.success && result.verified) {
        const updated = serialService.cancelSubscription(serial.id);
        if (updated) await sendCancelCompleteNotice(updated).catch(() => {});
      } else if (result.success && !result.verified) {
        logger.warn(`[automation] cancel completed but UNVERIFIED; DB not changed: ${serial.serial_number} (status: ${result.verified_status || 'unknown'})`);
      }
      results.push(result);
      await sleep(2000);
    } finally {
      inProgressSerialIds.delete(serial.id);
    }
  }

  return results;
}

interface CandidateFailsafeTarget extends SerialWithCustomer {
  inbound_mail_id: number;
}

function getCandidateFailsafeTargets(): CandidateFailsafeTarget[] {
  const today = getTodayDateString();
  const tomorrowDate = new Date();
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrow = tomorrowDate.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });

  const rows = getDb().prepare(`
    SELECT s.id, MIN(m.id) AS inbound_mail_id
    FROM inbound_mails m
    JOIN serials s
      ON s.id = m.linked_serial_id
      OR (m.linked_serial_id IS NULL AND LOWER(s.serial_number) = LOWER(m.extracted_serial))
    WHERE m.classification = 'stop_request_candidate'
      AND m.processed = 0
      AND s.status IN ('active', 'expired')
      AND s.expiry_date IN (?, ?)
    GROUP BY s.id
  `).all(today, tomorrow) as Array<{ id: number; inbound_mail_id: number }>;

  return rows
    .map(row => {
      const serial = serialService.getById(row.id);
      return serial ? { ...serial, inbound_mail_id: row.inbound_mail_id } : null;
    })
    .filter((serial): serial is CandidateFailsafeTarget => serial !== null);
}

// ── 포털 발 failsafe 대상 ─────────────────────────────────────────────────────
// 포털에서 갱신 중단 신청 후 관리자가 만료 윈도우 내 미처리한 건을 자동 확정한다.

interface PortalFailsafeTarget extends SerialWithCustomer {
  portal_request_id: number;
}

function getPortalFailsafeTargets(): PortalFailsafeTarget[] {
  const today = getTodayDateString();
  const tomorrowDate = new Date();
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrow = tomorrowDate.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });

  const rows = getDb()
    .prepare(
      `SELECT s.id AS serial_id, MIN(pr.id) AS portal_request_id
       FROM portal_requests pr
       JOIN serials s ON LOWER(s.serial_number) = LOWER(pr.target_serial)
       WHERE pr.type = 'renewal_stop'
         AND pr.status = 'pending'
         AND s.status IN ('active', 'expired')
         AND s.expiry_date IN (?, ?)
         AND s.renewal_stop_requested = 0
       GROUP BY s.id`,
    )
    .all(today, tomorrow) as Array<{ serial_id: number; portal_request_id: number }>;

  return rows
    .map(row => {
      const serial = serialService.getById(row.serial_id);
      return serial ? { ...serial, portal_request_id: row.portal_request_id } : null;
    })
    .filter((s): s is PortalFailsafeTarget => s !== null);
}

export async function runCandidateFailsafeCancelNow(): Promise<{ processed: number; success: number; failed: number; results: CancelResult[] }> {
  const candidates = getCandidateFailsafeTargets();
  const portalTargets = getPortalFailsafeTargets();
  const results: CancelResult[] = [];

  // ── 인바운드 메일 발 failsafe ─────────────────────────────────────────────
  for (const serial of candidates) {
    if (inProgressSerialIds.has(serial.id)) {
      logger.warn(`[Failsafe] skip duplicate in-progress cancel: ${serial.serial_number}`);
      continue;
    }
    inProgressSerialIds.add(serial.id);
    try {
      const triggerId = `failsafe:inbound-mail:${serial.inbound_mail_id}:${serial.serial_number}`;
      const details =
        `Failsafe auto-confirmed unprocessed stop-request candidate at D-1/D0 ` +
        `(expiry=${serial.expiry_date}, inbound_mail_id=${serial.inbound_mail_id})`;

      logger.warn(`[Failsafe] auto-confirming and cancelling candidate: ${serial.serial_number} (expiry ${serial.expiry_date})`);
      serialService.setStopRequested(serial.id, true, triggerId, 'auto', details);
      getDb().prepare(`
        UPDATE inbound_mails
        SET processed = 1, linked_serial_id = ?
        WHERE classification = 'stop_request_candidate'
          AND processed = 0
          AND (linked_serial_id = ? OR (linked_serial_id IS NULL AND LOWER(extracted_serial) = LOWER(?)))
      `).run(serial.id, serial.id, serial.serial_number);

      const result = await cancelService.cancelSubscription(serial.serial_number, true);
      results.push(result);

      if (result.success && result.verified) {
        const updated = serialService.cancelSubscription(serial.id);
        if (updated) await sendCancelCompleteNotice(updated).catch(() => {});
        serialService.logActivity(
          serial.id, 'system', 'auto', {},
          `Failsafe cancellation succeeded: ${serial.serial_number} (expiry=${serial.expiry_date})`,
          triggerId, 'warn',
        );
      } else if (result.success && !result.verified) {
        serialService.logActivity(
          serial.id, 'system', 'auto', {},
          `Failsafe cancellation UNVERIFIED (manual check required): ${serial.serial_number} (status=${result.verified_status || 'unknown'})`,
          triggerId, 'error',
        );
      } else {
        serialService.logActivity(
          serial.id, 'system', 'auto', {},
          `Failsafe cancellation failed: ${serial.serial_number} - ${result.error || 'unknown error'}`,
          triggerId, 'error',
        );
      }

      await sleep(2000);
    } finally {
      inProgressSerialIds.delete(serial.id);
    }
  }

  // ── 포털 발 failsafe — 관리자 미처리 갱신 중단 신청 ─────────────────────────
  for (const serial of portalTargets) {
    if (inProgressSerialIds.has(serial.id)) {
      logger.warn(`[Failsafe/Portal] skip duplicate in-progress cancel: ${serial.serial_number}`);
      continue;
    }
    inProgressSerialIds.add(serial.id);
    try {
      const triggerId = `failsafe:portal-req:${serial.portal_request_id}:${serial.serial_number}`;
      const details =
        `Failsafe auto-confirmed unprocessed portal renewal-stop request at D-1/D0 ` +
        `(expiry=${serial.expiry_date}, portal_request_id=${serial.portal_request_id})`;

      logger.warn(
        `[Failsafe/Portal] auto-confirming portal stop-request: ${serial.serial_number} ` +
        `(expiry ${serial.expiry_date}, portal_request_id=${serial.portal_request_id})`,
      );
      serialService.setStopRequested(serial.id, true, triggerId, 'auto', details);

      getDb()
        .prepare(
          "UPDATE portal_requests SET status = 'auto_done', processed_at = datetime('now','localtime') WHERE id = ?",
        )
        .run(serial.portal_request_id);

      const result = await cancelService.cancelSubscription(serial.serial_number, true);
      results.push(result);

      if (result.success && result.verified) {
        const updated = serialService.cancelSubscription(serial.id);
        if (updated) await sendCancelCompleteNotice(updated).catch(() => {});
        serialService.logActivity(
          serial.id, 'system', 'auto', {},
          `Failsafe/Portal cancellation succeeded: ${serial.serial_number} (expiry=${serial.expiry_date})`,
          triggerId, 'warn',
        );
      } else if (result.success && !result.verified) {
        serialService.logActivity(
          serial.id, 'system', 'auto', {},
          `Failsafe/Portal cancellation UNVERIFIED (manual check required): ${serial.serial_number} (status=${result.verified_status || 'unknown'})`,
          triggerId, 'error',
        );
      } else {
        serialService.logActivity(
          serial.id, 'system', 'auto', {},
          `Failsafe/Portal cancellation failed: ${serial.serial_number} - ${result.error || 'unknown error'}`,
          triggerId, 'error',
        );
      }

      await sleep(2000);
    } finally {
      inProgressSerialIds.delete(serial.id);
    }
  }

  return {
    processed: candidates.length + portalTargets.length,
    success: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
    results,
  };
}

export async function runAutoRenewNow(): Promise<{ processed: number; renewed: number; skipped: number; serials: string[] }> {
  const today = getTodayDateString();
  const candidates = serialService.getAutoRenewCandidates(today);

  const renewed: string[] = [];
  for (const serial of candidates) {
    const updated = serialService.renewSerial(serial.id, 'auto');
    if (!updated) continue;

    renewed.push(updated.serial_number);
    const notice = await notificationService.sendAutoRenewalOrderNotice({
      serial: updated,
      previous_expiry_date: serial.expiry_date,
    }).catch((err: unknown) => {
      const message = getErrorMessage(err);
      logger.error(`[automation] auto renewal order notice error: ${serial.serial_number} - ${message}`);
      return {
        success: false,
        subject: `[Exocad Manager] 자동 갱신 주문서 - ${updated.serial_number}`,
        html_body: '',
        recipient_email: '',
        message,
      };
    });

    logAutoRenewalOrderNotice({
      serial: updated,
      previous_expiry_date: serial.expiry_date,
      recipient_email: notice.recipient_email,
      subject: notice.subject,
      html_body: notice.html_body,
      status: notice.success ? 'sent' : 'failed',
      message: notice.message,
    });

    if (notice.success) {
      logger.info(`[automation] auto renewal order notice sent: ${updated.serial_number}`);
    } else {
      logger.warn(`[automation] auto renewal order notice failed: ${updated.serial_number}`);
    }
  }

  logger.info(`[automation] auto renew run: ${renewed.length} renewed`);
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

  const scheduledResults = await cancelSerials(candidates);
  const failsafe = await runCandidateFailsafeCancelNow();
  const results = [...scheduledResults, ...failsafe.results];
  return {
    processed: candidates.length + failsafe.processed,
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
    if (inProgressSerialIds.has(serial.id)) {
      logger.warn(`[Limbo] skip duplicate in-progress cancel: ${serial.serial_number}`);
      continue;
    }
    inProgressSerialIds.add(serial.id);
    try {
      const triggerId = `cron:limbo-fallback:${triggerDate}:${serial.serial_number}`;
      logger.info(`[Limbo] cancel target: ${serial.serial_number}`);
      const result = await cancelService.cancelSubscription(serial.serial_number, true);
      results.push(result);

      if (result.success && result.verified) {
        const updated = serialService.cancelSubscription(serial.id);
        if (updated) await sendCancelCompleteNotice(updated).catch(() => {});
        await sleep(2000);
        continue;
      }

      // 실패했거나(success=false), 완료됐지만 검증되지 않은(success && !verified) 경우 모두
      // 아래 fallback(로컬 강제 만료 + critical 알림)으로 처리하여 사람이 확인하도록 한다.
      const limboReason = result.success
        ? `cancel UNVERIFIED (status=${result.verified_status || 'unknown'})`
        : `cancel failed: ${result.error || 'unknown error'}`;
      serialService.logActivity(
        serial.id,
        'system',
        'auto',
        {},
        `Limbo ${limboReason}`,
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
        }).catch((err: unknown) => logger.error(`[Limbo] critical alert failed: ${getErrorMessage(err)}`));
        db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(suppressKey, String(nowMs));
      } else {
        logger.info(`[Limbo] critical alert suppressed: ${serial.serial_number}`);
      }

      await sleep(2000);
    } finally {
      inProgressSerialIds.delete(serial.id);
    }
  }
  return {
    processed: candidates.length,
    success: results.filter(result => result.success).length,
    failed: results.filter(result => !result.success).length,
    results,
  };
}
