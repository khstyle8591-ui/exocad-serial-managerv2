import Pop3Command from 'node-pop3';
import Imap from 'imap';
import { simpleParser } from 'mailparser';
import { getSettings } from '../settings';
import { serialService } from './serial.service';
import { logger } from '../utils/logger';
import { getTimestampDaysAgo } from '../utils/date-utils';
import { notificationService } from './notification.service';
import type { RenewalDryRunResult, RenewalDryRunEmail, MailConnectionResult } from '../../shared/types';
import { insertPendingOrder, isAlreadyFetched } from './order.service';

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
        timeout: 10000,
        tlsOptions: { rejectUnauthorized: false },
        servername: settings.pop3_host,
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
        timeout: 10000,
        tlsOptions: { rejectUnauthorized: false },
        servername: settings.pop3_host,
      });

      const list = await pop3.UIDL();
      if (!Array.isArray(list) || list.length === 0) {
        return { total_checked: 0, matched: 0, emails: [] };
      }

      // 최신 메일부터 역순으로 처리, 1일 입사 내 메일만 파싱
      // POP3 메일베스는 오래된 메일부터 오름이 일반적이지만 마지막이 최신
      const MAX_SCAN = 100;
      const startIdx = Math.max(0, list.length - MAX_SCAN);

      for (let i = list.length - 1; i >= startIdx; i--) {
        totalChecked++;
        try {
          const msgNum = Array.isArray(list[i]) ? (list[i] as any)[0] : String(i + 1);
          const rawMessage = await pop3.RETR(msgNum);
          const rawStr = typeof rawMessage === 'string' ? rawMessage : String(rawMessage);
          const email = await this.parseEmail(rawStr);
          // 1일 이내 메일만 dry-run 스캔
          if (!this.isWithin1Day(email.date)) {
            // 날짜를 파싱할 수 있으면 더 오래된 메일이라 조기 종료
            if (email.date) break;
            continue;
          }
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
          const since1Day = new Date(getTimestampDaysAgo(1));
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
    const analysis = this.analyzeEmail(email);

    if (!analysis.isRenewal && !analysis.isRelated) {
      return null;
    }

    const serialExists = analysis.serialNumber ? !!serialService.getBySerialNumber(analysis.serialNumber) : false;

    return {
      from: email.from,
      subject: email.subject,
      date: email.date,
      matched_keywords: [...analysis.matchedGroups.product, ...analysis.matchedGroups.action],
      is_dedicated: analysis.isDedicated,
      serial_number: analysis.serialNumber,
      serial_exists: serialExists,
      is_renewal: analysis.isRenewal,
      is_related: analysis.isRelated,
    };
  }

  // ─── 3일 내 수신 여부 판단 ─────────────────────────────────────────────────
  private isWithin1Day(dateStr: string): boolean {
    if (!dateStr) return false;
    try {
      const mailDate = new Date(dateStr).getTime();
      if (isNaN(mailDate)) return false;
      const cutoff = getTimestampDaysAgo(1); // 1일 전 timestamp
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
        timeout: 10000,
        tlsOptions: { rejectUnauthorized: false },
        servername: settings.pop3_host,
      });

      const list = await pop3.UIDL();

      if (!Array.isArray(list) || list.length === 0) {
        logger.info('갱신 요청 메일 없음 (POP3)');
        return { processed: 0, errors: [] };
      }

      // 최신 메일부터 역순으로 확인, 1일 이전 메일 만나면 조기 종료 (POP3 속도 개선)
      const MAX_SCAN = 100;
      const startIdx = Math.max(0, list.length - MAX_SCAN);

      for (let i = list.length - 1; i >= startIdx; i--) {
        try {
          const msgNum = Array.isArray(list[i]) ? (list[i] as any)[0] : String(i + 1);
          const rawMessage = await pop3.RETR(msgNum);
          const rawStr = typeof rawMessage === 'string' ? rawMessage : String(rawMessage);
          const email = await this.parseEmail(rawStr);

          // 1일 이내 메일만 처리 — 날짜 파싱이 되면 오래된 메일에서 조기 종료
          if (!this.isWithin1Day(email.date)) {
            if (email.date) {
              logger.info(`POP3: 1일 이전 메일 만남, 스캔 종료 (date=${email.date})`);
              break; // 더 오래된 메일만 남았으므로 중단
            }
            continue; // 날짜 파싱 안되면 그냥 스킵
          }

          const analysis = this.analyzeEmail(email);
          if (analysis.isRenewal) {
            const count = await this.processRenewalEmail(email, errors);
            processed += count;
          } else if (analysis.isRelated) {
            const mailId = this.saveCapturedEmail(email);
            logger.info(`[System Log] 관련 메일 수신 (키워드 매칭, 갱신 조건 미달): from=${email.from}, subject=${email.subject} [mailId=${mailId}]`);
            notificationService.sendRelatedMailSlack(email.from, email.subject, analysis.matchedGroups.product, mailId, email.date);
          }

          // 처리한 메일은 서버에서 삭제 (QUIT 시 실제 삭제됨) - 설정에 따라 유지 가능
          if (!settings.pop3_keep_copy) {
            try {
              await pop3.DELE(msgNum);
            } catch (deleErr: any) {
              logger.warn(`POP3 DELE 실패 (msgNum=${msgNum}): ${deleErr.message}`);
            }
          } else {
            logger.info(`POP3: 메일 서버 보관 설정에 의해 삭제 건너뜀 (msgNum=${msgNum})`);
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
          const since1Day = new Date(getTimestampDaysAgo(1));
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
                    const email = await this.parseEmail(rawBuffer);

                    const analysis = this.analyzeEmail(email);
                    if (analysis.isRenewal) {
                      const count = await this.processRenewalEmail(email, errors);
                      processed += count;
                    } else if (analysis.isRelated) {
                      const mailId = this.saveCapturedEmail(email);
                      logger.info(`[System Log] 관련 메일 수신 (키워드 매칭, 갱신 조건 미달): from=${email.from}, subject=${email.subject} [mailId=${mailId}]`);
                      notificationService.sendRelatedMailSlack(email.from, email.subject, analysis.matchedGroups.product, mailId, email.date);
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

  // ─── 공통: 갱신 메일 처리 → 대기 주문으로 등록 ─────────────────────────────
  private async processRenewalEmail(
    email: ParsedEmail,
    errors: string[]
  ): Promise<number> {
    const isDedicated = this.isDedicatedEmailTarget(email);
    const note = isDedicated ? ' [dedicated/forward 수신]' : '';

    const serialNumber = this.extractSerialNumber(email);

    if (!serialNumber) {
      errors.push(`갱신 요청 메일에서 시리얼 넘버를 추출할 수 없습니다 (from: ${email.from}${note})`);
      return 0;
    }

    const sourceId = `email::${email.from}::${serialNumber}::${email.date}`;
    if (isAlreadyFetched(sourceId)) {
      logger.info(`이메일 갱신 중복 스킵: ${serialNumber} (from: ${email.from})`);
      return 0;
    }

    const serial = serialService.getBySerialNumber(serialNumber);
    const notFoundNote = serial ? '' : ' [DB에 시리얼 없음 — 수동 확인 필요]';

    insertPendingOrder({
      source_id: sourceId,
      source_url: '',
      serial_number: serialNumber,
      customer_name: serial?.customer?.name || '',
      customer_email: email.from,
      customer_address: serial?.customer?.address || '',
      customer_phone: serial?.customer?.phone || '',
      dealer: serial?.customer?.dealer || '',
      sales_manager: serial?.customer?.sales_manager || '',
      trade_number: '',
      main_product: '',
      modules: '[]',
      purchase_date: serial?.purchase_date || '',
      expiry_date: '',
      engine_build: serial?.engine_build || '',
      version: serial?.version || '',
      notes: `이메일 갱신 요청: ${email.from} / 제목: ${email.subject}${note}${notFoundNote}`,
      order_type: 'renewal',
      raw_data: JSON.stringify({ from: email.from, subject: email.subject, date: email.date }),
      status: 'pending',
      product_code: '',
      flag_duplicate: 0,
    });

    logger.info(`이메일 갱신 요청 → 대기 주문 등록: ${serialNumber} (from: ${email.from}${note}${notFoundNote})`);
    return 1;
  }

  // ─── 이메일 다중 조건 분석 (Product, Action, Serial) ──────────────────────────
  private analyzeEmail(email: ParsedEmail): {
    isRenewal: boolean;
    isRelated: boolean;
    isExcluded: boolean;
    serialNumber: string | null;
    matchedGroups: { product: string[]; action: string[] };
    isDedicated: boolean;
  } {
    const settings = getSettings();
    const isDedicated = this.isDedicatedEmailTarget(email);
    const searchText = `${email.subject} ${email.body}`.toLowerCase();

    // 1. Product keywords - 먼저 체크 (제외 키워드 판단에도 사용)
    const productKws = settings.renewal_product_keywords || [];
    const matchedProducts = productKws.filter((kw: string) => kw.trim().length > 0 && searchText.includes(kw.toLowerCase().trim()));
    const hasProductMatch = matchedProducts.length > 0;

    // 0. Exclude keywords: 제외 키워드 하나라도 매칭되면 갱신 제외
    //    단, 제품 키워드도 매칭됐다면 '관련 메일 알림'은 계속 발송
    const excludeKws = settings.renewal_exclude_keywords || [];
    const hasExcluded = excludeKws.some((kw: string) => kw.trim().length > 0 && searchText.includes(kw.toLowerCase().trim()));
    if (hasExcluded) {
      logger.info(`[analyzeEmail] 제외 키워드 매칭 → 갱신 제외 (알림은 ${hasProductMatch ? '발송' : '없음'}): from=${email.from}, subject=${email.subject}`);
      // 제품 키워드가 매칭된 경우에만 관련 메일 알림 전송 (갱신 처리는 하지 않음)
      return {
        isRenewal: false,
        isRelated: hasProductMatch,       // 제품 키워드 매칭됐으면 알림은 보냄
        isExcluded: true,                 // 제외 키워드 플래그
        serialNumber: null,
        matchedGroups: { product: matchedProducts, action: [] },
        isDedicated: false,
      };
    }

    const productMatched = productKws.length === 0 || hasProductMatch;

    // 2. Condition 2: Action keywords (fallback to renewal_keywords if action is empty)
    const actionKws = (settings.renewal_action_keywords?.length > 0 ? settings.renewal_action_keywords : settings.renewal_keywords) || [];
    const matchedActions = actionKws.filter((kw: string) => kw.trim().length > 0 && searchText.includes(kw.toLowerCase().trim()));
    const actionMatched = actionKws.length === 0 || matchedActions.length > 0;

    // 3. Condition 3: Serial extraction
    const serialNumber = this.extractSerialNumber(email);
    const serialMatched = !!serialNumber;

    // Evaluate combined logic
    const requireSerial = settings.require_serial_format ?? true;
    const allConditionsMet = productMatched && actionMatched && (requireSerial ? serialMatched : true);

    const isRenewal = isDedicated || allConditionsMet;
    // Notify related ONLY if at least a product keyword was explicitly matched, but it failed to become a full renewal request.
    const isRelated = !isRenewal && hasProductMatch;

    return {
      isRenewal,
      isRelated,
      isExcluded: false,
      serialNumber,
      matchedGroups: { product: matchedProducts, action: matchedActions },
      isDedicated,
    };
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

  // ─── 공통: 파싱/저장 헬퍼 ───────────────────────────────────────────────────
  private async parseEmail(raw: string): Promise<ParsedEmail> {
    const parsed = await simpleParser(raw);
    const rawHeaders = raw.split(/\r?\n\r?\n/)[0] || '';

    // raw에서 특정 헤더 추출 헬퍼 (단순 추출)
    const getHeaderRaw = (name: string): string => {
      const regex = new RegExp(`^${name}:\\s*(.+)`, 'im');
      const m = rawHeaders.match(regex);
      return m ? m[1].trim() : '';
    };

    const toText = parsed.to ? (Array.isArray(parsed.to) ? parsed.to.map((a: any) => a.text || '').join(', ') : (parsed.to as any).text) : '';
    const ccText = parsed.cc ? (Array.isArray(parsed.cc) ? parsed.cc.map((a: any) => a.text || '').join(', ') : (parsed.cc as any).text) : '';

    return {
      from: parsed.from?.text || '',
      to: toText,
      cc: ccText,
      subject: parsed.subject || '',
      body: parsed.text || (typeof parsed.html === 'string' ? parsed.html : '') || '',
      date: parsed.date?.toISOString() || '',
      deliveredTo: this.getMailparserHeader(parsed, 'delivered-to') || getHeaderRaw('Delivered-To'),
      xForwardedTo: this.getMailparserHeader(parsed, 'x-forwarded-to') || getHeaderRaw('X-Forwarded-To'),
      xOriginalTo: this.getMailparserHeader(parsed, 'x-original-to') || getHeaderRaw('X-Original-To'),
      xForwardedFor: this.getMailparserHeader(parsed, 'x-forwarded-for') || getHeaderRaw('X-Forwarded-For'),
      resent_to: this.getMailparserHeader(parsed, 'resent-to') || getHeaderRaw('Resent-To'),
      xForwardedFrom: this.getMailparserHeader(parsed, 'x-forwarded-from') || getHeaderRaw('X-Forwarded-From'),
      rawHeaders,
    };
  }

  private saveCapturedEmail(email: ParsedEmail): number {
    const { getDb } = require('../database');
    const db = getDb();
    const result = db.prepare(`
      INSERT INTO captured_emails (mail_from, subject, body, received_at)
      VALUES (?, ?, ?, ?)
    `).run(
      email.from,
      email.subject,
      email.body,
      email.date || new Date().toISOString()
    );
    return result.lastInsertRowid as number;
  }
}

export const emailMonitorService = new EmailMonitorService();
