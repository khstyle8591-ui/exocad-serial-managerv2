import Pop3Command from 'node-pop3';
import Imap from 'imap';
import net from 'net';
import tls from 'tls';
import { simpleParser } from 'mailparser';
import { getSettings } from '../../settings';
import { getDb } from '../../database';
import { serialService } from '../serial.service';
import { notificationService } from '../notification.service';
import { sendStopRequestReceivedNotice } from './lifecycle-notice.service';
import { sendTemplate } from './smtp.service';
import { logger } from '../../utils/logger';
import { getNowTimestampString, getTimestampDaysAgo } from '../../utils/date-utils';
import type { AppSettings, MailConnectionResult, InboundMail } from '../../../shared/types';
import type { AddressObject, HeaderValue } from 'mailparser';

// ── Serial number lookup cache (TTL 60s, avoids repeated DB scans per email) ──
let serialCacheResult: { serial_number: string }[] | null = null;
let serialCacheExpiry = 0;
function getCachedSerials(): { serial_number: string }[] {
  if (!serialCacheResult || Date.now() > serialCacheExpiry) {
    serialCacheResult = serialService.listSerialNumbers();
    serialCacheExpiry = Date.now() + 60_000;
  }
  return serialCacheResult;
}

// ── Internal types ────────────────────────────────────────────────────────────

export interface ParsedEmail {
  messageId: string | null;
  from: string;
  replyTo: string;
  to: string;
  cc: string;
  subject: string;
  body: string;
  date: string;
  deliveredTo: string;
  xForwardedTo: string;
  xOriginalTo: string;
  xForwardedFor: string;
  resent_to: string;
  xForwardedFrom: string;
  rawHeaders: string;
}

type Classification = 'renewal_request' | 'stop_request_candidate' | 'stop_request' | 'missing_info' | 'invalid_cancellation_response' | 'unrelated' | 'unclassified' | 'error';
type SettingsOverride = Partial<AppSettings>;
type EffectiveSettings = ReturnType<typeof getSettings>;
type Pop3Client = InstanceType<typeof Pop3Command>;

const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

export interface AnalysisResult {
  classification: Classification;
  extractedSerial: string | null;
  matchedKeywords: string[];
  missingFields: string[];
  isDedicated: boolean;
  evidence: string[];
  structuredResponse?: StructuredCancellationResponse;
  responseErrors?: string[];
  requiresAdminReview?: boolean;
}

export interface StructuredCancellationResponse {
  serialNumber: string;
  confirmation: string;
  customerName: string;
}

export interface InboundDryRunEntry {
  from: string;
  subject: string;
  date: string;
  classification: Classification;
  matched_keywords: string[];
  extracted_serial: string | null;
  serial_exists: boolean;
  is_duplicate: boolean;
  message_id: string | null;
  missing_fields: string[];
}

