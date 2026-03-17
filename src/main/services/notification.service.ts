import nodemailer from 'nodemailer';
import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { getSettings } from '../settings';
import { logger } from '../utils/logger';
import type { DailyReport, MonthlyExpiryReport, Serial, CancelResult } from '../../shared/types';

// ─── Slack 메시지 다국어 사전 ────────────────────────────────────────────────
type SlackLang = 'ko' | 'en' | 'ja';

const S: Record<SlackLang, Record<string, string>> = {
  ko: {
    test_ok: '✅ *Exocad Manager* — Slack 연동 테스트 성공!\n이 메시지가 보이면 Webhook이 정상 작동합니다. 🎉\n전송 시각: {time}',
    daily_summary: '📊 *일일 요약 알림* — {date}',
    divider: '━━━━━━━━━━━━━━━━━━',
    prev_summary: '📝 *전일 작업 요약*',
    new_reg: '  • 신규 등록: {n}건',
    renewal: '  • 갱신 처리: {n}건',
    cancel_done: '  • Cancel 완료: {n}건',
    cancel_fail: '  • ⚠️ Cancel 실패: {n}건',
    cancel_today: '🔴 *오늘 Cancel 예정* ({n}건)',
    cancel_none: '  (예정 없음)',
    renewal_pending: '🔄 *갱신의뢰 미처리* ({n}건)',
    renewal_none: '  (없음)',
    expiry: '만료',
    request_date: '접수',
    has_renewal: ' 🟡갱신요청있음(skip)',
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
    related_mail: '🔔 *관련 메일 수신 알림*\n💡 설정에 지정된 단어(`{kws}`)가 포함된 메일이 수신되었습니다.\n• 발신자: {from}\n• 제목: {subject}\n• 내용 보기: {link}',
    scheduler_start: '🚀 *Exocad Manager 스케줄러 기동 완료*\n{details}',
  },
  en: {
    test_ok: '✅ *Exocad Manager* — Slack webhook test successful!\nIf you see this message, the webhook is working. 🎉\nSent at: {time}',
    daily_summary: '📊 *Daily Summary* — {date}',
    divider: '━━━━━━━━━━━━━━━━━━',
    prev_summary: '📝 *Yesterday\'s Summary*',
    new_reg: '  • New registrations: {n}',
    renewal: '  • Renewals: {n}',
    cancel_done: '  • Cancels completed: {n}',
    cancel_fail: '  • ⚠️ Cancel failures: {n}',
    cancel_today: '🔴 *Today\'s Cancel Targets* ({n})',
    cancel_none: '  (none scheduled)',
    renewal_pending: '🔄 *Pending Renewal Requests* ({n})',
    renewal_none: '  (none)',
    expiry: 'Expiry',
    request_date: 'Received',
    has_renewal: ' 🟡has renewal(skip)',
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
    related_mail: '🔔 *Related Email Received*\n💡 An email containing keywords (`{kws}`) has been received.\n• From: {from}\n• Subject: {subject}\n• View content: {link}',
    scheduler_start: '🚀 *Exocad Manager Scheduler Started*\n{details}',
  },
  ja: {
    test_ok: '✅ *Exocad Manager* — Slack連携テスト成功！\nこのメッセージが見えれば、Webhookは正常に動作しています。🎉\n送信時刻: {time}',
    daily_summary: '📊 *日次サマリー* — {date}',
    divider: '━━━━━━━━━━━━━━━━━━',
    prev_summary: '📝 *前日の作業サマリー*',
    new_reg: '  • 新規登録: {n}件',
    renewal: '  • 更新処理: {n}件',
    cancel_done: '  • キャンセル完了: {n}件',
    cancel_fail: '  • ⚠️ キャンセル失敗: {n}件',
    cancel_today: '🔴 *本日のキャンセル予定* ({n}件)',
    cancel_none: '  (予定なし)',
    renewal_pending: '🔄 *更新依頼 未処理* ({n}件)',
    renewal_none: '  (なし)',
    expiry: '有効期限',
    request_date: '受付',
    has_renewal: ' 🟡更新依頼あり(skip)',
    cancel_result: '🔑 *キャンセル結果* — {serial}',
    status_ok: '✅ 成功 (確認済: {status})',
    status_ok_unv: '✅ 成功 (未確認)',
    status_fail: '❌ 失敗: {error}',
    status_label: 'ステータス',
    screenshot: '📷 スクリーンショット: {file}',
    daily_report: '📊 *日次作業レポート* — {date}',
    monthly_report: '📋 *失効予定レポート* — {month}',
    monthly_total: '合計 {n} 件のシリアルが期限切れになる予定です。',
    cancel_failures: '⚠️ *Cancel 失敗:*',
    related_mail: '🔔 *関連メール受信通知*\n💡 指定されたキーワード（`{kws}`）が含まれるメールを受信しました。\n• 送信者: {from}\n• 件名: {subject}\n• 内容を表示: {link}',
  },
};

