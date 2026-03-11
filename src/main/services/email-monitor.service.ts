import Pop3Command from 'node-pop3';
import Imap from 'imap';
import { simpleParser } from 'mailparser';
import { getSettings } from '../settings';
import { serialService } from './serial.service';
import { logger } from '../utils/logger';
import type { RenewalDryRunResult, RenewalDryRunEmail, MailConnectionResult } from '../../shared/types';

// ── 파싱된 이메일 구조 ────────────────────────────────────────────────────────
// forward 감지를 위해 수신 관련 헤더를 모두 포함
interface ParsedEmail {
  from: string;
  to: string;             // To 헤더
  cc: string;             // Cc 헤더
  subject: string;
  body: string;
  date: string;
  // Forward/Redirect 관련 헤더들
  deliveredTo: string;    // Delivered-To (Gmail 등 실제 수신 주소)
  xForwardedTo: string;   // X-Forwarded-To
  xOriginalTo: string;    // X-Original-To
  xForwardedFor: string;  // X-Forwarded-For (일부 MTA)
  resent_to: string;      // Resent-To (RFC 2822 forward)
  xForwardedFrom: string; // X-Forwarded-From
  rawHeaders: string;     // 전체 헤더 원문 (추가 파싱용)
}

export class EmailMonitorService {
  async checkForRenewalRequests(): Promise<{ processed: number; errors: string[] }> {
    const settings = getSettings();

    if (settings.mail_protocol === 'imap') {
      return this.checkWithImap();
    } else {
      return this.checkWithPop3();
    }
  }

  // ─── Renewal Dry-Run: 이메일 스캔만 하고 DB에 저장하지 않음 ───────────────────
  async renewalDryRun(): Promise<RenewalDryRunResult> {
    const settings = getSettings();
    try {
      if (settings.mail_protocol === 'imap') {
        return await this.dryRunWithImap();
      } else {
        return await this.dryRunWithPop3();
      }
    } catch (err: any) {
      return { total_checked: 0, matched: 0, emails: [], error: err.message };
    }
  }

  // ─── Mail Connection Test ─────────────────────────────────────────────────
  async testMailConnection(settingsOverride?: Partial<ReturnType<typeof getSettings>>): Promise<MailConnectionResult> {
    const settings = { ...getSettings(), ...(settingsOverride || {}) };
    try {
      if (settings.mail_protocol === 'imap') {
        return await this.testImapConnection(settings);
      } else {
        return await this.testPop3Connection(settings);
      }
    } catch (err: any) {
      return { success: false, message: `오류: ${err.message}` };
    }
  }