export interface InboundDryRunResult {
  total_checked: number;
  would_save: number;
  would_skip: number;
  entries: InboundDryRunEntry[];
  error?: string;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function checkInboundNow(): Promise<{ processed: number; saved: number; errors: string[] }> {
  const settings = getSettings();
  return settings.mail_protocol === 'imap'
    ? checkWithImap()
    : checkWithPop3();
}

export async function inboundDryRun(): Promise<InboundDryRunResult> {
  const settings = getSettings();
  try {
    return settings.mail_protocol === 'imap'
      ? dryRunWithImap()
      : dryRunWithPop3();
  } catch (err: unknown) {
    return { total_checked: 0, would_save: 0, would_skip: 0, entries: [], error: getErrorMessage(err) };
  }
}

export async function testMailConnection(
  settingsOverride?: SettingsOverride,
): Promise<MailConnectionResult> {
  const cleanOverride = Object.fromEntries(
    Object.entries(settingsOverride || {}).filter(([, value]) =>
      value !== undefined && value !== null && value !== '' && value !== '***'
    )
  ) as SettingsOverride;
  const settings: EffectiveSettings = { ...getSettings(), ...cleanOverride };
  const protocol = settings.mail_protocol === 'imap' ? 'IMAP' : 'POP3';
  const host = settings.mail_protocol === 'imap' ? settings.imap_host : settings.pop3_host;
  const port = settings.mail_protocol === 'imap' ? settings.imap_port : settings.pop3_port;
  const user = settings.mail_protocol === 'imap' ? settings.imap_user : settings.pop3_user;
  const password = settings.mail_protocol === 'imap' ? settings.imap_password : settings.pop3_password;
  if (!host || !port || !user || !password) {
    const missing = [
      !host ? 'host' : '',
      !port ? 'port' : '',
      !user ? 'username' : '',
      !password ? 'password' : '',
    ].filter(Boolean).join(', ');
    return { success: false, message: `${protocol} 필수 설정 누락: ${missing}` };
  }
  try {
    return settings.mail_protocol === 'imap'
      ? testImapConnection(settings)
      : testPop3Connection(settings);
  } catch (err: unknown) {
    return { success: false, message: `${protocol} 연결 오류 (${host}:${port}): ${getErrorMessage(err)}` };
  }
}

export function listInboundMails(filter?: {
  classification?: string[];
  limit?: number;
  offset?: number;
}): InboundMail[] {
  const db = getDb();
  const limit = filter?.limit ?? 100;
  const offset = filter?.offset ?? 0;

  if (filter?.classification && filter.classification.length > 0) {
    const placeholders = filter.classification.map(() => '?').join(',');
    return db.prepare(
      `SELECT * FROM inbound_mails WHERE classification IN (${placeholders})
       ORDER BY received_at DESC LIMIT ? OFFSET ?`,
    ).all(...filter.classification, limit, offset) as InboundMail[];
  }

  return db.prepare(
    'SELECT * FROM inbound_mails ORDER BY received_at DESC LIMIT ? OFFSET ?',
  ).all(limit, offset) as InboundMail[];
}

export async function confirmStopRequestFromMail(id: number): Promise<{ success: boolean; error?: string; serial_number?: string }> {
  const db = getDb();
  const mail = db.prepare('SELECT * FROM inbound_mails WHERE id = ?').get(id) as InboundMail | undefined;
  if (!mail) return { success: false, error: '메일을 찾을 수 없습니다.' };

  const serial = mail.linked_serial_id
    ? serialService.getById(mail.linked_serial_id)
    : mail.extracted_serial
      ? serialService.getBySerialNumber(mail.extracted_serial)
      : undefined;

  if (!serial) return { success: false, error: '메일에서 매칭된 시리얼을 찾을 수 없습니다.' };

  // 알림 발송 여부는 "이번 요청으로 새로 멈춘 것인지"로 판단 — 이미 플래그가 서있거나
  // 이미 취소된 시리얼이면 중복 접수확인 메일을 보내지 않는다. 갱신으로 플래그가 풀리면
  // (renewal_stop_requested=0으로 리셋) 다음 중단요청부터는 다시 자연스럽게 발송된다.
  const alreadyNotified = serial.renewal_stop_requested === 1 || serial.status === 'cancelled';

  const updated = serialService.setStopRequested(serial.id, true, `mail:${id}`);
  if (!updated) return { success: false, error: '시리얼 상태 변경에 실패했습니다.' };

  db.prepare('UPDATE inbound_mails SET processed = 1, linked_serial_id = ?, classification = ? WHERE id = ?')
    .run(serial.id, 'stop_request_candidate', id);
  if (!alreadyNotified) {
    await sendStopRequestReceivedNotice(updated).catch((err: unknown) =>
      logger.error(`[inbound] stop request notice failed: ${getErrorMessage(err)}`),
    );
  }

  return { success: true, serial_number: serial.serial_number };
}

export async function sendMissingInfoTemplateForMail(id: number): Promise<{ success: boolean; message: string }> {
  const db = getDb();
  const mail = db.prepare('SELECT * FROM inbound_mails WHERE id = ?').get(id) as InboundMail | undefined;
  if (!mail) return { success: false, message: '메일을 찾을 수 없습니다.' };

  const to = resolveReplyAddressFromStoredMail(mail);
  if (!to) return { success: false, message: '발신자 이메일 주소를 찾을 수 없습니다.' };

  const result = await sendMissingInfoNotice(mail, to);
  if (result.success) {
    db.prepare(`
      UPDATE inbound_mails
      SET processed = 1, template_sent_at = datetime('now','localtime'), matched_template = ?
      WHERE id = ?
    `).run(getSettings().missing_info_template || 'missing_info_request', id);
  } else {
    db.prepare('UPDATE inbound_mails SET error = ? WHERE id = ?').run(result.message, id);
  }
  return result;
}

// ── Save to inbound_mails ─────────────────────────────────────────────────────

function saveInboundMail(
  email: ParsedEmail,
  classification: Classification,
  opts: {
    matchedKeywords: string[];
    extractedSerial: string | null;
    linkedSerialId: number | null;
    missingFields?: string[];
    matchedTemplate?: string | null;
    templateSentAt?: string | null;
    error?: string;
    responseErrors?: string[];
    responseAttempt?: number;
    responseCustomerName?: string | null;
    adminReview?: boolean;
  },
): number | null {
  const db = getDb();
  const now = getNowTimestampString();
  try {
    if (isDuplicate(email.messageId)) return null;

    const result = db.prepare(`
      INSERT INTO inbound_mails
        (message_id, mail_from, mail_to, subject, body, received_at,
         classification, matched_template, matched_keywords, extracted_serial, linked_serial_id,
         missing_fields, template_sent_at, processed, response_errors, response_attempt,
         response_customer_name, admin_review, admin_review_resolved, error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    `).run(
      email.messageId,
      resolveMailFrom(email),
      email.to,
      email.subject,
      email.body.slice(0, 20000),
      email.date || now,
      classification,
      opts.matchedTemplate ?? null,
      JSON.stringify(opts.matchedKeywords),
      opts.extractedSerial,
      opts.linkedSerialId,
      JSON.stringify(opts.missingFields ?? []),
      opts.templateSentAt ?? null,
      opts.templateSentAt ? 1 : 0,
      JSON.stringify(opts.responseErrors ?? []),
      opts.responseAttempt ?? 0,
      opts.responseCustomerName ?? null,
      opts.adminReview ? 1 : 0,
      opts.error ?? null,
    );
    return result.changes > 0 ? (result.lastInsertRowid as number) : null;
  } catch (err: unknown) {
    logger.error(`[inbound] saveInboundMail failed: ${getErrorMessage(err)}`);
    return null;
  }
}

function isDuplicate(messageId: string | null): boolean {
  if (!messageId) return false;
  const db = getDb();
  const row = db.prepare('SELECT id FROM inbound_mails WHERE message_id=?').get(messageId);
  return !!row;
}

// ── Classify + process a single parsed email ──────────────────────────────────

async function processEmail(
  email: ParsedEmail,
  saveToDb: boolean,
): Promise<{ classification: Classification; saved: boolean; pendingOrderCreated: boolean }> {
  const analysis = analyzeEmail(email);

  if (saveToDb) {
    // Resolve serial
    const linkedSerial = analysis.extractedSerial
      ? serialService.getBySerialNumber(analysis.extractedSerial)
      : null;

    if (analysis.classification === 'stop_request_candidate') {
      const inboundId = saveInboundMail(email, 'stop_request_candidate', {
        matchedKeywords: analysis.matchedKeywords,
        extractedSerial: analysis.extractedSerial,
        linkedSerialId: linkedSerial?.id ?? null,
      });
      logger.info(`[inbound] stop request candidate saved: ${analysis.extractedSerial ?? 'no-serial'} (${analysis.evidence.join(',')})`);
      if (inboundId !== null && analysis.structuredResponse && linkedSerial) {
        // 이미 플래그가 서있거나 이미 취소된 시리얼이면 중복 접수확인 메일을 보내지 않음
        // (갱신으로 플래그가 리셋되면 다음 요청부터 다시 발송됨)
        const alreadyNotified = linkedSerial.renewal_stop_requested === 1 || linkedSerial.status === 'cancelled';
        const updated = serialService.setStopRequested(linkedSerial.id, true, `mail:${inboundId}`);
        if (updated) {
          getDb().prepare('UPDATE inbound_mails SET processed = 1 WHERE id = ?').run(inboundId);
          if (!alreadyNotified) {
            await sendStopRequestReceivedNotice(updated).catch((err: unknown) =>
              logger.error(`[inbound] structured stop request notice failed: ${getErrorMessage(err)}`),
            );
          }
          logger.info(`[inbound] structured cancellation response confirmed automatically: serial=${linkedSerial.serial_number} [mailId=${inboundId}]`);
        }
      }
      return { classification: 'stop_request_candidate', saved: inboundId !== null, pendingOrderCreated: inboundId !== null };

    } else if (analysis.classification === 'invalid_cancellation_response') {
      const sender = resolveMailFrom(email);
      const previous = getDb().prepare(`
        SELECT response_attempt FROM inbound_mails
        WHERE mail_from = ? AND classification = 'invalid_cancellation_response'
          AND admin_review_resolved = 0
        ORDER BY received_at DESC, id DESC LIMIT 1
      `).get(sender) as { response_attempt: number } | undefined;
      const attempt = (previous?.response_attempt || 0) + 1;
      const adminReview = !!analysis.requiresAdminReview || attempt >= 2;
      let templateSentAt: string | null = null;
      let error: string | undefined;
      const settings = getSettings();
      const shouldAutoSend = settings.invalid_response_auto_reply_enabled && !adminReview;
      if (shouldAutoSend && !isDuplicate(email.messageId)) {
        const to = resolveReplyAddress(email);
        if (to) {
          const sendResult = await sendInvalidResponseNotice(email, to, analysis);
          if (sendResult.success) templateSentAt = getNowTimestampString();
          else error = sendResult.message;
        } else {
          error = '발신자 이메일 주소를 찾을 수 없습니다.';
        }
      }
      const inboundId = saveInboundMail(email, 'invalid_cancellation_response', {
        matchedKeywords: [],
        extractedSerial: analysis.extractedSerial,
        linkedSerialId: linkedSerial?.id ?? null,
        matchedTemplate: shouldAutoSend ? settings.invalid_response_template || 'invalid_cancellation_response' : null,
        templateSentAt,
        responseErrors: analysis.responseErrors,
        responseAttempt: attempt,
        responseCustomerName: analysis.structuredResponse?.customerName || null,
        adminReview,
        error,
      });
      if (adminReview && inboundId !== null) {
        logger.warn(`[System Log] Cancellation response requires admin review: from=${sender}, subject=${email.subject}, errors=${(analysis.responseErrors || []).join(', ')} [mailId=${inboundId}]`);
      }
      return { classification: 'invalid_cancellation_response', saved: inboundId !== null, pendingOrderCreated: false };

    } else if (analysis.classification === 'missing_info') {
      let templateSentAt: string | null = null;
      let error: string | undefined;
      const shouldAutoSend = getSettings().missing_info_auto_reply_enabled;
      if (shouldAutoSend && !isDuplicate(email.messageId)) {
        const to = resolveReplyAddress(email);
        if (to) {
          const tempMail = {
            mail_from: resolveMailFrom(email),
            subject: email.subject,
            extracted_serial: analysis.extractedSerial,
            missing_fields: JSON.stringify(analysis.missingFields),
          } as InboundMail;
          const sendResult = await sendMissingInfoNotice(tempMail, to);
          if (sendResult.success) {
            templateSentAt = getNowTimestampString();
          } else {
            error = sendResult.message;
          }
        } else {
          error = '발신자 이메일 주소를 찾을 수 없습니다.';
        }
      }
      const inboundId = saveInboundMail(email, 'missing_info', {
        matchedKeywords: analysis.matchedKeywords,
        extractedSerial: analysis.extractedSerial,
        linkedSerialId: linkedSerial?.id ?? null,
        missingFields: analysis.missingFields,
        matchedTemplate: shouldAutoSend ? getSettings().missing_info_template || 'missing_info_request' : null,
        templateSentAt,
        error,
      });
      logger.info(`[inbound] missing info mail saved: missing=${analysis.missingFields.join(',')}`);
      return { classification: 'missing_info', saved: inboundId !== null, pendingOrderCreated: false };

    } else if (analysis.classification === 'renewal_request') {
      const inboundId = saveInboundMail(email, 'renewal_request', {
        matchedKeywords: analysis.matchedKeywords,
        extractedSerial: analysis.extractedSerial,
        linkedSerialId: linkedSerial?.id ?? null,
      });
      logger.info(`[inbound] renewal request saved for reference: ${analysis.extractedSerial ?? 'no-serial'}`);
      return { classification: 'renewal_request', saved: inboundId !== null, pendingOrderCreated: false };

    } else if (analysis.classification === 'unrelated') {
      const inboundId = saveInboundMail(email, 'unrelated', {
        matchedKeywords: analysis.matchedKeywords,
        extractedSerial: null,
        linkedSerialId: null,
      });
      logger.info(`[inbound] unrelated mail saved: from=${email.from}`);
      notificationService.sendRelatedMailSlack(
        email.from, email.subject, analysis.matchedKeywords, inboundId ?? undefined, email.date,
      );
      return { classification: 'unrelated', saved: inboundId !== null, pendingOrderCreated: false };
    }
  }

  return { classification: analysis.classification, saved: false, pendingOrderCreated: false };
}

// ── POP3 ──────────────────────────────────────────────────────────────────────

async function checkWithPop3(): Promise<{ processed: number; saved: number; errors: string[] }> {
  const settings = getSettings();
  const errors: string[] = [];
  let processed = 0;
  let saved = 0;
  let pop3: Pop3Client | null = null;

  try {
    pop3 = new Pop3Command({
      host: settings.pop3_host, port: settings.pop3_port,
      user: settings.pop3_user, password: settings.pop3_password,
      tls: settings.pop3_tls, timeout: 10000,
      tlsOptions: { rejectUnauthorized: false }, servername: settings.pop3_host,
    });

    const list = await pop3.UIDL();
    if (!Array.isArray(list) || list.length === 0) {
      return { processed: 0, saved: 0, errors: [] };
    }

    const MAX_SCAN = 100;
    const startIdx = Math.max(0, list.length - MAX_SCAN);

    for (let i = list.length - 1; i >= startIdx; i--) {
      try {
        // node-pop3 UIDL()은 [msgNum, uid] 쌍의 배열을 반환.
        // RETR/DELE에는 메시지 번호(msgNum)를 사용해야 함.
        // fallback(i+1)은 메시지가 삭제된 경우 번호 불일치 위험이 있으므로 경고 처리.
        const entry = list[i];
        const msgNum = Array.isArray(entry) ? String(entry[0]) : null;
        if (!msgNum) {
          logger.warn(`[POP3] invalid UIDL entry format (index=${i}); skipping`);
          continue;
        }
        const uid = Array.isArray(entry) ? String(entry[1] ?? entry[0]) : msgNum;

        const rawMessage = await pop3.RETR(msgNum);
        const rawStr = typeof rawMessage === 'string' ? rawMessage : String(rawMessage);
        const email = await parseEmail(rawStr, `pop3-${uid}`);

        if (!isWithin1Day(email.date)) {
          // 오래된 메일은 처리/삭제하지 않고 건너뛴다.
          // (이전의 "오래된 메일 3연속 시 break"는 POP3 도착순 ≠ 날짜순일 때
          //  뒤에 묻힌 최신 메일을 놓칠 수 있어 제거. MAX_SCAN 한도 내에서 끝까지 스캔.)
          continue;
        }

        // 메일이 안전하게 처리(노이즈/중복/저장 성공)된 경우에만 삭제 대상으로 표시한다.
        // 분류 대상인데 저장에 실패한 메일은 삭제하지 않아 데이터 유실을 방지한다.
        let handled = false;
        const analysis = analyzeEmail(email);
        if (analysis.classification === 'unclassified') {
          handled = true; // 분류 불가(노이즈) — 저장 대상 아님
        } else if (isDuplicate(email.messageId)) {
          handled = true; // 이미 저장된 중복 — 재처리 불필요
        } else {
          const result = await processEmail(email, true);
          if (result.saved) saved++;
          if (result.pendingOrderCreated) processed++;
          handled = result.saved; // 저장 성공해야만 삭제
        }

        if (!settings.pop3_keep_copy && handled) {
          try { await pop3.DELE(msgNum); } catch { /* ignore */ }
        }
      } catch (err: unknown) {
        errors.push(`메일 처리 오류: ${getErrorMessage(err)}`);
      }
    }
  } catch (err: unknown) {
    const errorMessage = getErrorMessage(err);
    errors.push(`POP3 연결 오류: ${errorMessage}`);
    logger.error(`[inbound] POP3 error: ${errorMessage}`);
  } finally {
    if (pop3) { try { await pop3.QUIT(); } catch { /* ignore */ } }
  }

  return { processed, saved, errors };
}

async function dryRunWithPop3(): Promise<InboundDryRunResult> {
  const settings = getSettings();
  const entries: InboundDryRunEntry[] = [];
  let totalChecked = 0;
  let pop3: Pop3Client | null = null;

  try {
    pop3 = new Pop3Command({
      host: settings.pop3_host, port: settings.pop3_port,
      user: settings.pop3_user, password: settings.pop3_password,
      tls: settings.pop3_tls, timeout: 10000,
      tlsOptions: { rejectUnauthorized: false }, servername: settings.pop3_host,
    });

    const list = await pop3.UIDL();
    if (!Array.isArray(list) || list.length === 0) {
      return { total_checked: 0, would_save: 0, would_skip: 0, entries: [] };
    }

    const MAX_SCAN = 100;
    const startIdx = Math.max(0, list.length - MAX_SCAN);

    for (let i = list.length - 1; i >= startIdx; i--) {
      totalChecked++;
      try {
        const entry = list[i];
        const msgNum = Array.isArray(entry) ? String(entry[0]) : null;
        if (!msgNum) continue;
        const uid = Array.isArray(entry) ? String(entry[1] ?? entry[0]) : msgNum;

        const rawMessage = await pop3.RETR(msgNum);
        const rawStr = typeof rawMessage === 'string' ? rawMessage : String(rawMessage);
        const email = await parseEmail(rawStr, `pop3-${uid}`);

        if (!isWithin1Day(email.date)) {
          // 오래된 메일은 건너뛴다(조기 break 제거 — 뒤에 묻힌 최신 메일 누락 방지).
          continue;
        }

        const analysis = analyzeEmail(email);
        if (analysis.classification === 'unclassified') continue;

        const dup = isDuplicate(email.messageId);
        const serialExists = analysis.extractedSerial
          ? !!serialService.getBySerialNumber(analysis.extractedSerial)
          : false;

        entries.push({
          from: email.from,
          subject: email.subject,
          date: email.date,
          classification: analysis.classification,
          matched_keywords: analysis.matchedKeywords,
          extracted_serial: analysis.extractedSerial,
          serial_exists: serialExists,
          is_duplicate: dup,
          message_id: email.messageId,
          missing_fields: analysis.missingFields,
        });
      } catch { /* skip */ }
    }
  } finally {
    if (pop3) { try { await pop3.QUIT(); } catch { /* ignore */ } }
  }

  const wouldSave = entries.filter(e => !e.is_duplicate).length;
  return { total_checked: totalChecked, would_save: wouldSave, would_skip: entries.length - wouldSave, entries };
}

// ── IMAP ──────────────────────────────────────────────────────────────────────

function checkWithImap(): Promise<{ processed: number; saved: number; errors: string[] }> {
  return new Promise((resolve) => {
    const settings = getSettings();
    const errors: string[] = [];
    let processed = 0;
    let saved = 0;

    const imap = new Imap({
      user: settings.imap_user, password: settings.imap_password,
      host: settings.imap_host, port: settings.imap_port,
      tls: settings.imap_tls, tlsOptions: { rejectUnauthorized: false },
    });

    const done = () => {
      try { imap.end(); } catch { /* ignore */ }
      resolve({ processed, saved, errors });
    };

    imap.once('error', (err: Error) => {
      errors.push(`IMAP 연결 오류: ${err.message}`);
      logger.error(`[inbound] IMAP error: ${err.message}`);
      done();
    });

    imap.once('ready', () => {
      imap.openBox('INBOX', false, (err) => {
        if (err) { errors.push(`INBOX 열기 오류: ${err.message}`); return done(); }

        const since = new Date(getTimestampDaysAgo(1));
        imap.search(['UNSEEN', ['SINCE', since]], (err, uids) => {
          if (err || !uids || uids.length === 0) return done();

          // markSeen: false — 모든 메시지 처리 완료 후 일괄 seen 마킹.
          // markSeen: true 시 메시지 처리 중 예외가 발생하면 읽음 처리는 됐으나
          // DB 저장이 안 된 상태로 다음 IMAP 체크에서 누락될 위험이 있음.
          const fetch = imap.fetch(uids, { bodies: '', markSeen: false });
          const pending: Promise<void>[] = [];

          fetch.on('message', (msg) => {
            const p = new Promise<void>((resolve) => {
              let rawBuffer = '';
              msg.on('body', (stream) => {
                stream.on('data', (chunk: Buffer) => { rawBuffer += chunk.toString('utf8'); });
              });
              msg.once('end', async () => {
                try {
                  const email = await parseEmail(rawBuffer, null);
                  const analysis = analyzeEmail(email);
                  if (analysis.classification !== 'unclassified') {
                    const result = await processEmail(email, true);
                    if (result.saved) saved++;
                    if (result.pendingOrderCreated) processed++;
                  }
                } catch (e: unknown) {
                  errors.push(`메일 파싱 오류: ${getErrorMessage(e)}`);
                }
                resolve();
              });
            });
            pending.push(p);
          });

          fetch.once('error', (e: Error) => { errors.push(`메일 가져오기 오류: ${e.message}`); });
          fetch.once('end', async () => {
            await Promise.all(pending);
            // 테스트 운영 중에는 IMAP 서버의 unread 상태를 유지할 수 있다.
            // unread 유지 시 같은 메일을 다시 스캔하지만 message_id unique index로 중복 저장은 방지된다.
            if (settings.imap_mark_seen_after_check && uids.length > 0) {
              await new Promise<void>((res) => {
                imap.addFlags(uids, ['\\Seen'], (err) => {
                  if (err) logger.warn(`[inbound] IMAP addFlags failed: ${err.message}`);
                  res();
                });
              });
            }
            done();
          });
        });
      });
    });

    imap.connect();
  });
}

function dryRunWithImap(): Promise<InboundDryRunResult> {
  return new Promise((resolve) => {
    const settings = getSettings();
    const entries: InboundDryRunEntry[] = [];
    let totalChecked = 0;

    const imap = new Imap({
      user: settings.imap_user, password: settings.imap_password,
      host: settings.imap_host, port: settings.imap_port,
      tls: settings.imap_tls, tlsOptions: { rejectUnauthorized: false },
    });

    const done = () => {
      try { imap.end(); } catch { /* ignore */ }
      const wouldSave = entries.filter(e => !e.is_duplicate).length;
      resolve({ total_checked: totalChecked, would_save: wouldSave, would_skip: entries.length - wouldSave, entries });
    };

    imap.once('error', (err: Error) => {
      resolve({ total_checked: 0, would_save: 0, would_skip: 0, entries: [], error: err.message });
    });

    imap.once('ready', () => {
      imap.openBox('INBOX', true, (err) => {
        if (err) return done();

        const since = new Date(getTimestampDaysAgo(1));
        imap.search(['ALL', ['SINCE', since]], (err, uids) => {
          if (err || !uids || uids.length === 0) return done();

          const sliced = uids.slice(-50);
          const fetch = imap.fetch(sliced, { bodies: '', markSeen: false });
          const pending: Promise<void>[] = [];

          fetch.on('message', (msg) => {
            const p = new Promise<void>((resolve) => {
              let rawBuffer = '';
              msg.on('body', (stream) => {
                stream.on('data', (chunk: Buffer) => { rawBuffer += chunk.toString('utf8'); });
              });
              msg.once('end', async () => {
                totalChecked++;
                try {
                  const email = await parseEmail(rawBuffer, null);
                  const analysis = analyzeEmail(email);
                  if (analysis.classification === 'unclassified') { resolve(); return; }

                  const dup = isDuplicate(email.messageId);
                  const serialExists = analysis.extractedSerial
                    ? !!serialService.getBySerialNumber(analysis.extractedSerial)
                    : false;

                  entries.push({
                    from: email.from, subject: email.subject, date: email.date,
                    classification: analysis.classification,
                    matched_keywords: analysis.matchedKeywords,
                    extracted_serial: analysis.extractedSerial,
                    serial_exists: serialExists,
                    is_duplicate: dup,
                    message_id: email.messageId,
                    missing_fields: analysis.missingFields,
                  });
                } catch { /* skip */ }
                resolve();
              });
            });
            pending.push(p);
          });

          fetch.once('error', () => { /* ignore */ });
          fetch.once('end', async () => { await Promise.all(pending); done(); });
        });
      });
    });

    imap.connect();
  });
}

// ── Connection Test ───────────────────────────────────────────────────────────

async function testPop3Connection(settings: EffectiveSettings): Promise<MailConnectionResult> {
  return new Promise((resolve) => {
    const socket = settings.pop3_tls
      ? tls.connect({
          host: settings.pop3_host,
          port: settings.pop3_port,
          servername: settings.pop3_host,
          rejectUnauthorized: false,
        })
      : net.connect({ host: settings.pop3_host, port: settings.pop3_port });
    let buffer = '';
    let step: 'greeting' | 'user' | 'pass' | 'stat' | 'quit' = 'greeting';
    let settled = false;

    const done = (result: MailConnectionResult) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    const fail = (message: string) =>
      done({ success: false, message: `POP3 연결 실패 (${settings.pop3_host}:${settings.pop3_port}): ${message}` });

    socket.setTimeout(10000, () => fail(`${step} 단계 시간 초과`));
    socket.once('error', err => fail(getErrorMessage(err)));
    socket.on('data', chunk => {
      buffer += chunk.toString('utf8');
      let lineEnd = buffer.indexOf('\r\n');
      while (lineEnd >= 0 && !settled) {
        const line = buffer.slice(0, lineEnd);
        buffer = buffer.slice(lineEnd + 2);
        const ok = line.startsWith('+OK');

        if (!ok) {
          const serverMessage = line.replace(/^-ERR\s*/i, '').trim() || 'server rejected request';
          const label = step === 'pass' ? '인증 거부' : `${step} 단계 거부`;
          fail(`${label}: ${serverMessage}`);
          return;
        }

        if (step === 'greeting') {
          step = 'user';
          socket.write(`USER ${settings.pop3_user}\r\n`);
        } else if (step === 'user') {
          step = 'pass';
          socket.write(`PASS ${settings.pop3_password}\r\n`);
        } else if (step === 'pass') {
          step = 'stat';
          socket.write('STAT\r\n');
        } else if (step === 'stat') {
          const match = line.match(/^\+OK\s+(\d+)/i);
          const count = match ? Number(match[1]) : undefined;
          step = 'quit';
          socket.write('QUIT\r\n');
          done({ success: true, message: 'POP3 연결 성공', mail_count: count });
        }
        lineEnd = buffer.indexOf('\r\n');
      }
    });
  });
}

function testImapConnection(settings: EffectiveSettings): Promise<MailConnectionResult> {
  return new Promise((resolve) => {
    const imap = new Imap({
      user: settings.imap_user, password: settings.imap_password,
      host: settings.imap_host, port: settings.imap_port,
      tls: settings.imap_tls, tlsOptions: { rejectUnauthorized: false },
      connTimeout: 10000, authTimeout: 10000,
    });
    let settled = false;
    const done = (r: MailConnectionResult) => {
      if (settled) return;
      settled = true;
      try { imap.end(); } catch { /* ignore */ }
      resolve(r);
    };
    imap.once('error', (err: Error) => done({
      success: false,
      message: `IMAP 연결 실패 (${settings.imap_host}:${settings.imap_port}): ${err.message}`,
    }));
    imap.once('ready', () => {
      imap.openBox('INBOX', true, (err, box) => {
        if (err) {
          done({ success: false, message: `INBOX 열기 실패: ${err.message}` });
        } else {
          done({ success: true, message: `IMAP 연결 성공`, mail_count: box?.messages?.total ?? 0 });
        }
      });
    });
    imap.connect();
  });
}

// ── Email parsing ─────────────────────────────────────────────────────────────

function headerValueToText(value: HeaderValue | undefined): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(item => headerValueToText(item)).filter(Boolean).join(', ');
  if (value instanceof Date) return value.toISOString();
  if ('text' in value && typeof value.text === 'string') return value.text;
  return '';
}

