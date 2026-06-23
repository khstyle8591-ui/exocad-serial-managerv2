import nodemailer from 'nodemailer';
import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { getSettings } from '../settings';
import { logger } from '../utils/logger';
import type { AppSettings, DailyReport, MonthlyExpiryReport, SerialWithCustomer, CancelResult, LocalizedText } from '../../shared/types';

type SettingsOverride = Partial<AppSettings>;
type EffectiveSettings = ReturnType<typeof getSettings>;

const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

function cleanSettingsOverride(settingsOverride?: SettingsOverride): SettingsOverride {
  return Object.fromEntries(
    Object.entries(settingsOverride || {}).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  ) as SettingsOverride;
}

function buildSmtpFrom(settings: ReturnType<typeof getSettings>) {
  const name = (settings.smtp_from_name || 'Exocad Manager').trim();
  return settings.smtp_user ? { name, address: settings.smtp_user } : settings.smtp_host;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseModules(modulesJson: string): string[] {
  try {
    const parsed = JSON.parse(modulesJson || '[]');
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

// ─── Slack 메시지 다국어 사전 ────────────────────────────────────────────────
type SlackLang = 'ko' | 'en' | 'ja';

const S: Record<SlackLang, Record<string, string>> = {
  ko: {
    sched_mail_check: '메일체크',
    sched_auto_renew: '자동갱신',
    sched_auto_cancel: '자동취소',
    sched_limbo: 'Limbo보정',
    sched_expiry_mail: '만료예고메일',
    sched_daily_report: '일일리포트',
    sched_monthly_report: '월간리포트',
    sched_monthly_date: '매월 10일',
    sched_daily_summary: '일일요약',
    test_ok: '✅ *Exocad Manager* — Slack 연동 테스트 성공!\n이 메시지가 보이면 Webhook이 정상 작동합니다. 🎉\n전송 시각: {time}',
    daily_summary: '📊 *일일 요약 알림* — {date}',
    divider: '━━━━━━━━━━━━━━━━━━',
    prev_summary: '📝 *전일 작업 요약*',
    new_reg: '  • 신규 등록: {n}건',
    renewal: '  • 갱신 처리: {n}건',
    auto_renewal: '  • 자동 갱신: {n}건',
    manual_renewal: '  • 수동/주문 갱신: {n}건',
    cancel_done: '  • Cancel 완료: {n}건',
    cancel_fail: '  • ⚠️ Cancel 실패: {n}건',
    cancel_today: '🔴 *오늘 Cancel 예정* ({n}건)',
    cancel_none: '  (예정 없음)',
    renewal_pending: '🔄 *갱신의뢰 미처리* ({n}건)',
    renewal_none: '  (없음)',
    expiry: '만료',
    request_date: '접수',
    cancel_skipped: ' 🟡중단요청없음(skip)',
    cancel_result: '🔑 *Cancel 결과* — {serial}',
    status_ok: '✅ 성공 (검증됨: {status})',
    status_ok_unv: '✅ 성공 (미검증)',
    status_fail: '❌ 실패: {error}',
    status_label: '상태',
    screenshot: '📷 스크린샷: {file}',
    daily_report: '📊 *일일 작업 리포트* — {date}',
    monthly_report: '📋 *만료 예정 리포트* — {month}',
    monthly_total: '총 {n}건의 시리얼이 만료 예정입니다.',
    cancel_failures: '⚠️ *Cancel 실패:*',
    retry_failed: '[재시도 실패]',
    menu_button_missing: '옵션 버튼(menu-button)을 찾을 수 없습니다. 시리얼: {serial}',
    serial_not_found: '검색 결과에서 대상 시리얼을 찾지 못했습니다. 시리얼: {serial}',
    related_mail: '🔔 *관련 메일 수신 알림*\n💡 설정에 지정된 단어(`{kws}`)가 포함된 메일이 수신되었습니다.\n• 수신 시각: {time}\n• 발신자: {from}\n• 제목: {subject}\n• 내용 보기: {link}',
    scheduler_start: '🚀 *Exocad Manager 스케줄러 기동 완료*\n{details}',
  },
  en: {
    sched_mail_check: 'Mail Check',
    sched_auto_renew: 'Auto-Renew',
    sched_auto_cancel: 'Auto-Cancel',
    sched_limbo: 'Limbo Fix',
    sched_expiry_mail: 'Expiry Notice',
    sched_daily_report: 'Daily Report',
    sched_monthly_report: 'Monthly Report',
    sched_monthly_date: '10th monthly',
    sched_daily_summary: 'Daily Summary',
    test_ok: '✅ *Exocad Manager* — Slack webhook test successful!\nIf you see this message, the webhook is working. 🎉\nSent at: {time}',
    daily_summary: '📊 *Daily Summary* — {date}',
    divider: '━━━━━━━━━━━━━━━━━━',
    prev_summary: '📝 *Yesterday\'s Summary*',
    new_reg: '  • New registrations: {n}',
    renewal: '  • Renewals: {n}',
    auto_renewal: '  • Auto renewals: {n}',
    manual_renewal: '  • Manual/order renewals: {n}',
    cancel_done: '  • Cancels completed: {n}',
    cancel_fail: '  • ⚠️ Cancel failures: {n}',
    cancel_today: '🔴 *Today\'s Cancel Targets* ({n})',
    cancel_none: '  (none scheduled)',
    renewal_pending: '🔄 *Pending Renewal Requests* ({n})',
    renewal_none: '  (none)',
    expiry: 'Expiry',
    request_date: 'Received',
    cancel_skipped: ' 🟡no stop request(skip)',
    cancel_result: '🔑 *Cancel Result* — {serial}',
    status_ok: '✅ Success (verified: {status})',
    status_ok_unv: '✅ Success (unverified)',
    status_fail: '❌ Failed: {error}',
    status_label: 'Status',
    screenshot: '📷 Screenshot: {file}',
    daily_report: '📊 *Daily Work Report* — {date}',
    monthly_report: '📋 *Expiry Forecast Report* — {month}',
    monthly_total: 'A total of {n} serials are scheduled to expire.',
    cancel_failures: '⚠️ *Cancel Failures:*',
    retry_failed: '[Retry failed]',
    menu_button_missing: 'Could not find the option button (menu-button). Serial: {serial}',
    serial_not_found: 'Target serial not found in search results. Serial: {serial}',
    related_mail: '🔔 *Related Email Received*\n💡 An email containing keywords (`{kws}`) has been received.\n• Received at: {time}\n• From: {from}\n• Subject: {subject}\n• View content: {link}',
    scheduler_start: '🚀 *Exocad Manager Scheduler Started*\n{details}',
  },
  ja: {
    sched_mail_check: 'メールチェック',
    sched_auto_renew: '自動更新',
    sched_auto_cancel: '自動キャンセル',
    sched_limbo: 'Limbo補正',
    sched_expiry_mail: '失効予告メール',
    sched_daily_report: '日次レポート',
    sched_monthly_report: '月次レポート',
    sched_monthly_date: '毎月10日',
    sched_daily_summary: '日次サマリー',
    test_ok: '✅ *Exocad Manager* — Slack連携テスト成功！\nこのメッセージが見えれば、Webhookは正常に動作しています。🎉\n送信時刻: {time}',
    daily_summary: '📊 *日次サマリー* — {date}',
    divider: '━━━━━━━━━━━━━━━━━━',
    prev_summary: '📝 *前日の作業サマリー*',
    new_reg: '  • 新規登録: {n}件',
    renewal: '  • 更新処理: {n}件',
    auto_renewal: '  • 自動更新: {n}件',
    manual_renewal: '  • 手動・注文更新: {n}件',
    cancel_done: '  • キャンセル完了: {n}件',
    cancel_fail: '  • ⚠️ キャンセル失敗: {n}件',
    cancel_today: '🔴 *本日のキャンセル予定* ({n}件)',
    cancel_none: '  (予定なし)',
    renewal_pending: '🔄 *更新依頼 未処理* ({n}件)',
    renewal_none: '  (なし)',
    expiry: '有効期限',
    request_date: '受付',
    cancel_skipped: ' 🟡更新停止依頼なし(skip)',
    cancel_result: '🔑 *キャンセル結果* — {serial}',
    status_ok: '✅ 成功 (確認済: {status})',
    status_ok_unv: '✅ 成功 (未確認)',
    status_fail: '❌ 失敗: {error}',
    status_label: 'ステータス',
    screenshot: '📷 スクリーンショット: {file}',
    daily_report: '📊 *日次作業レポート* — {date}',
    monthly_report: '📋 *失効予定レポート* — {month}',
    monthly_total: '合計 {n} 件のシリアルが期限切れになる予定です。',
    cancel_failures: '⚠️ *キャンセル失敗:*',
    retry_failed: '[再試行失敗]',
    menu_button_missing: 'オプションボタン(menu-button)が見つかりません。シリアル: {serial}',
    serial_not_found: '検索結果に対象シリアルが見つかりませんでした。シリアル: {serial}',
    related_mail: '🔔 *関連メール受信通知*\n💡 指定されたキーワード（`{kws}`）が含まれるメールを受信しました。\n• 受信時刻: {time}\n• 送信者: {from}\n• 件名: {subject}\n• 内容を表示: {link}',
    scheduler_start: '🚀 *Exocad Manager スケジューラー起動完了*\n{details}',
  },
};

function normalizeSlackLang(lang: unknown): SlackLang {
  return lang === 'en' || lang === 'ja' || lang === 'ko' ? lang : 'ko';
}

function getSlackLanguage(settingsOverride?: SettingsOverride): SlackLang {
  const settings: EffectiveSettings = settingsOverride ? { ...getSettings(), ...settingsOverride } : getSettings();
  return normalizeSlackLang(settings.slack_language || settings.app_language);
}

// Slack 전용 언어 설정(slack_language)에 맞춰 슬랙 메시지 언어 반환
function slang(langOverride?: SlackLang): Record<string, string> {
  const lang = langOverride || getSlackLanguage();
  return S[lang] ?? S.ko;
}

// 사전 문자열의 {key}를 values 객체로 치환
function sf(key: string, values: Record<string, string | number> = {}, langOverride?: SlackLang): string {
  let str = slang(langOverride)[key] ?? key;
  for (const [k, v] of Object.entries(values)) {
    str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
  }
  return str;
}

function slackLocale(lang: SlackLang): string {
  return lang === 'en' ? 'en-US' : lang === 'ja' ? 'ja-JP' : 'ko-KR';
}

function localizeCancelError(error: string | undefined, lang: SlackLang): string {
  if (!error) return '';
  const serial = error.match(/시리얼:\s*([A-Za-z0-9-]+)/)?.[1]
    || error.match(/대상 시리얼\(([^)]+)\)/)?.[1]
    || error.match(/Serial:\s*([A-Za-z0-9-]+)/)?.[1]
    || error.match(/シリアル:\s*([A-Za-z0-9-]+)/)?.[1]
    || '';
  const retried = /^\[재시도 실패\]\s*/.test(error)
    || /^\[Retry failed\]\s*/.test(error)
    || /^\[再試行失敗\]\s*/.test(error);
  const retryPrefix = retried ? `${sf('retry_failed', {}, lang)} ` : '';

  if (
    error.includes('옵션 버튼(menu-button)을 찾을 수 없습니다')
    || error.includes('Could not find the option button')
    || error.includes('オプションボタン(menu-button)')
  ) {
    return `${retryPrefix}${sf('menu_button_missing', { serial }, lang)}`.trim();
  }

  if (
    error.includes('검색 결과에서 대상 시리얼')
    || error.includes('행을 찾지 못했습니다')
    || error.includes('Target serial not found')
  ) {
    return `${retryPrefix}${sf('serial_not_found', { serial }, lang)}`.trim();
  }

  return error.replace(/^\[재시도 실패\]/, sf('retry_failed', {}, lang));
}


export function buildScheduleSummary(mailTimes: string[], cancelTime: string, reportTimes: string[], expiryNoticeTime = '05:00'): string {
  return [
    `${sf('sched_mail_check')}(${mailTimes.join(', ')})`,
    `${sf('sched_auto_renew')}(00:10)`,
    `${sf('sched_auto_cancel')}(${cancelTime})`,
    `${sf('sched_limbo')}(03:00)`,
    `${sf('sched_expiry_mail')}(${expiryNoticeTime})`,
    `${sf('sched_daily_report')}(${reportTimes.join(', ')})`,
    `${sf('sched_monthly_report')}(${sf('sched_monthly_date')} 09:00)`,
    `${sf('sched_daily_summary')}(08:30)`,
  ].join(', ');
}

export class NotificationService {
  // === Slack ===
  async sendSlack(message: string, urlOverride?: string, force = false): Promise<boolean> {
    const settings = getSettings();
    if (!force && !settings.slack_enabled) {
      logger.info('Slack notifications are disabled (skip)');
      return false;
    }
    const targetUrl = urlOverride || settings.slack_webhook_url;
    if (!targetUrl) {
      logger.warn('Slack webhook URL is not configured');
      return false;
    }

    return new Promise((resolve) => {
      const url = new URL(targetUrl);
      const data = JSON.stringify({ text: message });
      const protocol = (url.protocol === 'https:' ? https : http) as typeof https;

      const req = protocol.request(
        {
          hostname: url.hostname,
          path: url.pathname + url.search,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data),
          },
        },
        (res: import('http').IncomingMessage) => {
          resolve(res.statusCode === 200);
        }
      );

      req.on('error', (err: Error) => {
        logger.error(`Slack send failed: ${err.message}`);
        resolve(false);
      });

      req.write(data);
      req.end();
    });
  }

  // === Slack Webhook 테스트 ===
  async testSlackWebhook(settingsOverride?: SettingsOverride): Promise<{ success: boolean; message: string }> {
    const webhookUrl = settingsOverride?.slack_webhook_url
      || getSettings().slack_webhook_url;

    if (!webhookUrl) {
      return { success: false, message: 'Slack Webhook URL이 입력되지 않았습니다.' };
    }

    try {
      const url = new URL(webhookUrl);
      const msgLang = getSlackLanguage(settingsOverride);
      const now = new Date().toLocaleString(slackLocale(msgLang), { timeZone: 'Asia/Tokyo' });
      const data = JSON.stringify({
        text: sf('test_ok', { time: now }, msgLang),
      });
      const protocol = (url.protocol === 'https:' ? https : http) as typeof https;

      return new Promise((resolve) => {
        const req = protocol.request(
          {
            hostname: url.hostname,
            path: url.pathname + url.search,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(data),
            },
            timeout: 10000,
          },
          (res: import('http').IncomingMessage) => {
            if (res.statusCode === 200) {
              logger.info('Slack webhook test succeeded');
              resolve({ success: true, message: 'Slack 전송 성공! 채널을 확인하세요.' });
            } else {
              logger.warn(`Slack webhook test failed: HTTP ${res.statusCode}`);
              resolve({ success: false, message: `HTTP ${res.statusCode} 오류. URL을 확인해주세요.` });
            }
          }
        );

        req.on('error', (err: Error) => {
          logger.error(`Slack webhook test error: ${err.message}`);
          resolve({ success: false, message: `연결 실패: ${err.message}` });
        });

        req.on('timeout', () => {
          req.destroy();
          resolve({ success: false, message: '연결 시간 초과 (10초)' });
        });

        req.write(data);
        req.end();
      });
    } catch (err: unknown) {
      return { success: false, message: `URL 형식 오류: ${getErrorMessage(err)}` };
    }
  }

  // === Slack Related Mail Webhook 테스트 ===
  async testSlackRelatedWebhook(settingsOverride?: SettingsOverride): Promise<{ success: boolean; message: string }> {
    const webhookUrl = settingsOverride?.slack_webhook_url_related
      || getSettings().slack_webhook_url_related;

    if (!webhookUrl) {
      return { success: false, message: '관련 메일 수신용 Slack Webhook URL이 입력되지 않았습니다.' };
    }

    try {
      const url = new URL(webhookUrl);
      const msgLang = getSlackLanguage(settingsOverride);
      const now = new Date().toLocaleString(slackLocale(msgLang), { timeZone: 'Asia/Tokyo' });
      const data = JSON.stringify({
        text: sf('test_ok', { time: now }, msgLang),
      });
      const protocol = (url.protocol === 'https:' ? https : http) as typeof https;

      return new Promise((resolve) => {
        const req = protocol.request(
          {
            hostname: url.hostname,
            path: url.pathname + url.search,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(data),
            },
            timeout: 10000,
          },
          (res: import('http').IncomingMessage) => {
            if (res.statusCode === 200) {
              logger.info('Related Slack webhook test succeeded');
              resolve({ success: true, message: 'Related Slack 전송 성공! 채널을 확인하세요.' });
            } else {
              logger.warn(`Related Slack webhook test failed: HTTP ${res.statusCode}`);
              resolve({ success: false, message: `HTTP ${res.statusCode} 오류. URL을 확인해주세요.` });
            }
          }
        );

        req.on('error', (err: Error) => {
          logger.error(`Related Slack webhook test error: ${err.message}`);
          resolve({ success: false, message: `연결 실패: ${err.message}` });
        });

        req.on('timeout', () => {
          req.destroy();
          resolve({ success: false, message: '연결 시간 초과 (10초)' });
        });

        req.write(data);
        req.end();
      });
    } catch (err: unknown) {
      return { success: false, message: `URL 형식 오류: ${getErrorMessage(err)}` };
    }
  }

  // === Slack 스크린샷 전송 (file_uploads_v2 API 준비) ===
  // Slack Webhook은 파일 업로드를 지원하지 않으므로,
  // Slack Bot Token + files.upload API를 사용해야 합니다.
  // 현재는 스크린샷 경로와 함께 텍스트 메시지를 Webhook으로 전송하고,
  // 향후 Slack Bot Token이 설정되면 이미지도 함께 전송합니다.
  async sendSlackWithScreenshot(message: string, screenshotPath: string): Promise<boolean> {
    // Phase 1: 텍스트 메시지만 Webhook으로 전송
    const textSent = await this.sendSlack(
      `${message}\n📷 스크린샷: ${screenshotPath ? path.basename(screenshotPath) : '(없음)'}`
    );

    // Phase 2: Slack Bot Token이 있으면 파일 업로드 (TODO: 향후 구현)
    // const settings = getSettings();
    // if (settings.slack_bot_token && screenshotPath && fs.existsSync(screenshotPath)) {
    //   await this.uploadFileToSlack(settings.slack_bot_token, settings.slack_channel_id, screenshotPath, message);
    // }

    return textSent;
  }

  // === Cancel 결과 Slack 전송 ===
  async sendCancelResultSlack(result: CancelResult): Promise<boolean> {
    const status = result.success
      ? (result.verified
        ? sf('status_ok', { status: result.verified_status || '' })
        : sf('status_ok_unv'))
      : sf('status_fail', { error: result.error || '' });

    const message = [
      sf('cancel_result', { serial: result.serial_number }),
      `──────────────────`,
      `${sf('status_label')}: ${status}`,
    ].join('\n');

    if (result.screenshot_path) {
      const filename = path.basename(result.screenshot_path);
      // 외부에서 접근 가능한 스크린샷 URL 생성
      // CERT_DOMAIN 환경변수 없으면 settings의 fallback 도메인을 사용
      const fallbackDomain = 'geomedi-exocad.duckdns.org';
      const domain = process.env.CERT_DOMAIN || fallbackDomain;
      const screenshotUrl = `https://${domain}/api/logs/screenshot/${encodeURIComponent(filename)}`;
      const msgWithShot = message + '\n' + sf('screenshot', { file: screenshotUrl });
      return this.sendSlack(msgWithShot);
    }
    return this.sendSlack(message);
  }

  // === 일일 요약 Slack 알림 ===
  // 매일 아침 스케줄러에서 호출
  // - 오늘 cancel 예정 시리얼 목록
  // - 갱신의뢰 접수 현황
  // - 전일 작업 요약
  async sendDailySummarySlack(summary: {
    cancelTargets: { serial_number: string; customer_name: string; expiry_date: string | null; cancel_skipped: boolean }[];
    renewalRequests: { serial_number: string; customer_name: string; request_date: string }[];
    yesterdayStats: { registered: number; autoRenewed: number; manualRenewed: number; cancelled: number; failed: number };
  }): Promise<boolean> {
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
    const lines: string[] = [
      sf('daily_summary', { date: today }),
      sf('divider'),
    ];

    const y = summary.yesterdayStats;
    lines.push(
      '\n' + sf('prev_summary'),
      sf('new_reg', { n: y.registered }),
      sf('auto_renewal', { n: y.autoRenewed }),
      sf('manual_renewal', { n: y.manualRenewed }),
      sf('cancel_done', { n: y.cancelled }),
    );
    if (y.failed > 0) lines.push(sf('cancel_fail', { n: y.failed }));

    lines.push('\n' + sf('cancel_today', { n: summary.cancelTargets.length }));
    if (summary.cancelTargets.length === 0) {
      lines.push(sf('cancel_none'));
    } else {
      for (const t of summary.cancelTargets) {
        const renewBadge = t.cancel_skipped ? sf('cancel_skipped') : '';
        lines.push(`  • ${t.serial_number} | ${t.customer_name} | ${sf('expiry')}: ${t.expiry_date}${renewBadge}`);
      }
    }

    lines.push('\n' + sf('renewal_pending', { n: summary.renewalRequests.length }));
    if (summary.renewalRequests.length === 0) {
      lines.push(sf('renewal_none'));
    } else {
      for (const r of summary.renewalRequests) {
        lines.push(`  • ${r.serial_number} | ${r.customer_name} | ${sf('request_date')}: ${r.request_date}`);
      }
    }

    return this.sendSlack(lines.join('\n'));
  }
  
  // === 스케줄러 시작 알림 ===
  async sendSchedulerStartupSlack(details: string): Promise<boolean> {
    const msg = sf('scheduler_start', { details });
    return this.sendSlack(msg);
  }

  // === 관련 메일 수신 알림 (System Log 용도) ===
  async sendRelatedMailSlack(from: string, subject: string, matchedKeywords: string[], mailId?: number, mailDate?: Date | string): Promise<boolean> {
    const kwsStr = matchedKeywords.join(', ');
    const fallbackDomain = 'geomedi-exocad.duckdns.org';
    const domain = process.env.CERT_DOMAIN || fallbackDomain;
    const baseUrl = `https://${domain}`;
    const link = mailId ? `${baseUrl}/system-logs?mailId=${mailId}` : '(시스템 로그 확인)';
    
    let timeStr = '(알 수 없음)';
    if (mailDate) {
      timeStr = new Date(mailDate).toLocaleString('ko-KR', { timeZone: 'Asia/Tokyo' });
    }

    const msg = sf('related_mail', { kws: kwsStr, time: timeStr, from, subject, link });
    const settings = getSettings();
    if (settings.slack_webhook_url_related) {
      return this.sendSlack(msg, settings.slack_webhook_url_related);
    } else {
      // fallback to main webhook if related is not set
      return this.sendSlack(msg);
    }
  }

  // === Email ===
  async sendEmail(subject: string, htmlBody: string): Promise<boolean> {
    const settings = getSettings();
    if (!settings.smtp_host || !settings.report_email_to) {
      logger.warn('SMTP settings or recipient email are not configured');
      return false;
    }

    try {
      const port = Number(settings.smtp_port) || 587;
      const useImplicitSSL = port === 465;
      const isGmailHost = (settings.smtp_host || '').toLowerCase().includes('gmail');
      // 앱 비밀번호 공백 제거
      const cleanPassword = (settings.smtp_password || '').replace(/\s+/g, '');

      const transporter = nodemailer.createTransport({
        host: settings.smtp_host,
        port,
        secure: useImplicitSSL,
        requireTLS: !useImplicitSSL && (settings.smtp_tls || isGmailHost),
        auth: {
          user: settings.smtp_user,
          pass: cleanPassword,
        },
      });

      await transporter.sendMail({
        from: buildSmtpFrom(settings),
        to: settings.report_email_to,
        subject,
        html: htmlBody,
      });

      logger.info(`Email sent: ${subject}`);
      return true;
    } catch (err: unknown) {
      logger.error(`Email send failed: ${getErrorMessage(err)}`);
      return false;
    }
  }

  private async sendEmailTo(recipients: string[], subject: string, htmlBody: string): Promise<boolean> {
    const settings = getSettings();
    const to = recipients.filter(Boolean).join(',');
    if (!settings.smtp_host || !to) {
      logger.warn('SMTP settings or emergency alert recipient email are not configured');
      return false;
    }

    try {
      const port = Number(settings.smtp_port) || 587;
      const useImplicitSSL = port === 465;
      const isGmailHost = (settings.smtp_host || '').toLowerCase().includes('gmail');
      const cleanPassword = (settings.smtp_password || '').replace(/\s+/g, '');

      const transporter = nodemailer.createTransport({
        host: settings.smtp_host,
        port,
        secure: useImplicitSSL,
        requireTLS: !useImplicitSSL && (settings.smtp_tls || isGmailHost),
        auth: settings.smtp_user ? { user: settings.smtp_user, pass: cleanPassword } : undefined,
      });

      await transporter.sendMail({
        from: buildSmtpFrom(settings),
        to,
        subject,
        html: htmlBody,
      });
      return true;
    } catch (err: unknown) {
      logger.error(`Emergency email send failed: ${getErrorMessage(err)}`);
      return false;
    }
  }

  async sendCriticalAutomationAlert(input: {
    serial_number: string;
    customer_name?: string;
    action: string | LocalizedText;
    error?: string | LocalizedText;
    details: string | LocalizedText;
    trigger_id: string;
  }): Promise<void> {
    const settings = getSettings();

    // 언어별 메시지 해석 헬퍼: 문자열은 그대로, LocalizedText는 해당 언어로
    const pick = (v: string | LocalizedText | undefined, lang: SlackLang): string => {
      if (v == null) return '';
      return typeof v === 'string' ? v : (v[lang] ?? v.ko);
    };

    // 알림 본문 생성 — error는 localizeCancelError로 알려진 Playwright 오류를 해당 언어로 변환
    const buildText = (lang: SlackLang): string => {
      const rawErr = pick(input.error, lang);
      const err = rawErr ? localizeCancelError(rawErr, lang) : '';
      return [
        '*CRITICAL automation alert*',
        `Serial: ${input.serial_number}`,
        input.customer_name ? `Customer: ${input.customer_name}` : '',
        `Action: ${pick(input.action, lang)}`,
        `Trigger: ${input.trigger_id}`,
        err ? `Error: ${err}` : '',
        '',
        pick(input.details, lang),
      ].filter(Boolean).join('\n');
    };

    const tasks: Promise<unknown>[] = [];

    // Slack — slack_language 설정 기준
    if (settings.slack_alert_enabled !== false) {
      const slackLang = getSlackLanguage();
      tasks.push(this.sendSlack(buildText(slackLang), undefined, true));
    }

    // Email — 매니저 앱 언어(app_language) 기준
    const recipients = settings.critical_alert_emails?.length
      ? settings.critical_alert_emails
      : (settings.report_email_to ? [settings.report_email_to] : []);
    if (recipients.length > 0) {
      const appLang = normalizeSlackLang(settings.app_language);
      const subject = `[Exocad Manager][CRITICAL] ${pick(input.action, appLang)} - ${input.serial_number}`;
      const emailText = buildText(appLang);
      const html = emailText.split('\n').map(line => `<div>${line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>`).join('');
      tasks.push(this.sendEmailTo(recipients, subject, html));
    }

    await Promise.all(tasks);
  }

  async sendAutoRenewalOrderNotice(input: {
    serial: SerialWithCustomer;
    previous_expiry_date: string | null;
    renewed_at?: Date;
    source?: 'auto' | 'manual';
  }): Promise<{ success: boolean; subject: string; html_body: string; recipient_email: string; message: string }> {
    const settings = getSettings();
    const modules = parseModules(input.serial.modules);
    const moduleText = modules.join(', ') || '-';
    const renewedAt = (input.renewed_at ?? new Date()).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
    const isManual = input.source === 'manual';
    const subject = isManual
      ? `[Exocad Manager] 更新注文書 (手動) - ${input.serial.serial_number}`
      : `[Exocad Manager] 自動更新注文書 - ${input.serial.serial_number}`;
    const html = `
      <h2>${isManual ? '更新注文書（手動更新）' : '自動更新注文書'}</h2>
      <p>以下のシリアルが${isManual ? '手動で更新処理されました。' : '自動更新処理されました。'}</p>
      <table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse;">
        <tr><td><strong>シリアル番号</strong></td><td>${escapeHtml(input.serial.serial_number)}</td></tr>
        <tr><td><strong>顧客名</strong></td><td>${escapeHtml(input.serial.customer?.name || '')}</td></tr>
        <tr><td><strong>顧客メール</strong></td><td>${escapeHtml(input.serial.customer?.email || '')}</td></tr>
        <tr><td><strong>メイン製品</strong></td><td>${escapeHtml(input.serial.main_product || '')}</td></tr>
        <tr><td><strong>モジュール</strong></td><td>${escapeHtml(moduleText)}</td></tr>
        <tr><td><strong>更新前の有効期限</strong></td><td>${escapeHtml(input.previous_expiry_date || '-')}</td></tr>
        <tr><td><strong>更新後の有効期限</strong></td><td>${escapeHtml(input.serial.expiry_date || '')}</td></tr>
        <tr><td><strong>処理時刻</strong></td><td>${escapeHtml(renewedAt)}</td></tr>
      </table>
    `;
    const recipientEmail = settings.report_email_to || '';

    const success = await this.sendEmail(subject, html);
    return {
      success,
      subject,
      html_body: html,
      recipient_email: recipientEmail,
      message: success ? 'メール送信成功' : 'メール送信失敗',
    };
  }

  // === Test Connection (SMTP) ===
  async testSmtpConnection(settingsOverride?: SettingsOverride): Promise<{ success: boolean; message: string }> {
    // settingsOverride에 undefined 값이 있으면 DB 저장값을 덮어쓰는 버그 방지
    // undefined/null 제거 후 병합
    const settings: EffectiveSettings = { ...getSettings(), ...cleanSettingsOverride(settingsOverride) };

    // 로그: 어떤 값으로 테스트하는지 확인 (비밀번호는 마스킹)
    logger.info(`SMTP 테스트 - host: ${settings.smtp_host}, port: ${settings.smtp_port}, user: ${settings.smtp_user}, hasPassword: ${!!settings.smtp_password}`);

    if (!settings.smtp_host) {
      return { success: false, message: 'SMTP 서버 주소를 입력해주세요.' };
    }
    if (!settings.smtp_user) {
      return { success: false, message: 'SMTP 사용자명(이메일)을 입력해주세요.' };
    }
    if (!settings.smtp_password) {
      return { success: false, message: 'SMTP 비밀번호 또는 앱 비밀번호를 입력해주세요.' };
    }
    if (!settings.report_email_to) {
      return { success: false, message: '리포트 수신 이메일을 입력해주세요.' };
    }
    const parsedPort = Number(settings.smtp_port);
    if (!settings.smtp_port || isNaN(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
      return { success: false, message: `SMTP 포트가 올바르지 않습니다: "${settings.smtp_port}" (유효 범위: 1–65535)` };
    }

    try {
      logger.info(`SMTP connection test started: ${settings.smtp_host}:${settings.smtp_port}`);
      const port = parsedPort;
      const useImplicitSSL = port === 465;
      const isGmailHost = (settings.smtp_host || '').toLowerCase().includes('gmail');

      // 앱 비밀번호 공백 제거 (Google App Password는 'xxxx xxxx xxxx xxxx' 형태로 복붙되는 경우 있음)
      const cleanPassword = (settings.smtp_password || '').replace(/\s+/g, '');

      const transporter = nodemailer.createTransport({
        host: settings.smtp_host,
        port,
        secure: useImplicitSSL,
        // Gmail port 587 사용 시 STARTTLS 강제 (requireTLS: true)
        requireTLS: !useImplicitSSL && (settings.smtp_tls || isGmailHost),
        auth: {
          user: settings.smtp_user,
          pass: cleanPassword,
        },
        connectionTimeout: 15000,
      });

      // Verify connection configuration
      await transporter.verify();

      // Send a test email
      await transporter.sendMail({
        from: buildSmtpFrom(settings),
        to: settings.report_email_to,
        subject: '[Exocad Manager] SMTP 설정 테스트',
        text: '이 이메일은 Exocad Manager 애플리케이션에서 SMTP 설정이 정상인지 확인하기 위해 발송된 테스트 메일입니다.',
        html: '<p>이 이메일은 <strong>Exocad Manager</strong> 애플리케이션에서 SMTP 설정이 정상인지 확인하기 위해 발송된 테스트 메일입니다.</p>',
      });

      logger.info('SMTP connection test succeeded and test email sent');
      return { success: true, message: 'SMTP 연결 성공 및 테스트 메일 발송 완료' };
    } catch (err: unknown) {
      const msg = getErrorMessage(err);
      logger.error(`SMTP connection test error: ${msg}`);

      // Gmail 530 / 535 인증 오류 → App Password 안내
      if (
        msg.includes('535') || msg.includes('530') ||
        msg.includes('Authentication') || msg.includes('Username and Password not accepted')
      ) {
        const isGmail = (settings.smtp_host || '').toLowerCase().includes('gmail');
        if (isGmail) {
          return {
            success: false,
            message:
              '❌ Gmail 인증 실패 (530/535)\n\n' +
              '✅ 해결 방법: Gmail 계정의 일반 비밀번호 대신 "앱 비밀번호(App Password)"를 사용해야 합니다.\n\n' +
              '📌 앱 비밀번호 생성 방법:\n' +
              '1. Google 계정 → 보안 → 2단계 인증 활성화 필수\n' +
              '2. 보안 → 앱 비밀번호 → "기타(사용자 지정)" 선택\n' +
              '3. 생성된 16자리 비밀번호를 SMTP Password에 입력\n\n' +
              '🔗 https://myaccount.google.com/apppasswords',
          };
        }
        return {
          success: false,
          message:
            `❌ SMTP 인증 실패: ${msg}\n\n` +
            '비밀번호 또는 계정 설정을 확인하세요. Gmail 사용 시 앱 비밀번호가 필요합니다.',
        };
      }

      return { success: false, message: `테스트 실패: ${msg}` };
    }
  }

  // === Daily Report ===
  async sendDailyReport(report: DailyReport): Promise<void> {
    const slackMsg = this.formatDailyReportSlack(report);
    const emailHtml = this.formatDailyReportEmail(report);

    await Promise.all([
      this.sendSlack(slackMsg),
      this.sendEmail(`[Exocad Manager] 日次レポート - ${report.date}`, emailHtml),
    ]);
  }

  private formatDailyReportSlack(report: DailyReport): string {
    const lang = getSlackLanguage();
    const lines = [
      sf('daily_report', { date: report.date }, lang),
      sf('divider', {}, lang),
      sf('new_reg', { n: report.new_registrations }, lang),
      sf('auto_renewal', { n: report.auto_renewals ?? report.renewals }, lang),
      sf('manual_renewal', { n: report.manual_renewals ?? 0 }, lang),
      sf('cancel_done', { n: report.cancellations }, lang),
    ];

    if (report.failed_cancellations.length > 0) {
      lines.push('\n' + sf('cancel_failures', {}, lang));
      for (const f of report.failed_cancellations) {
        lines.push(`  • ${f.serial_number}: ${localizeCancelError(f.error, lang)}`);
      }
    }

    return lines.join('\n');
  }

  private formatDailyReportEmail(report: DailyReport): string {
    let html = `
      <h2>日次作業レポート - ${report.date}</h2>
      <table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse;">
        <tr><td><strong>新規登録</strong></td><td>${report.new_registrations}件</td></tr>
        <tr><td><strong>自動更新</strong></td><td>${report.auto_renewals ?? report.renewals}件</td></tr>
        <tr><td><strong>手動・注文更新</strong></td><td>${report.manual_renewals ?? 0}件</td></tr>
        <tr><td><strong>キャンセル</strong></td><td>${report.cancellations}件</td></tr>
      </table>
    `;

    if (report.failed_cancellations.length > 0) {
      html += `<h3>キャンセル失敗リスト</h3><ul>`;
      for (const f of report.failed_cancellations) {
        html += `<li>${f.serial_number}: ${f.error}</li>`;
      }
      html += `</ul>`;
    }

    if (report.details.length > 0) {
      html += `<h3>詳細ログ</h3><table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;">
        <tr><th>時刻</th><th>作業</th><th>詳細</th></tr>`;
      for (const log of report.details) {
        html += `<tr><td>${log.created_at}</td><td>${log.action}</td><td>${log.details}</td></tr>`;
      }
      html += `</table>`;
    }

    return html;
  }

  // === Monthly Expiry Report ===
  async sendMonthlyExpiryReport(report: MonthlyExpiryReport): Promise<void> {
    const slackMsg = this.formatMonthlyReportSlack(report);
    const emailHtml = this.formatMonthlyReportEmail(report);

    await Promise.all([
      this.sendSlack(slackMsg),
      this.sendEmail(`[Exocad Manager] 失効予定レポート - ${report.target_month}`, emailHtml),
    ]);
  }

  private formatMonthlyReportSlack(report: MonthlyExpiryReport): string {
    const lines = [
      sf('monthly_report', { month: report.target_month }),
      sf('divider'),
      sf('monthly_total', { n: report.total_count }),
      '',
    ];

    for (const s of report.expiring_serials) {
      const modules = JSON.parse(s.modules || '[]') as string[];
      const addonStr = modules.length > 0 ? ` (Add-ons: ${modules.join(', ')})` : '';
      lines.push(`• ${s.serial_number} | ${s.customer?.name || ''} | ${sf('expiry')}: ${s.expiry_date}${addonStr}`);
    }

    return lines.join('\n');
  }

  private formatMonthlyReportEmail(report: MonthlyExpiryReport): string {
    let html = `
      <h2>失効予定レポート - ${report.target_month}</h2>
      <p>合計 <strong>${report.total_count}</strong>件のシリアルが失効予定です。</p>
      <table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse;">
        <tr>
          <th>シリアル番号</th><th>顧客名</th><th>メール</th>
          <th>有効期限</th><th>Add-ons</th><th>備考</th>
        </tr>
    `;

    for (const s of report.expiring_serials) {
      const modules = JSON.parse(s.modules || '[]') as string[];
      const addonStr = modules.join(', ') || '-';
      html += `
        <tr>
          <td>${s.serial_number}</td>
          <td>${s.customer?.name || ''}</td>
          <td>${s.customer?.email || ''}</td>
          <td>${s.expiry_date}</td>
          <td>${addonStr}</td>
          <td>${s.notes}</td>
        </tr>
      `;
    }

    html += `</table>`;
    return html;
  }
}

export const notificationService = new NotificationService();