  // ─── POP3 Connection Test ─────────────────────────────────────────────────
  private async testPop3Connection(settings: ReturnType<typeof getSettings>): Promise<MailConnectionResult> {
    let pop3: Pop3Command | null = null;
    try {
      pop3 = new Pop3Command({
        host: settings.pop3_host,
        port: settings.pop3_port,
        user: settings.pop3_user,
        password: settings.pop3_password,
        tls: settings.pop3_tls,
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

  // ─── IMAP Connection Test ─────────────────────────────────────────────────
  private testImapConnection(settings: ReturnType<typeof getSettings>): Promise<MailConnectionResult> {
    return new Promise((resolve) => {
      const imap = new Imap({
        user: settings.imap_user,
        password: settings.imap_password,
        host: settings.imap_host,
        port: settings.imap_port,
        tls: settings.imap_tls,
        tlsOptions: { rejectUnauthorized: false },
      });

      const done = (result: MailConnectionResult) => {
        try { imap.end(); } catch { /* ignore */ }
        resolve(result);
      };

      imap.once('error', (err: Error) => {
        done({ success: false, message: `IMAP 연결 실패: ${err.message}` });
      });

      imap.once('ready', () => {
        imap.openBox('INBOX', true, (err, box) => {
          if (err) {
            done({ success: false, message: `INBOX 열기 실패: ${err.message}` });
          } else {
            const total = box?.messages?.total ?? 0;
            done({ success: true, message: `IMAP 연결 성공`, mail_count: total });
          }
        });
      });

      imap.connect();
    });
  }


  // ─── POP3 Dry-Run ─────────────────────────────────────────────────────────
  private async dryRunWithPop3(): Promise<RenewalDryRunResult> {
    const settings = getSettings();
    const emails: RenewalDryRunEmail[] = [];
    let pop3: Pop3Command | null = null;
    let totalChecked = 0;

    try {
      pop3 = new Pop3Command({
        host: settings.pop3_host,
        port: settings.pop3_port,
        user: settings.pop3_user,
        password: settings.pop3_password,
        tls: settings.pop3_tls,
      });

      const list = await pop3.UIDL();
      if (!Array.isArray(list) || list.length === 0) {
        return { total_checked: 0, matched: 0, emails: [] };
      }

      for (let i = 0; i < list.length; i++) {
        totalChecked++;
        try {
          const msgNum = Array.isArray(list[i]) ? (list[i] as any)[0] : String(i + 1);
          const rawMessage = await pop3.RETR(msgNum);
          const rawStr = typeof rawMessage === 'string' ? rawMessage : String(rawMessage);
          const email = this.parseEmailRaw(rawStr);
          // 1일 이내 메일만 dry-run 스캔
          if (!this.isWithin1Day(email.date)) continue;
          const dryEntry = this.buildDryRunEntry(email);
          if (dryEntry) emails.push(dryEntry);
        } catch { /* skip individual mail errors */ }
      }
    } finally {
      if (pop3) { try { await pop3.QUIT(); } catch { /* ignore */ } }
    }

    return { total_checked: totalChecked, matched: emails.length, emails };
  }

  // ─── IMAP Dry-Run ─────────────────────────────────────────────────────────
  private dryRunWithImap(): Promise<RenewalDryRunResult> {
    return new Promise((resolve) => {
      const settings = getSettings();
      const emails: RenewalDryRunEmail[] = [];
      let totalChecked = 0;

      const imap = new Imap({
        user: settings.imap_user,
        password: settings.imap_password,
        host: settings.imap_host,
        port: settings.imap_port,
        tls: settings.imap_tls,
        tlsOptions: { rejectUnauthorized: false },
      });

      const done = () => {
        try { imap.end(); } catch { /* ignore */ }
        resolve({ total_checked: totalChecked, matched: emails.length, emails });
      };

      imap.once('error', (err: Error) => {
        try { imap.end(); } catch { /* ignore */ }
        resolve({ total_checked: 0, matched: 0, emails: [], error: err.message });
      });

      imap.once('ready', () => {
        // Read-only open (3rd arg = true)
        imap.openBox('INBOX', true, (err) => {
          if (err) { return done(); }

          // Dry-run: check ALL mails since 1 day ago (not just UNSEEN), no markSeen
          const since1Day = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
          imap.search(['ALL', ['SINCE', since1Day]], (err, uids) => {
            if (err || !uids || uids.length === 0) { return done(); }

            // Limit to last 50 to avoid overloading
            const slicedUids = uids.slice(-50);
            const fetch = imap.fetch(slicedUids, { bodies: '', markSeen: false });
            const pending: Promise<void>[] = [];

            fetch.on('message', (msg) => {
              const p = new Promise<void>((msgResolve) => {
                let rawBuffer = '';
                msg.on('body', (stream) => {
                  stream.on('data', (chunk: Buffer) => { rawBuffer += chunk.toString('utf8'); });
                });
                msg.once('end', async () => {
                  totalChecked++;
                  try {
                    const parsed = await simpleParser(rawBuffer);
                    const rawHeaders = rawBuffer.split(/\r?\n\r?\n/)[0] || '';
                    const getHeader = (name: string): string => {
                      const regex = new RegExp(`^${name}:\\s*(.+)`, 'im');
                      const m = rawHeaders.match(regex);
                      return m ? m[1].trim() : '';
                    };
                    const toText = (() => {
                      if (!parsed.to) return '';
                      if (Array.isArray(parsed.to)) return parsed.to.map((a: any) => a.text || '').join(', ');
                      return (parsed.to as any).text || '';
                    })();
                    const ccText = (() => {
                      if (!parsed.cc) return '';
                      if (Array.isArray(parsed.cc)) return parsed.cc.map((a: any) => a.text || '').join(', ');
                      return (parsed.cc as any).text || '';
                    })();
                    const email: ParsedEmail = {
                      from: parsed.from?.text || '',
                      to: toText,
                      cc: ccText,
                      subject: parsed.subject || '',
                      body: parsed.text || (typeof parsed.html === 'string' ? parsed.html : '') || '',
                      date: parsed.date?.toISOString() || '',
                      deliveredTo: this.getMailparserHeader(parsed, 'delivered-to') || getHeader('Delivered-To'),
                      xForwardedTo: this.getMailparserHeader(parsed, 'x-forwarded-to') || getHeader('X-Forwarded-To'),
                      xOriginalTo: this.getMailparserHeader(parsed, 'x-original-to') || getHeader('X-Original-To'),
                      xForwardedFor: this.getMailparserHeader(parsed, 'x-forwarded-for') || getHeader('X-Forwarded-For'),
                      resent_to: this.getMailparserHeader(parsed, 'resent-to') || getHeader('Resent-To'),
                      xForwardedFrom: this.getMailparserHeader(parsed, 'x-forwarded-from') || getHeader('X-Forwarded-From'),
                      rawHeaders,
                    };
                    const dryEntry = this.buildDryRunEntry(email);
                    if (dryEntry) emails.push(dryEntry);
                  } catch { /* skip */ }
                  msgResolve();
                });
              });
              pending.push(p);
            });

            fetch.once('error', () => { /* ignore */ });
            fetch.once('end', async () => {
              await Promise.all(pending);
              done();
            });
          });
        });
      });

      imap.connect();
    });
  }

  // ─── Dry-Run 공통: 이메일 → RenewalDryRunEmail 변환 ─────────────────────────
  private buildDryRunEntry(email: ParsedEmail): RenewalDryRunEmail | null {
    const settings = getSettings();
    const isDedicated = this.isDedicatedEmailTarget(email);

    // 키워드 매칭
    const keywords = settings.renewal_keywords.length > 0
      ? settings.renewal_keywords
      : ['renewal', 'renew', '갱신', '연장', 'extend', 'subscription renewal'];
    const searchText = `${email.subject} ${email.body}`.toLowerCase();
    const matchedKeywords = keywords.filter(kw => searchText.includes(kw.toLowerCase()));

    // 갱신 요청이 아닌 경우 null 반환
    if (!isDedicated && matchedKeywords.length === 0) return null;

    const serialNumber = this.extractSerialNumber(email);
    const serialExists = serialNumber
      ? !!serialService.getBySerialNumber(serialNumber)
      : false;

    return {
      from: email.from,
      subject: email.subject,
      date: email.date,
      matched_keywords: isDedicated && matchedKeywords.length === 0 ? ['[dedicated email]'] : matchedKeywords,
      is_dedicated: isDedicated,
      serial_number: serialNumber,
      serial_exists: serialExists,
    };
  }

  // ─── 3일 내 수신 여부 판단 ─────────────────────────────────────────────────
  private isWithin1Day(dateStr: string): boolean {
    if (!dateStr) return false;
    try {
      const mailDate = new Date(dateStr).getTime();
      if (isNaN(mailDate)) return false;
      const cutoff = Date.now() - 1 * 24 * 60 * 60 * 1000; // 1일 전 timestamp
      return mailDate >= cutoff;
    } catch {
      return false;
    }
  }

  // ─── POP3 ───────────────────────────────────────────────────────────────────
  private async checkWithPop3(): Promise<{ processed: number; errors: string[] }> {
    const settings = getSettings();
    const errors: string[] = [];
    let processed = 0;
    let pop3: Pop3Command | null = null;

    try {
      pop3 = new Pop3Command({
        host: settings.pop3_host,
        port: settings.pop3_port,
        user: settings.pop3_user,
        password: settings.pop3_password,
        tls: settings.pop3_tls,
      });

      const list = await pop3.UIDL();

      if (!Array.isArray(list) || list.length === 0) {
        logger.info('갱신 요청 메일 없음 (POP3)');
        return { processed: 0, errors: [] };
      }

      for (let i = 0; i < list.length; i++) {
        try {
          const msgNum = Array.isArray(list[i]) ? (list[i] as any)[0] : String(i + 1);
          const rawMessage = await pop3.RETR(msgNum);
          const rawStr = typeof rawMessage === 'string' ? rawMessage : String(rawMessage);
          const email = this.parseEmailRaw(rawStr);

          // 1일 이내 메일만 처리 — 날짜가 없거나 콩뽐 이전 메일은 스킵 (DELE는 실행해 다음에 다시 안 올 수 있게)
          if (!this.isWithin1Day(email.date)) {
            logger.info(`POP3: 1일 초과 메일 건너뜀: from=${email.from}, date=${email.date}`);
            try { await pop3.DELE(msgNum); } catch { /* ignore */ }
            continue;
          }

          if (this.isRenewalRequest(email)) {
            const count = await this.processRenewalEmail(email, errors);
            processed += count;
          }

          // 처리한 메일은 서버에서 삭제 (QUIT 시 실제 삭제됨)
          // 삭제하지 않으면 다음 실행 시 동일 메일이 반복 처리됨
          try {
            await pop3.DELE(msgNum);
          } catch (deleErr: any) {
            logger.warn(`POP3 DELE 실패 (msgNum=${msgNum}): ${deleErr.message}`);
          }
        } catch (err: any) {
          errors.push(`메일 처리 오류: ${err.message}`);
        }
      }
    } catch (err: any) {
      errors.push(`POP3 연결 오류: ${err.message}`);
      logger.error(`POP3 error: ${err.message}`);
    } finally {
      if (pop3) {
        try { await pop3.QUIT(); } catch { /* ignore */ }
      }
    }

    return { processed, errors };
  }

  // ─── IMAP ───────────────────────────────────────────────────────────────────
  private checkWithImap(): Promise<{ processed: number; errors: string[] }> {
    return new Promise((resolve) => {
      const settings = getSettings();
      const errors: string[] = [];
      let processed = 0;

      const imap = new Imap({
        user: settings.imap_user,
        password: settings.imap_password,
        host: settings.imap_host,
        port: settings.imap_port,
        tls: settings.imap_tls,
        tlsOptions: { rejectUnauthorized: false },
      });

      const done = () => {
        try { imap.end(); } catch { /* ignore */ }
        resolve({ processed, errors });
      };

      imap.once('error', (err: Error) => {
        errors.push(`IMAP 연결 오류: ${err.message}`);
        logger.error(`IMAP error: ${err.message}`);
        done();
      });

      imap.once('ready', () => {
        imap.openBox('INBOX', false, (err, _box) => {
          if (err) {
            errors.push(`INBOX 열기 오류: ${err.message}`);
            return done();
          }

          // UNSEEN 미독 + 최근 1일 이내 메일만 검색 (서버사이드 필터)
          const since1Day = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
          imap.search(['UNSEEN', ['SINCE', since1Day]], (err, uids) => {
            if (err) {
              errors.push(`메일 검색 오류: ${err.message}`);
              return done();
            }

            if (!uids || uids.length === 0) {
              logger.info('갱신 요청 메일 없음 (IMAP)');
              return done();
            }

            // 전체 raw를 가져와 forward 헤더까지 파싱
            const fetch = imap.fetch(uids, { bodies: '', markSeen: true });
            const pending: Promise<void>[] = [];

            fetch.on('message', (msg) => {
              const p = new Promise<void>((msgResolve) => {
                let rawBuffer = '';

                msg.on('body', (stream) => {
                  stream.on('data', (chunk: Buffer) => {
                    rawBuffer += chunk.toString('utf8');
                  });
                });

                msg.once('end', async () => {
                  try {
                    const parsed = await simpleParser(rawBuffer);

                    // 헤더 섹션만 분리 (빈 줄 전까지)
                    const rawHeaders = rawBuffer.split(/\r?\n\r?\n/)[0] || '';

                    // raw에서 특정 헤더 추출 헬퍼
                    const getHeader = (name: string): string => {
                      const regex = new RegExp(`^${name}:\\s*(.+)`, 'im');
                      const m = rawHeaders.match(regex);
                      return m ? m[1].trim() : '';
                    };

                    // To 필드: mailparser 결과 → 문자열 변환
                    const toText = (() => {
                      if (!parsed.to) return '';
                      if (Array.isArray(parsed.to)) return parsed.to.map((a: any) => a.text || '').join(', ');
                      return (parsed.to as any).text || '';
                    })();

                    const ccText = (() => {
                      if (!parsed.cc) return '';
                      if (Array.isArray(parsed.cc)) return parsed.cc.map((a: any) => a.text || '').join(', ');
                      return (parsed.cc as any).text || '';
                    })();

                    const email: ParsedEmail = {
                      from: parsed.from?.text || '',
                      to: toText,
                      cc: ccText,
                      subject: parsed.subject || '',
                      body: parsed.text || (typeof parsed.html === 'string' ? parsed.html : '') || '',
                      date: parsed.date?.toISOString() || '',
                      // forward 관련 헤더 — mailparser headerLines 우선, fallback은 raw 파싱
                      deliveredTo: this.getMailparserHeader(parsed, 'delivered-to') || getHeader('Delivered-To'),
                      xForwardedTo: this.getMailparserHeader(parsed, 'x-forwarded-to') || getHeader('X-Forwarded-To'),
                      xOriginalTo: this.getMailparserHeader(parsed, 'x-original-to') || getHeader('X-Original-To'),
                      xForwardedFor: this.getMailparserHeader(parsed, 'x-forwarded-for') || getHeader('X-Forwarded-For'),
                      resent_to: this.getMailparserHeader(parsed, 'resent-to') || getHeader('Resent-To'),
                      xForwardedFrom: this.getMailparserHeader(parsed, 'x-forwarded-from') || getHeader('X-Forwarded-From'),
                      rawHeaders,
                    };

                    if (this.isRenewalRequest(email)) {
                      const count = await this.processRenewalEmail(email, errors);
                      processed += count;
                    }
                  } catch (parseErr: any) {
                    errors.push(`메일 파싱 오류: ${parseErr.message}`);
                  }
                  msgResolve();
                });
              });
              pending.push(p);
            });

            fetch.once('error', (err: Error) => {
              errors.push(`메일 가져오기 오류: ${err.message}`);
            });

            fetch.once('end', async () => {
              await Promise.all(pending);
              done();
            });
          });
        });
      });

      imap.connect();
    });
  }

  // ─── 공통: 갱신 메일 처리 ────────────────────────────────────────────────────
  private async processRenewalEmail(
    email: ParsedEmail,
    errors: string[]
  ): Promise<number> {
    const isDedicated = this.isDedicatedEmailTarget(email);
    const note = isDedicated ? ' [dedicated/forward 수신]' : '';

    const serialNumber = this.extractSerialNumber(email);

    if (serialNumber) {
      const serial = serialService.getBySerialNumber(serialNumber);
      if (serial) {
        serialService.renewSerial(serial.id, 'email');
        logger.info(`갱신 처리: ${serialNumber} (from: ${email.from}${note})`);
        return 1;
      } else {
        errors.push(`시리얼 ${serialNumber}을 찾을 수 없습니다 (from: ${email.from}${note})`);
      }
    } else {
      errors.push(`갱신 요청 메일에서 시리얼 넘버를 추출할 수 없습니다 (from: ${email.from}${note})`);
    }
    return 0;
  }

  // ─── 갱신 요청 여부 판단 ─────────────────────────────────────────────────────
  // 조건 A: dedicated_email이 설정되어 있고, To/Cc/forward 헤더에 포함
  //   → 키워드 없이도 갱신 요청으로 처리 (forward 자동 감지)
  // 조건 B: 제목+본문에 갱신 키워드 포함 (기존 로직)
  // 둘 중 하나만 만족해도 갱신 요청으로 처리
  private isRenewalRequest(email: ParsedEmail): boolean {
    const settings = getSettings();

    // 조건 A: dedicated email 수신/forward 감지
    if (this.isDedicatedEmailTarget(email)) {
      logger.info(`Dedicated email 감지 → 갱신 요청 처리 (from: ${email.from})`);
      return true;
    }

    // 조건 B: 갱신 키워드 매칭
    const keywords = settings.renewal_keywords.length > 0
      ? settings.renewal_keywords
      : ['renewal', 'renew', '갱신', '연장', 'extend', 'subscription renewal'];

    const searchText = `${email.subject} ${email.body}`.toLowerCase();
    return keywords.some(kw => searchText.includes(kw.toLowerCase()));
  }

  // ─── Dedicated email 수신 여부 확인 ─────────────────────────────────────────
  // 탐색 헤더 우선순위:
  //   1. Delivered-To       — Gmail, Postfix 등 실제 배달 주소
  //   2. X-Forwarded-To     — Gmail 자동 전달 설정
  //   3. X-Original-To      — Postfix original destination
  //   4. To                 — 직접 수신
  //   5. Cc                 — 참조 수신
  //   6. Resent-To          — RFC 2822 Resend/Forward
  //   7. X-Forwarded-For    — 일부 MTA forward 표시
  //   8. X-Forwarded-From   — 발신 forward 표시
  //   9. 본문 내 forward 패턴
  private isDedicatedEmailTarget(email: ParsedEmail): boolean {
    const settings = getSettings();
    const dedicated = (settings.dedicated_email || '').trim().toLowerCase();
    if (!dedicated) return false;

    // 헤더 전체를 합쳐서 한 번에 탐색 (부분 문자열 매칭)
    const allHeaderValues = [
      email.deliveredTo,
      email.xForwardedTo,
      email.xOriginalTo,
      email.to,
      email.cc,
      email.resent_to,
      email.xForwardedFor,
      email.xForwardedFrom,
    ].join(' ').toLowerCase();

    if (allHeaderValues.includes(dedicated)) {
      return true;
    }

    // rawHeaders 전체에서도 탐색 (위에서 못 잡은 헤더 보완)
    if (email.rawHeaders.toLowerCase().includes(dedicated)) {
      return true;
    }

    // 본문 내 forward 패턴 (일부 클라이언트: "--- Forwarded message ---" 블록)
    const bodyLower = email.body.toLowerCase();
    const forwardBodyPatterns = [
      `to: ${dedicated}`,
      `forwarded to ${dedicated}`,
      `forward to ${dedicated}`,
      `sent to ${dedicated}`,
      dedicated, // 본문에 주소 자체가 있는 경우 (가장 넓은 탐색)
    ];
    // 너무 넓은 매칭을 막기 위해 dedicated가 본문에 있을 경우
    // "to:", "forwarded", "forward", "sent" 패턴과 함께 있는지 체크
    if (bodyLower.includes(dedicated)) {
      const nearPatterns = ['to:', 'forwarded', 'forward', 'sent', 'redirect'];
      // dedicated 주소 앞뒤 100자 내에 forward 관련 패턴이 있으면 매칭
      const idx = bodyLower.indexOf(dedicated);
      const context = bodyLower.substring(Math.max(0, idx - 100), idx + dedicated.length + 100);
      if (nearPatterns.some(p => context.includes(p))) {
        logger.info(`Dedicated email "${dedicated}" 본문 forward 패턴에서 발견`);
        return true;
      }
    }

    return false;
  }

  // ─── mailparser 헤더 추출 헬퍼 ──────────────────────────────────────────────
  private getMailparserHeader(parsed: any, name: string): string {
    try {
      // mailparser v3: headerLines 배열
      if (parsed.headerLines && Array.isArray(parsed.headerLines)) {
        const found = parsed.headerLines.find(
          (h: any) => h.key && h.key.toLowerCase() === name.toLowerCase()
        );
        if (found) {
          // "Header-Name: value" 형태에서 값만 추출
          const colonIdx = found.line.indexOf(':');
          return colonIdx >= 0 ? found.line.substring(colonIdx + 1).trim() : found.line.trim();
        }
      }
      // headers Map 방식 (일부 버전)
      if (parsed.headers && typeof parsed.headers.get === 'function') {
        return parsed.headers.get(name) || '';
      }
    } catch { /* ignore */ }
    return '';
  }

  // ─── 시리얼 넘버 추출 ────────────────────────────────────────────────────────
  private extractSerialNumber(email: ParsedEmail): string | null {
    const text = `${email.subject} ${email.body}`;

    const patterns = [
      /(?:serial|시리얼|s\/n|SN)[:\s]*([A-Z0-9][-A-Z0-9]{3,})/i,
      /\b([A-Z]{2,4}-\d{3,}[-\d]*)\b/,
      /\b(\d{4,}[-]\d{4,}[-]?\d{0,})\b/,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return match[1].trim();
    }

    // DB에 등록된 시리얼과 직접 매칭
    const allSerials = serialService.getAll();
    for (const serial of allSerials) {
      if (text.includes(serial.serial_number)) {
        return serial.serial_number;
      }
    }

    return null;
  }

  // ─── POP3용 raw 메일 파서 ────────────────────────────────────────────────────
  private parseEmailRaw(raw: string): ParsedEmail {
    const headers: Record<string, string> = {};
    const lines = raw.split(/\r?\n/);
    let bodyStart = 0;
    let currentHeader = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line === '') { bodyStart = i + 1; break; }
      if (line.startsWith(' ') || line.startsWith('\t')) {
        // 멀티라인 헤더 이어붙이기
        if (currentHeader) headers[currentHeader] += ' ' + line.trim();
      } else {
        const colonIdx = line.indexOf(':');
        if (colonIdx > 0) {
          currentHeader = line.substring(0, colonIdx).toLowerCase();
          headers[currentHeader] = line.substring(colonIdx + 1).trim();
        }
      }
    }

    const rawHeaders = lines.slice(0, bodyStart).join('\n');
    const body = lines.slice(bodyStart).join('\n');

    return {
      from: headers['from'] || '',
      to: headers['to'] || '',
      cc: headers['cc'] || '',
      subject: headers['subject'] || '',
      body: this.decodeBody(body, headers['content-transfer-encoding']),
      date: headers['date'] || '',
      deliveredTo: headers['delivered-to'] || '',
      xForwardedTo: headers['x-forwarded-to'] || '',
      xOriginalTo: headers['x-original-to'] || '',
      xForwardedFor: headers['x-forwarded-for'] || '',
      resent_to: headers['resent-to'] || '',
      xForwardedFrom: headers['x-forwarded-from'] || '',
      rawHeaders,
    };
  }

  // ─── Base64/QP 디코딩 ────────────────────────────────────────────────────────
  private decodeBody(body: string, encoding?: string): string {
    if (!encoding) return body;
    const enc = encoding.toLowerCase().trim();

    if (enc === 'base64') {
      try { return Buffer.from(body.replace(/\s/g, ''), 'base64').toString('utf-8'); } catch { return body; }
    }

    if (enc === 'quoted-printable') {
      return body
        .replace(/=\r?\n/g, '')
        .replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    }

    return body;
  }
}

export const emailMonitorService = new EmailMonitorService();
