import Pop3Command from 'node-pop3';
import Imap from 'imap';
import { simpleParser } from 'mailparser';
import { getSettings } from '../../settings';
import { getDb } from '../../database';
import { serialService } from '../serial.service';
import { notificationService } from '../notification.service';
import { sendStopRequestReceivedNotice } from './lifecycle-notice.service';
import { sendTemplate } from './smtp.service';
import { logger } from '../../utils/logger';
import { getTimestampDaysAgo } from '../../utils/date-utils';
import type { MailConnectionResult, InboundMail } from '../../../shared/types';

// ── Serial number lookup cache (TTL 60s, avoids repeated getAll() per email) ──
let serialCacheResult: { serial_number: string }[] | null = null;
let serialCacheExpiry = 0;
function getCachedSerials(): { serial_number: string }[] {
  if (!serialCacheResult || Date.now() > serialCacheExpiry) {
    serialCacheResult = serialService.getAll();
    serialCacheExpiry = Date.now() + 60_000;
  }
  return serialCacheResult;
}

// ── Internal types ────────────────────────────────────────────────────────────

interface ParsedEmail {
  messageId: string | null;
  from: string;
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

type Classification = 'renewal_request' | 'stop_request_candidate' | 'stop_request' | 'missing_info' | 'unrelated' | 'unclassified' | 'error';

interface AnalysisResult {
  classification: Classification;
  extractedSerial: string | null;
  matchedKeywords: string[];
  missingFields: string[];
  isDedicated: boolean;
  evidence: string[];
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
  } catch (err: any) {
    return { total_checked: 0, would_save: 0, would_skip: 0, entries: [], error: err.message };
  }
}