function addressToText(value: AddressObject | AddressObject[] | undefined): string {
  if (!value) return '';
  return Array.isArray(value)
    ? value.map(address => address.text || '').filter(Boolean).join(', ')
    : value.text || '';
}

async function parseEmail(raw: string, fallbackMsgId: string | null): Promise<ParsedEmail> {
  const parsed = await simpleParser(raw);
  const rawHeaders = raw.split(/\r?\n\r?\n/)[0] || '';

  const getHeaderRaw = (name: string): string => {
    const m = rawHeaders.match(new RegExp(`^${name}:\\s*(.+)`, 'im'));
    return m ? m[1].trim() : '';
  };
  const getMailparserHeader = (name: string): string => {
    try {
      if (parsed.headerLines && Array.isArray(parsed.headerLines)) {
        const found = parsed.headerLines.find(h => h.key?.toLowerCase() === name.toLowerCase());
        if (found) {
          const idx = found.line.indexOf(':');
          return idx >= 0 ? found.line.substring(idx + 1).trim() : found.line.trim();
        }
      }
      if (parsed.headers) {
        return headerValueToText(parsed.headers.get(name));
      }
    } catch { /* ignore */ }
    return '';
  };

  const toText = addressToText(parsed.to);
  const ccText = addressToText(parsed.cc);

  return {
    messageId: parsed.messageId || fallbackMsgId,
    from: parsed.from?.text || '',
    replyTo: parsed.replyTo?.text || '',
    to: toText,
    cc: ccText,
    subject: parsed.subject || '',
    body: parsed.text || (typeof parsed.html === 'string' ? parsed.html : '') || '',
    date: parsed.date?.toISOString() || '',
    deliveredTo: getMailparserHeader('delivered-to') || getHeaderRaw('Delivered-To'),
    xForwardedTo: getMailparserHeader('x-forwarded-to') || getHeaderRaw('X-Forwarded-To'),
    xOriginalTo: getMailparserHeader('x-original-to') || getHeaderRaw('X-Original-To'),
    xForwardedFor: getMailparserHeader('x-forwarded-for') || getHeaderRaw('X-Forwarded-For'),
    resent_to: getMailparserHeader('resent-to') || getHeaderRaw('Resent-To'),
    xForwardedFrom: getMailparserHeader('x-forwarded-from') || getHeaderRaw('X-Forwarded-From'),
    rawHeaders,
  };
}

