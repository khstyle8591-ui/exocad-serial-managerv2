import { cancelService } from './cancel.service';
import { serialService } from './serial.service';
import { notificationService, localizeCancelError } from './notification.service';
import { sendCancelCompleteNotice, sendManualRenewalConfirmNotice } from './mail/lifecycle-notice.service';
import { logAutoRenewalOrderNotice } from './auto-renewal-order-notice-log.service';
import { pickLang } from './activity-log.service';
import { markPortalRequestPlaywrightFailed } from '../../server/portal/db';
import { logger } from '../utils/logger';
import { getTodayDateString } from '../utils/date-utils';
import { getSettings } from '../settings';
import { getDb } from '../database';
import type { CancelResult, SerialWithCustomer } from '../../shared/types';
import { SERVER_ERRORS } from '../../shared/server-errors';

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
      const details = pickLang({
        ko: `Failsafe — 미처리 중단요청 후보 자동확정(D-1/D0): 만료=${serial.expiry_date}, 인바운드메일ID=${serial.inbound_mail_id}`,
        en: `Failsafe auto-confirmed unprocessed stop-request candidate at D-1/D0 (expiry=${serial.expiry_date}, inbound_mail_id=${serial.inbound_mail_id})`,
        ja: `Failsafe — 未処理の停止依頼候補を自動確定(D-1/D0): 失効=${serial.expiry_date}, インバウンドメールID=${serial.inbound_mail_id}`,
      });

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
          serial.id, 'cancelled', 'auto', {},
          pickLang({
            ko: `Failsafe 취소 성공: ${serial.serial_number} (만료=${serial.expiry_date})`,
            en: `Failsafe cancellation succeeded: ${serial.serial_number} (expiry=${serial.expiry_date})`,
            ja: `Failsafeキャンセル成功: ${serial.serial_number} (失効=${serial.expiry_date})`,
          }),
          triggerId, 'warn',
        );
      } else if (result.success && !result.verified) {
        serialService.logActivity(
          serial.id, 'system', 'auto', {},
          pickLang({
            ko: `Failsafe 취소 미검증(수동 확인 필요): ${serial.serial_number} (상태=${result.verified_status || 'unknown'})`,
            en: `Failsafe cancellation UNVERIFIED (manual check required): ${serial.serial_number} (status=${result.verified_status || 'unknown'})`,
            ja: `Failsafeキャンセル未確認(手動確認が必要): ${serial.serial_number} (状態=${result.verified_status || 'unknown'})`,
          }),
          triggerId, 'error',
        );
      } else {
        const reasonByLang = (lang: 'ko' | 'en' | 'ja') => result.error
          ? localizeCancelError(result.error, lang)
          : ({ ko: '알 수 없는 오류', en: 'unknown error', ja: '不明なエラー' })[lang];
        serialService.logActivity(
          serial.id, 'system', 'auto', {},
          pickLang({
            ko: `Failsafe 취소 실패: ${serial.serial_number} - ${reasonByLang('ko')}`,
            en: `Failsafe cancellation failed: ${serial.serial_number} - ${reasonByLang('en')}`,
            ja: `Failsafeキャンセル失敗: ${serial.serial_number} - ${reasonByLang('ja')}`,
          }),
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
      const reqId = serial.portal_request_id;
      const details = pickLang({
        ko: `포털 갱신중단 신청(#${reqId}) 만료근접 자동처리 시작(D-1/D0) — 시리얼: ${serial.serial_number}, 만료=${serial.expiry_date}`,
        en: `Portal renewal-stop request (#${reqId}) auto-processing started near expiry (D-1/D0) — serial: ${serial.serial_number}, expiry=${serial.expiry_date}`,
        ja: `ポータル更新停止申請(#${reqId})の失効間際自動処理開始(D-1/D0) — シリアル: ${serial.serial_number}, 失効=${serial.expiry_date}`,
      });

      logger.warn(
        `[Failsafe/Portal] auto-confirming portal stop-request: ${serial.serial_number} ` +
        `(expiry ${serial.expiry_date}, portal_request_id=${reqId})`,
      );
      // 신청 접수 + 처리 시작을 활동 로그에 기록 (limbo와 동일하게 디테일 표시)
      serialService.setStopRequested(serial.id, true, triggerId, 'auto', details);

      const result = await cancelService.cancelSubscription(serial.serial_number, true);
      results.push(result);

      if (result.success && result.verified) {
        const updated = serialService.cancelSubscription(serial.id);
        if (updated) await sendCancelCompleteNotice(updated).catch(() => {});
        getDb()
          .prepare("UPDATE portal_requests SET status = 'auto_done', processed_at = datetime('now','localtime') WHERE id = ?")
          .run(reqId);
        serialService.logActivity(
          serial.id, 'cancelled', 'auto', {},
          pickLang({
            ko: `포털 갱신중단 자동취소 성공 — 시리얼: ${serial.serial_number} (신청 #${reqId})`,
            en: `Portal renewal-stop auto-cancel succeeded — serial: ${serial.serial_number} (request #${reqId})`,
            ja: `ポータル更新停止自動キャンセル成功 — シリアル: ${serial.serial_number} (申請 #${reqId})`,
          }),
          triggerId, 'warn',
        );
      } else {
        // 실패 또는 미검증 → 신청을 실패로 표시(매니저 '취소 실패' + 재승인 가능) + Slack 알림
        markPortalRequestPlaywrightFailed(reqId);
        // reason은 언어별로 따로 계산한다 — result.error는 Playwright가 던진 한국어 원문이라,
        // 단순히 pickLang()으로 감싸기만 하면 en/ja 문장 안에 한국어가 그대로 섞여 나온다.
        const reasonByLang = (lang: 'ko' | 'en' | 'ja') => result.success
          ? ({ ko: '취소 결과 미검증', en: 'cancel result unverified', ja: 'キャンセル結果未確認' })[lang]
          : (result.error
            ? localizeCancelError(result.error, lang)
            : ({ ko: '알 수 없는 오류', en: 'unknown error', ja: '不明なエラー' })[lang]);
        serialService.logActivity(
          serial.id, 'system', 'auto', {},
          pickLang({
            ko: `포털 갱신중단 자동취소 실패 — 시리얼: ${serial.serial_number} (신청 #${reqId}), 사유: ${reasonByLang('ko')}`,
            en: `Portal renewal-stop auto-cancel FAILED — serial: ${serial.serial_number} (request #${reqId}), reason: ${reasonByLang('en')}`,
            ja: `ポータル更新停止自動キャンセル失敗 — シリアル: ${serial.serial_number} (申請 #${reqId}), 理由: ${reasonByLang('ja')}`,
          }),
          triggerId, 'error',
        );
        await notificationService.sendCriticalAutomationAlert({
          serial_number: serial.serial_number,
          customer_name: serial.customer?.name,
          action: { ko: '포털 갱신중단 만료근접 자동취소', en: 'Portal renewal-stop near-expiry auto-cancel', ja: 'ポータル更新停止 失効間際自動キャンセル' },
          error: result.error,
          details: {
            ko: `포털 신청(#${reqId})의 만료근접 자동취소가 실패했습니다. 시리얼 번호를 확인하고 필요 시 수동으로 재처리해주세요.`,
            en: `Portal request (#${reqId}) near-expiry auto-cancel failed. Verify the serial number and reprocess manually if needed.`,
            ja: `ポータル申請(#${reqId})の失効間際自動キャンセルが失敗しました。シリアル番号を確認し、必要に応じて手動で再処理してください。`,
          },
          trigger_id: triggerId,
        }).catch(() => {});
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

    // 내부 발주메일과 별개로, 고객에게도 갱신 완료를 안내 (수동 갱신 시 쓰는 기존 템플릿 재사용)
    await sendManualRenewalConfirmNotice(updated, serial.expiry_date).catch((err: unknown) => {
      logger.error(`[automation] auto renewal customer notice error: ${serial.serial_number} - ${getErrorMessage(err)}`);
    });
  }

  logger.info(`[automation] auto renew run: ${renewed.length} renewed`);
  return {
    processed: candidates.length,
    renewed: renewed.length,
    skipped: 0,
    serials: renewed,
  };
}

/** 매니저 UI의 "발주서 발송?" 팝업에서 승인을 눌렀을 때 호출 — 수동 갱신에 대한 발주서를 발송. */
export async function sendManualRenewalPo(
  serialId: number,
  previousExpiryDate: string | null,
): Promise<{ success: boolean; message: string }> {
  const serial = serialService.getById(serialId);
  if (!serial) return { success: false, message: SERVER_ERRORS.SERIAL_NOT_FOUND };

  const notice = await notificationService.sendAutoRenewalOrderNotice({
    serial,
    previous_expiry_date: previousExpiryDate,
    source: 'manual',
  }).catch((err: unknown) => {
    const message = getErrorMessage(err);
    logger.error(`[automation] manual renewal order notice error: ${serial.serial_number} - ${message}`);
    return {
      success: false,
      subject: `[Exocad Manager] 更新注文書 (手動) - ${serial.serial_number}`,
      html_body: '',
      recipient_email: '',
      message,
    };
  });

  logAutoRenewalOrderNotice({
    serial,
    previous_expiry_date: previousExpiryDate,
    recipient_email: notice.recipient_email,
    subject: notice.subject,
    html_body: notice.html_body,
    status: notice.success ? 'sent' : 'failed',
    message: notice.message,
  });

  return { success: notice.success, message: notice.message };
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
      // result.error는 Playwright가 던진 한국어 원문이므로 언어별로 따로 변환해야
      // en/ja 문장 안에 한국어가 그대로 섞여 나오는 것을 막을 수 있다.
      const limboReasonByLang = (lang: 'ko' | 'en' | 'ja') => result.success
        ? ({
            ko: `취소 미검증 (상태=${result.verified_status || 'unknown'})`,
            en: `cancel UNVERIFIED (status=${result.verified_status || 'unknown'})`,
            ja: `キャンセル未確認 (状態=${result.verified_status || 'unknown'})`,
          })[lang]
        : `${({ ko: '취소 실패', en: 'cancel failed', ja: 'キャンセル失敗' })[lang]}: ${
            result.error ? localizeCancelError(result.error, lang) : ({ ko: '알 수 없는 오류', en: 'unknown error', ja: '不明なエラー' })[lang]
          }`;
      serialService.logActivity(
        serial.id,
        'system',
        'auto',
        {},
        pickLang({
          ko: `Limbo 보정 — ${limboReasonByLang('ko')}`,
          en: `Limbo ${limboReasonByLang('en')}`,
          ja: `Limbo補正 — ${limboReasonByLang('ja')}`,
        }),
        triggerId,
        'warn'
      );
      await notificationService.sendCancelResultSlack(result).catch(() => {});

      serialService.forceExpired(
        serial.id,
        pickLang({
          ko: `Limbo 보정 — Playwright 취소 실패 후 로컬 DB에서 강제 만료 처리: ${result.error || '알 수 없는 오류'}`,
          en: `Limbo fallback forced expired after Playwright cancel failure: ${result.error || 'unknown error'}`,
          ja: `Limbo補正 — Playwrightキャンセル失敗後にローカルDBで強制失効処理: ${result.error || 'unknown error'}`,
        }),
        triggerId
      );

      // Limbo 재시도 자체가 실패하면 더 이상 재시도하지 않는다 — 최초 실패 시점과 Limbo 실패
      // 시점에 이미 관리자에게 critical 알림이 발송되었으므로, renewal_stop_requested를 해제해
      // 다음 날 Limbo 후보에서 제외시킨다(중복 재시도/중복 알림 방지).
      serialService.setStopRequested(
        serial.id,
        false,
        triggerId,
        'auto',
        pickLang({
          ko: 'Limbo 재시도 실패 — 재시도 중단(이미 관리자 알림 발송됨)',
          en: 'Limbo retry failed — retries stopped (manager already alerted)',
          ja: 'Limboリトライ失敗 — リトライ停止(管理者へ通知済み)',
        }),
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
          details: {
            ko: '중단요청된 시리얼을 Playwright로 취소하지 못해 로컬 DB에서 강제 만료 처리했습니다.',
            en: 'Stop-requested serial could not be cancelled through Playwright and was forced to expired in the local DB.',
            ja: '停止依頼されたシリアルをPlaywrightでキャンセルできず、ローカルDBで強制失効処理しました。',
          },
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