// 현재 설정의 slack_language를 읽어 해당 언어 사전 반환
function slang(): Record<string, string> {
  const lang = (getSettings().slack_language || 'ko') as SlackLang;
  return S[lang] ?? S.ko;
}

// 사전 문자열의 {key}를 values 객체로 치환
function sf(key: string, values: Record<string, string | number> = {}): string {
  let str = slang()[key] ?? key;
  for (const [k, v] of Object.entries(values)) {
    str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
  }
  return str;
}


export class NotificationService {
  // === Slack ===
  async sendSlack(message: string, urlOverride?: string): Promise<boolean> {
    const settings = getSettings();
    if (!settings.slack_enabled) {
      logger.info('Slack 알림이 비활성화되어 있습니다 (skip)');
      return false;
    }
    const targetUrl = urlOverride || settings.slack_webhook_url;
    if (!targetUrl) {
      logger.warn('Slack webhook URL이 설정되지 않았습니다');
      return false;
    }

    return new Promise((resolve) => {
      const url = new URL(targetUrl);
      const data = JSON.stringify({ text: message });
      const protocol = url.protocol === 'https:' ? https : http;

      const req = protocol.request(
        {
          hostname: url.hostname,
          path: url.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data),
          },
        },
        (res) => {
          resolve(res.statusCode === 200);
        }
      );

      req.on('error', (err) => {
        logger.error(`Slack 전송 실패: ${err.message}`);
        resolve(false);
      });

      req.write(data);
      req.end();
    });
  }

  // === Slack Webhook 테스트 ===
  async testSlackWebhook(settingsOverride?: any): Promise<{ success: boolean; message: string }> {
    const webhookUrl = settingsOverride?.slack_webhook_url
      || getSettings().slack_webhook_url;

    if (!webhookUrl) {
      return { success: false, message: 'Slack Webhook URL이 입력되지 않았습니다.' };
    }

    try {
      const url = new URL(webhookUrl);
      const now = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
      const data = JSON.stringify({
        text: sf('test_ok', { time: now }),
      });
      const protocol = url.protocol === 'https:' ? https : http;

      return new Promise((resolve) => {
        const req = protocol.request(
          {
            hostname: url.hostname,
            path: url.pathname,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(data),
            },
            timeout: 10000,
          },
          (res) => {
            if (res.statusCode === 200) {
              logger.info('Slack Webhook 테스트 성공');
              resolve({ success: true, message: 'Slack 전송 성공! 채널을 확인하세요.' });
            } else {
              logger.warn(`Slack Webhook 테스트 실패: HTTP ${res.statusCode}`);
              resolve({ success: false, message: `HTTP ${res.statusCode} 오류. URL을 확인해주세요.` });
            }
          }
        );

        req.on('error', (err) => {
          logger.error(`Slack Webhook 테스트 오류: ${err.message}`);
          resolve({ success: false, message: `연결 실패: ${err.message}` });
        });

        req.on('timeout', () => {
          req.destroy();
          resolve({ success: false, message: '연결 시간 초과 (10초)' });
        });

        req.write(data);
        req.end();
      });
    } catch (err: any) {
      return { success: false, message: `URL 형식 오류: ${err.message}` };
    }
  }

  // === Slack Related Mail Webhook 테스트 ===
  async testSlackRelatedWebhook(settingsOverride?: any): Promise<{ success: boolean; message: string }> {
    const webhookUrl = settingsOverride?.slack_webhook_url_related
      || getSettings().slack_webhook_url_related;

    if (!webhookUrl) {
      return { success: false, message: '관련 메일 수신용 Slack Webhook URL이 입력되지 않았습니다.' };
    }

    try {
      const url = new URL(webhookUrl);
      const now = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
      const data = JSON.stringify({
        text: sf('test_ok', { time: now }),
      });
      const protocol = url.protocol === 'https:' ? https : http;

      return new Promise((resolve) => {
        const req = protocol.request(
          {
            hostname: url.hostname,
            path: url.pathname,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(data),
            },
            timeout: 10000,
          },
          (res) => {
            if (res.statusCode === 200) {
              logger.info('Related Slack Webhook 테스트 성공');
              resolve({ success: true, message: 'Related Slack 전송 성공! 채널을 확인하세요.' });
            } else {
              logger.warn(`Related Slack Webhook 테스트 실패: HTTP ${res.statusCode}`);
              resolve({ success: false, message: `HTTP ${res.statusCode} 오류. URL을 확인해주세요.` });
            }
          }
        );

        req.on('error', (err) => {
          logger.error(`Related Slack Webhook 테스트 오류: ${err.message}`);
          resolve({ success: false, message: `연결 실패: ${err.message}` });
        });

        req.on('timeout', () => {
          req.destroy();
          resolve({ success: false, message: '연결 시간 초과 (10초)' });
        });

        req.write(data);
        req.end();
      });
    } catch (err: any) {
      return { success: false, message: `URL 형식 오류: ${err.message}` };
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
      const msgWithShot = message + '\n' + sf('screenshot', { file: path.basename(result.screenshot_path) });
      return this.sendSlackWithScreenshot(msgWithShot, result.screenshot_path);
    }
    return this.sendSlack(message);
  }

  // === 일일 요약 Slack 알림 ===
  // 매일 아침 스케줄러에서 호출
  // - 오늘 cancel 예정 시리얼 목록
  // - 갱신의뢰 접수 현황
  // - 전일 작업 요약
  async sendDailySummarySlack(summary: {
    cancelTargets: { serial_number: string; customer_name: string; expiry_date: string | null; has_renewal: boolean }[];
    renewalRequests: { serial_number: string; customer_name: string; request_date: string }[];
    yesterdayStats: { registered: number; renewed: number; cancelled: number; failed: number };
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
      sf('renewal', { n: y.renewed }),
      sf('cancel_done', { n: y.cancelled }),
    );
    if (y.failed > 0) lines.push(sf('cancel_fail', { n: y.failed }));

    lines.push('\n' + sf('cancel_today', { n: summary.cancelTargets.length }));
    if (summary.cancelTargets.length === 0) {
      lines.push(sf('cancel_none'));
    } else {
      for (const t of summary.cancelTargets) {
        const renewBadge = t.has_renewal ? sf('has_renewal') : '';
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
  async sendRelatedMailSlack(from: string, subject: string, matchedKeywords: string[], mailId?: number): Promise<boolean> {
    const kwsStr = matchedKeywords.join(', ');
    const baseUrl = process.env.CERT_DOMAIN ? `https://${process.env.CERT_DOMAIN}` : 'http://localhost:3000';
    const link = mailId ? `${baseUrl}/system-logs?mailId=${mailId}` : '(시스템 로그 확인)';
    
    const msg = sf('related_mail', { kws: kwsStr, from, subject, link });
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
      logger.warn('SMTP 설정 또는 수신 이메일이 설정되지 않았습니다');
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
        from: settings.smtp_user ? `Exocad Manager <${settings.smtp_user}>` : settings.smtp_host,
        to: settings.report_email_to,
        subject,
        html: htmlBody,
      });

      logger.info(`이메일 전송 완료: ${subject}`);
      return true;
    } catch (err: any) {
      logger.error(`이메일 전송 실패: ${err.message}`);
      return false;
    }
  }

  // === Test Connection (SMTP) ===
  async testSmtpConnection(settingsOverride?: any): Promise<{ success: boolean; message: string }> {
    // settingsOverride에 undefined 값이 있으면 DB 저장값을 덮어쓰는 버그 방지
    // undefined/null 제거 후 병합
    const cleanOverride = Object.fromEntries(
      Object.entries(settingsOverride || {}).filter(([, v]) => v !== undefined && v !== null && v !== '')
    );
    const settings = { ...getSettings(), ...cleanOverride };

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

    try {
      logger.info(`SMTP 연결 테스트 시작: ${settings.smtp_host}:${settings.smtp_port}`);
      const port = Number(settings.smtp_port) || 587;
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
        from: settings.smtp_user,
        to: settings.report_email_to,
        subject: '[Exocad Manager] SMTP 설정 테스트',
        text: '이 이메일은 Exocad Manager 애플리케이션에서 SMTP 설정이 정상인지 확인하기 위해 발송된 테스트 메일입니다.',
        html: '<p>이 이메일은 <strong>Exocad Manager</strong> 애플리케이션에서 SMTP 설정이 정상인지 확인하기 위해 발송된 테스트 메일입니다.</p>',
      });

      logger.info('SMTP 연결 테스트 성공 및 테스트 메일 발송 완료');
      return { success: true, message: 'SMTP 연결 성공 및 테스트 메일 발송 완료' };
    } catch (err: any) {
      logger.error(`SMTP 연결 테스트 오류: ${err.message}`);

      // Gmail 530 / 535 인증 오류 → App Password 안내
      const msg: string = err.message || '';
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
      this.sendEmail(`[Exocad Manager] 일일 리포트 - ${report.date}`, emailHtml),
    ]);
  }

  private formatDailyReportSlack(report: DailyReport): string {
    const lines = [
      sf('daily_report', { date: report.date }),
      sf('divider'),
      sf('new_reg', { n: report.new_registrations }),
      sf('renewal', { n: report.renewals }),
      sf('cancel_done', { n: report.cancellations }),
    ];

    if (report.failed_cancellations.length > 0) {
      lines.push('\n' + sf('cancel_failures'));
      for (const f of report.failed_cancellations) {
        lines.push(`  • ${f.serial_number}: ${f.error}`);
      }
    }

    return lines.join('\n');
  }

  private formatDailyReportEmail(report: DailyReport): string {
    let html = `
      <h2>일일 작업 리포트 - ${report.date}</h2>
      <table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse;">
        <tr><td><strong>신규 등록</strong></td><td>${report.new_registrations}건</td></tr>
        <tr><td><strong>갱신</strong></td><td>${report.renewals}건</td></tr>
        <tr><td><strong>Cancel</strong></td><td>${report.cancellations}건</td></tr>
      </table>
    `;

    if (report.failed_cancellations.length > 0) {
      html += `<h3>Cancel 실패 목록</h3><ul>`;
      for (const f of report.failed_cancellations) {
        html += `<li>${f.serial_number}: ${f.error}</li>`;
      }
      html += `</ul>`;
    }

    if (report.details.length > 0) {
      html += `<h3>상세 로그</h3><table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;">
        <tr><th>시간</th><th>작업</th><th>상세</th></tr>`;
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
      this.sendEmail(`[Exocad Manager] 만료 예정 리포트 - ${report.target_month}`, emailHtml),
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
      const addOns = JSON.parse(s.add_ons);
      const addonStr = addOns.length > 0 ? ` (Add-ons: ${addOns.map((a: any) => a.name).join(', ')})` : '';
      lines.push(`• ${s.serial_number} | ${s.customer_name} | ${sf('expiry')}: ${s.expiry_date}${addonStr}`);
    }

    return lines.join('\n');
  }

  private formatMonthlyReportEmail(report: MonthlyExpiryReport): string {
    let html = `
      <h2>만료 예정 리포트 - ${report.target_month}</h2>
      <p>총 <strong>${report.total_count}</strong>건의 시리얼이 만료 예정입니다.</p>
      <table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse;">
        <tr>
          <th>시리얼 넘버</th><th>고객명</th><th>이메일</th>
          <th>만료일</th><th>Add-ons</th><th>비고</th>
        </tr>
    `;

    for (const s of report.expiring_serials) {
      const addOns = JSON.parse(s.add_ons);
      const addonStr = addOns.map((a: any) => a.name).join(', ') || '-';
      html += `
        <tr>
          <td>${s.serial_number}</td>
          <td>${s.customer_name}</td>
          <td>${s.customer_email}</td>
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