// ── Email analysis ────────────────────────────────────────────────────────────

export function analyzeEmail(email: ParsedEmail): AnalysisResult {
  const settings = getSettings();
  const dedicated = isDedicatedEmailTarget(email);
  const structured = parseStructuredCancellationResponse(email.body);
  if (structured) {
    const errors: string[] = [];
    const serialPattern = serialPatternToRegex(settings.mail_serial_pattern || 'XXXXXXXX-XXXX-XXXXXXXX');
    const formatValid = new RegExp(`^(?:${serialPattern.source.replace(/^\\b|\\b$/g, '')})$`, 'i').test(structured.serialNumber);
    const linkedSerial = formatValid ? serialService.getBySerialNumber(structured.serialNumber) : undefined;
    if (!structured.serialNumber) errors.push('SERIAL_NUMBER is required');
    else if (!formatValid) errors.push('SERIAL_NUMBER format is invalid');
    else if (!linkedSerial) errors.push('SERIAL_NUMBER does not exist');
    if (structured.confirmation.trim().toUpperCase() !== 'YES') errors.push('CANCELLATION_CONFIRMATION must be YES');
    if (!structured.customerName) errors.push('CUSTOMER_NAME is required');
    const expectedName = linkedSerial?.customer?.name?.trim() || '';
    const customerMismatch = !!structured.customerName && !!expectedName
      && structured.customerName.trim().toLocaleLowerCase() !== expectedName.toLocaleLowerCase();
    if (customerMismatch) errors.push('CUSTOMER_NAME does not match the registered customer');

    return {
      classification: errors.length ? 'invalid_cancellation_response' : 'stop_request_candidate',
      extractedSerial: linkedSerial?.serial_number || structured.serialNumber || null,
      matchedKeywords: [],
      missingFields: [],
      isDedicated: dedicated,
      evidence: ['structured_response'],
      structuredResponse: structured,
      responseErrors: errors,
      requiresAdminReview: customerMismatch,
    };
  }

  const productKws = settings.renewal_product_keywords || [];
  const actionKws = (settings.renewal_action_keywords?.length > 0
    ? settings.renewal_action_keywords
    : settings.renewal_keywords) || [];
  const stopKws = [
    'cancel', 'cancellation', 'stop renewal', 'do not renew', 'not renew', 'no renewal',
    'terminate', 'unsubscribe', 'opt out', '解約', '更新停止', '停止', 'キャンセル',
    '更新中止', '中止', '갱신 중단', '갱신중단', '중단', '취소', '해지',
  ];

  // 키워드가 전혀 설정되지 않은 상태에서 dedicated_email도 없으면
  // 모든 메일이 요청으로 분류되는 오동작 방지
  if (!dedicated && productKws.length === 0 && actionKws.length === 0 && stopKws.length === 0) {
    logger.warn('[analyzeEmail] product/action keywords not configured; classifying as unclassified (configure keywords in settings)');
    return { classification: 'unclassified', extractedSerial: null, matchedKeywords: [], missingFields: [], isDedicated: false, evidence: [] };
  }

  const searchText = `${email.subject} ${email.body}`.toLowerCase();

  const matchedProducts = productKws.filter(
    kw => kw.trim().length > 0 && searchText.includes(kw.toLowerCase().trim()),
  );
  const hasProductMatch = matchedProducts.length > 0;

  const excludeKws = settings.renewal_exclude_keywords || [];
  const hasExcluded = excludeKws.some(kw => kw.trim().length > 0 && searchText.includes(kw.toLowerCase().trim()));
  if (hasExcluded) {
    return {
      classification: hasProductMatch ? 'unrelated' : 'unclassified',
      extractedSerial: null,
      matchedKeywords: matchedProducts,
      missingFields: [],
      isDedicated: false,
      evidence: ['excluded'],
    };
  }

  const matchedActions = actionKws.filter(kw => kw.trim().length > 0 && searchText.includes(kw.toLowerCase().trim()));
  const extractedSerial = extractSerialNumber(email);
  const serialMatched = !!extractedSerial;
  const linkedSerial = extractedSerial ? serialService.getBySerialNumber(extractedSerial) : undefined;
  const fromLower = email.from.toLowerCase();
  const customerEmail = linkedSerial?.customer?.email?.trim().toLowerCase() || '';
  const customerMatched = !!customerEmail && fromLower.includes(customerEmail);

  const matchedStops = stopKws.filter(kw => kw.trim().length > 0 && searchText.includes(kw.toLowerCase().trim()));
  const intentMatched = matchedActions.length > 0 || matchedStops.length > 0;
  const stopEvidence = [
    dedicated ? 'dedicated_email' : '',
    serialMatched ? 'serial' : '',
    customerMatched ? 'customer_email' : '',
    matchedStops.length > 0 ? 'stop_keyword' : '',
    hasProductMatch ? 'product' : '',
  ].filter(Boolean);

  const missingFields = [
    serialMatched ? '' : 'serial',
    intentMatched ? '' : 'stop_keyword',
  ].filter(Boolean);
  const hasRequestSignal = dedicated || hasProductMatch || serialMatched || intentMatched;

  const matchedKeywords = [...matchedProducts, ...matchedActions, ...matchedStops];

  if (serialMatched && intentMatched) {
    return { classification: 'stop_request_candidate', extractedSerial, matchedKeywords, missingFields: [], isDedicated: dedicated, evidence: stopEvidence };
  }
  if (hasRequestSignal && missingFields.length > 0) {
    return { classification: 'missing_info', extractedSerial, matchedKeywords, missingFields, isDedicated: dedicated, evidence: stopEvidence };
  }
  if (hasProductMatch) {
    return { classification: 'unrelated', extractedSerial: null, matchedKeywords, missingFields: [], isDedicated: false, evidence: ['product'] };
  }
  return { classification: 'unclassified', extractedSerial: null, matchedKeywords: [], missingFields: [], isDedicated: false, evidence: [] };
}