export async function testMailConnection(
  settingsOverride?: any,
): Promise<MailConnectionResult> {
  const settings = { ...getSettings(), ...(settingsOverride || {}) };
  try {
    return settings.mail_protocol === 'imap'
      ? testImapConnection(settings)
      : testPop3Connection(settings);
  } catch (err: any) {
    return { success: false, message: `오류: ${err.message}` };
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

  const updated = serialService.setStopRequested(serial.id, true, `mail:${id}`);
  if (!updated) return { success: false, error: '시리얼 상태 변경에 실패했습니다.' };

  db.prepare('UPDATE inbound_mails SET processed = 1, linked_serial_id = ?, classification = ? WHERE id = ?')
    .run(serial.id, 'stop_request_candidate', id);
  await sendStopRequestReceivedNotice(updated).catch((err: any) =>
    logger.error(`[inbound] stop request notice failed: ${err.message}`),
  );

  return { success: true, serial_number: serial.serial_number };
}

export async function sendMissingInfoTemplateForMail(id: number): Promise<{ success: boolean; message: string }> {
  const db = getDb();
  const mail = db.prepare('SELECT * FROM inbound_mails WHERE id = ?').get(id) as InboundMail | undefined;
  if (!mail) return { success: false, message: '메일을 찾을 수 없습니다.' };

  const to = extractFirstEmailAddress(mail.mail_from);
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
  },
): number | null {
  const db = getDb();
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  try {
    const result = db.prepare(`
      INSERT INTO inbound_mails
        (message_id, mail_from, mail_to, subject, body, received_at,
         classification, matched_template, matched_keywords, extracted_serial, linked_serial_id,
         missing_fields, template_sent_at, processed, error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(message_id) DO NOTHING
    `).run(
      email.messageId,
      email.from,
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
      opts.error ?? null,
    );
    return result.changes > 0 ? (result.lastInsertRowid as number) : null;
  } catch (err: any) {
    logger.error(`[inbound] saveInboundMail failed: ${err.message}`);
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
      return { classification: 'stop_request_candidate', saved: inboundId !== null, pendingOrderCreated: inboundId !== null };

    } else if (analysis.classification === 'missing_info') {
      let templateSentAt: string | null = null;
      let error: string | undefined;
      const shouldAutoSend = getSettings().missing_info_auto_reply_enabled;
      if (shouldAutoSend && !isDuplicate(email.messageId)) {
        const to = extractFirstEmailAddress(email.from);
        if (to) {
          const tempMail = {
            mail_from: email.from,
            subject: email.subject,
            extracted_serial: analysis.extractedSerial,
            missing_fields: JSON.stringify(analysis.missingFields),
          } as InboundMail;
          const sendResult = await sendMissingInfoNotice(tempMail, to);
          if (sendResult.success) {
            templateSentAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
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
  let pop3: any = null;

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
    let oldEmailCount = 0;

    for (let i = list.length - 1; i >= startIdx; i--) {
      try {
        // node-pop3 UIDL()은 [msgNum, uid] 쌍의 배열을 반환.
        // RETR/DELE에는 메시지 번호(msgNum)를 사용해야 함.
        // fallback(i+1)은 메시지가 삭제된 경우 번호 불일치 위험이 있으므로 경고 처리.
        const entry = list[i];
        const msgNum = Array.isArray(entry) ? String(entry[0]) : null;
        if (!msgNum) {
          logger.warn(`[POP3] UIDL 항목 형식 이상 (index=${i}) — 건너뜀`);
          continue;
        }
        const uid = Array.isArray(entry) ? String(entry[1] ?? entry[0]) : msgNum;

        const rawMessage = await pop3.RETR(msgNum);
        const rawStr = typeof rawMessage === 'string' ? rawMessage : String(rawMessage);
        const email = await parseEmail(rawStr, `pop3-${uid}`);

        if (!isWithin1Day(email.date)) {
          if (email.date) {
            oldEmailCount++;
            if (oldEmailCount >= 3) break;
          }
          continue;
        }
        oldEmailCount = 0;

        const analysis = analyzeEmail(email);
        if (analysis.classification !== 'unclassified') {
          const result = await processEmail(email, true);
          if (result.saved) saved++;
          if (result.pendingOrderCreated) processed++;
        }

        if (!settings.pop3_keep_copy) {
          try { await pop3.DELE(msgNum); } catch { /* ignore */ }
        }
      } catch (err: any) {
        errors.push(`메일 처리 오류: ${err.message}`);
      }
    }
  } catch (err: any) {
    errors.push(`POP3 연결 오류: ${err.message}`);
    logger.error(`[inbound] POP3 error: ${err.message}`);
  } finally {
    if (pop3) { try { await pop3.QUIT(); } catch { /* ignore */ } }
  }

  return { processed, saved, errors };
}

async function dryRunWithPop3(): Promise<InboundDryRunResult> {
  const settings = getSettings();
  const entries: InboundDryRunEntry[] = [];
  let totalChecked = 0;
  let pop3: any = null;

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
          if (email.date) break;
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
                } catch (e: any) {
                  errors.push(`메일 파싱 오류: ${e.message}`);
                }
                resolve();
              });
            });
            pending.push(p);
          });

          fetch.once('error', (e: Error) => { errors.push(`메일 가져오기 오류: ${e.message}`); });
          fetch.once('end', async () => {
            await Promise.all(pending);
            // 모든 처리 완료 후 일괄 읽음 처리 (성공·실패 무관하게 seen 마킹)
            // 처리 실패한 메시지는 DB에 error 분류로 저장되어 있거나 message_id로 dedup 처리됨
            if (uids.length > 0) {
              await new Promise<void>((res) => {
                imap.addFlags(uids, ['\\Seen'], (err) => {
                  if (err) logger.warn(`[inbound] IMAP addFlags 실패: ${err.message}`);
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

async function testPop3Connection(settings: any): Promise<MailConnectionResult> {
  let pop3: any = null;
  try {
    pop3 = new Pop3Command({
      host: settings.pop3_host, port: settings.pop3_port,
      user: settings.pop3_user, password: settings.pop3_password,
      tls: settings.pop3_tls, timeout: 10000,
      tlsOptions: { rejectUnauthorized: false }, servername: settings.pop3_host,
    });
    const list = await pop3.UIDL();
    const count = Array.isArray(list) ? list.length : 0;
    return { success: true, message: `POP3 연결 성공`, mail_count: count };
  } catch (err: any) {
    return { success: false, message: `POP3 연결 실패: ${err.message}` };
  } finally {
    if (pop3) { try { await pop3.QUIT(); } catch { /* ignore */ } }
  }
}

function testImapConnection(settings: any): Promise<MailConnectionResult> {
  return new Promise((resolve) => {
    const imap = new Imap({
      user: settings.imap_user, password: settings.imap_password,
      host: settings.imap_host, port: settings.imap_port,
      tls: settings.imap_tls, tlsOptions: { rejectUnauthorized: false },
    });
    const done = (r: MailConnectionResult) => { try { imap.end(); } catch { /* ignore */ } resolve(r); };
    imap.once('error', (err: Error) => done({ success: false, message: `IMAP 연결 실패: ${err.message}` }));
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
        const found = (parsed.headerLines as any[]).find(h => h.key?.toLowerCase() === name.toLowerCase());
        if (found) {
          const idx = found.line.indexOf(':');
          return idx >= 0 ? found.line.substring(idx + 1).trim() : found.line.trim();
        }
      }
      if (parsed.headers && typeof (parsed.headers as any).get === 'function') {
        return (parsed.headers as any).get(name) || '';
      }
    } catch { /* ignore */ }
    return '';
  };

  const toText = parsed.to
    ? (Array.isArray(parsed.to) ? (parsed.to as any[]).map(a => a.text || '').join(', ') : (parsed.to as any).text || '')
    : '';
  const ccText = parsed.cc
    ? (Array.isArray(parsed.cc) ? (parsed.cc as any[]).map(a => a.text || '').join(', ') : (parsed.cc as any).text || '')
    : '';

  return {
    messageId: parsed.messageId || fallbackMsgId,
    from: parsed.from?.text || '',
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

function analyzeEmail(email: ParsedEmail): AnalysisResult {
  const settings = getSettings();
  const dedicated = isDedicatedEmailTarget(email);

  const productKws = settings.renewal_product_keywords || [];
  const actionKws = (settings.renewal_action_keywords?.length > 0
    ? settings.renewal_action_keywords
    : settings.renewal_keywords) || [];
  const stopKws = [
    'cancel', 'cancellation', 'stop renewal', 'do not renew', 'not renew', 'no renewal',
    'terminate', 'unsubscribe', 'opt out', '解約', '更新停止', '停止', 'キャンセル',
    '갱신 중단', '갱신중단', '중단', '취소', '해지',
  ];

  // 키워드가 전혀 설정되지 않은 상태에서 dedicated_email도 없으면
  // 모든 메일이 요청으로 분류되는 오동작 방지
  if (!dedicated && productKws.length === 0 && actionKws.length === 0 && stopKws.length === 0) {
    logger.warn('[analyzeEmail] product/action 키워드 미설정 — unclassified 처리 (설정에서 키워드를 구성하세요)');
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
  const text = `${email.subject} ${email.body}`;
  const configuredPattern = getSettings().mail_serial_pattern || 'XXXXXXXX-XXXX-XXXXXXXX';
  const configuredRegex = serialPatternToRegex(configuredPattern);
  const configuredMatch = text.match(configuredRegex);
  if (configuredMatch) return configuredMatch[0].trim().toUpperCase();

  const patterns = [
    /(?:serial|시리얼|s\/n|SN)[:\s]*([A-Z0-9][-A-Z0-9]{3,})/i,
    /\b([A-Z]{2,4}-\d{3,}[-\d]*)\b/,
    /\b(\d{4,}[-]\d{4,}[-]?\d{0,})\b/,
  ];
  for (const pat of patterns) {
    const m = text.match(pat);
    if (m) return m[1].trim();
  }
  for (const serial of getCachedSerials()) {
    if (text.includes(serial.serial_number)) return serial.serial_number;
  }
  return null;
}

function serialPatternToRegex(pattern: string): RegExp {
  const source = (pattern || 'XXXXXXXX-XXXX-XXXXXXXX').trim();
  const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regexSource = escaped.replace(/X+/g, match => `[A-Z0-9]{${match.length}}`);
  return new RegExp(`\\b${regexSource}\\b`, 'i');
}

function extractFirstEmailAddress(value: string): string | null {
  const match = String(value || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0] : null;
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
  if (field === 'serial') return '시리얼 번호';
  if (field === 'stop_keyword') return '갱신 중단 의사';
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
      MISSING_FIELDS: missingFields.map(missingFieldLabel).join(', ') || '필수 정보',
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