export function parseStructuredCancellationResponse(body: string): StructuredCancellationResponse | null {
  const blocks = Array.from(String(body || '').matchAll(
    /\[CANCELLATION_RESPONSE_START\]([\s\S]*?)\[CANCELLATION_RESPONSE_END\]/gi,
  ));
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const values: Record<string, string> = {};
    for (const match of blocks[i][1].matchAll(
      /^\s*(SERIAL_NUMBER|CANCELLATION_CONFIRMATION|CUSTOMER_NAME)\s*:\s*(.*?)\s*$/gim,
    )) {
      values[match[1].toUpperCase()] = match[2].trim();
    }
    if (!Object.values(values).some(Boolean)) continue;
    return {
      serialNumber: (values.SERIAL_NUMBER || '').toUpperCase(),
      confirmation: values.CANCELLATION_CONFIRMATION || '',
      customerName: values.CUSTOMER_NAME || '',
    };
  }
  return null;
}

function isDedicatedEmailTarget(email: ParsedEmail): boolean {
  const settings = getSettings();
  const dedicated = (settings.dedicated_email || '').trim().toLowerCase();
  if (!dedicated) return false;

  const allHeaders = [
    email.deliveredTo, email.xForwardedTo, email.xOriginalTo,
    email.to, email.cc, email.resent_to, email.xForwardedFor, email.xForwardedFrom,
  ].join(' ').toLowerCase();

  if (allHeaders.includes(dedicated)) return true;
  if (email.rawHeaders.toLowerCase().includes(dedicated)) return true;

  const bodyLower = email.body.toLowerCase();
  if (bodyLower.includes(dedicated)) {
    const idx = bodyLower.indexOf(dedicated);
    const context = bodyLower.substring(Math.max(0, idx - 100), idx + dedicated.length + 100);
    if (['to:', 'forwarded', 'forward', 'sent', 'redirect'].some(p => context.includes(p))) {
      return true;
    }
  }

  return false;
}

function extractSerialNumber(email: ParsedEmail): string | null {
  const settings = getSettings();
  const text = `${email.subject} ${email.body}`;
  const configuredPattern = settings.mail_serial_pattern || 'XXXXXXXX-XXXX-XXXXXXXX';
  const configuredRegex = serialPatternToRegex(configuredPattern);
  const configuredMatch = text.match(configuredRegex);
  if (configuredMatch) return configuredMatch[0].trim().toUpperCase();

  if (settings.require_serial_format ?? true) {
    return null;
  }

  const patterns = [
    /(?:serial|시리얼|s\/n|SN)[:\s]*([A-Z0-9][-A-Z0-9]{3,})/i,
    /\b([A-Z]{2,4}-\d{3,}[-\d]*)\b/,
    /\b(\d{4,}[-]\d{4,}[-]?\d{0,})\b/,
  ];
  for (const pat of patterns) {
    const m = text.match(pat);
    if (m) return m[1].trim();
  }
  const lowerText = text.toLowerCase();
  for (const serial of getCachedSerials()) {
    if (lowerText.includes(serial.serial_number.toLowerCase())) return serial.serial_number;
  }
  return null;
}

function serialPatternToRegex(pattern: string): RegExp {
  const source = (pattern || 'XXXXXXXX-XXXX-XXXXXXXX').trim();
  const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regexSource = escaped.replace(/x+/gi, match => `[A-Z0-9]{${match.length}}`);
  return new RegExp(`\\b${regexSource}\\b`, 'i');
}

function extractEmailAddresses(value: string): string[] {
  const matches = String(value || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  return Array.from(new Set(matches.map(m => m.toLowerCase())));
}

function getInternalEmailSet(): Set<string> {
  const settings = getSettings();
  const configured = [
    settings.pop3_user,
    settings.imap_user,
    settings.smtp_user,
    settings.report_email_to,
    settings.smtp_test_address,
    settings.dedicated_email,
  ];
  return new Set(configured.flatMap(extractEmailAddresses));
}

function firstExternalEmail(values: string[], allowInternalFallback = true): string | null {
  const internal = getInternalEmailSet();
  const addresses = values.flatMap(extractEmailAddresses);
  const external = addresses.find(addr => !internal.has(addr));
  if (external) return external;
  return allowInternalFallback ? addresses[0] ?? null : null;
}

function extractForwardedSenderAddress(body: string): string | null {
  const lines = String(body || '').split(/\r?\n/).slice(0, 80);
  const senderLinePatterns = [
    /^\s*(from|sender|reply-to)\s*:/i,
    /^\s*(보낸\s*사람|발신자|발신)\s*:/i,
    /^\s*(差出人|送信者|返信先)\s*:/i,
  ];

  for (const line of lines) {
    if (senderLinePatterns.some(pattern => pattern.test(line))) {
      const found = firstExternalEmail([line], false);
      if (found) return found;
    }
  }
  return null;
}

export function resolveReplyAddress(email: ParsedEmail): string | null {
  return firstExternalEmail([email.replyTo, email.xForwardedFrom, email.from], false)
    || extractForwardedSenderAddress(email.body)
    || firstExternalEmail([email.body], false)
    || firstExternalEmail([email.replyTo, email.xForwardedFrom, email.from]);
}

function resolveReplyAddressFromStoredMail(mail: InboundMail): string | null {
  return firstExternalEmail([mail.mail_from], false)
    || extractForwardedSenderAddress(mail.body)
    || firstExternalEmail([mail.body], false)
    || firstExternalEmail([mail.mail_from]);
}

export function resolveMailFrom(email: ParsedEmail): string {
  const replyAddress = resolveReplyAddress(email);
  if (replyAddress) return replyAddress;
  return email.from;
}

function parseMissingFields(raw: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function missingFieldLabel(field: string): string {
  if (field === 'serial') return 'シリアルナンバー';
  if (field === 'stop_keyword') return '更新停止をご希望であることが分かる文面';
  return field;
}

async function sendMissingInfoNotice(mail: InboundMail, to: string): Promise<{ success: boolean; message: string }> {
  const settings = getSettings();
  const missingFields = parseMissingFields(mail.missing_fields);
  return sendTemplate(
    settings.missing_info_template || 'missing_info_request',
    to,
    {
      CUSTOMER_NAME: to,
      CUSTOMER_EMAIL: to,
      DETECTED_SERIAL: mail.extracted_serial || '',
      RECEIVED_SUBJECT: mail.subject || '',
      MISSING_FIELDS: missingFields.map(missingFieldLabel).join(', ') || '必要情報',
    },
    { actor: 'email' },
  );
}

async function sendInvalidResponseNotice(
  email: ParsedEmail,
  to: string,
  analysis: AnalysisResult,
): Promise<{ success: boolean; message: string }> {
  const settings = getSettings();
  const replyTemplate = `[CANCELLATION_RESPONSE_START]
SERIAL_NUMBER:
CANCELLATION_CONFIRMATION: YES
CUSTOMER_NAME:
[CANCELLATION_RESPONSE_END]`;
  return sendTemplate(
    settings.invalid_response_template || 'invalid_cancellation_response',
    to,
    {
      CUSTOMER_NAME: to,
      CUSTOMER_EMAIL: to,
      RESPONSE_ERRORS: (analysis.responseErrors || []).join(', '),
      DETECTED_SERIAL: analysis.extractedSerial || '',
      RECEIVED_SUBJECT: email.subject || '',
      REPLY_TEMPLATE: replyTemplate,
    },
    { actor: 'email' },
  );
}

function isWithin1Day(dateStr: string): boolean {
  if (!dateStr) return false;
  try {
    const t = new Date(dateStr).getTime();
    return !isNaN(t) && t >= getTimestampDaysAgo(1);
  } catch { return false; }
}
