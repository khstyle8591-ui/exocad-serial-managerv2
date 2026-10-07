/**
 * sent-mail-log.service.ts
 *
 * 발송(outbound) 메일 통합 로그. 템플릿 메일(sendTemplate)과 시스템 메일
 * (리포트/치명적 알림)을 모두 sent_mails 테이블에 기록·조회한다.
 * 신규 발송분부터 쌓인다(과거 데이터 마이그레이션 없음).
 */

import { getDb } from '../database';
import { getNowTimestampString } from '../utils/date-utils';
import type { SentMail, SentMailFilter } from '../../shared/types';

export interface RecordSentMailInput {
  template_code: string;
  to: string;
  subject?: string;
  body_html?: string;
  reason?: string;
  actor?: string;
  serial_id?: number | null;
  status: SentMail['status'];
  error?: string;
}

/**
 * 발송 메일 1건 기록. 기록 실패가 메일 발송 흐름을 깨지 않도록 호출부에서 예외를 삼킨다.
 */
export function recordSentMail(input: RecordSentMailInput): number {
  const result = getDb()
    .prepare(`
      INSERT INTO sent_mails
        (template_code, to_addr, subject, body_html, reason, actor, serial_id, status, error, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      input.template_code || '',
      input.to || '',
      input.subject || '',
      input.body_html || '',
      input.reason || '',
      input.actor || 'system',
      input.serial_id ?? null,
      input.status,
      input.error || '',
      getNowTimestampString(),
    );
  return result.lastInsertRowid as number;
}

/**
 * 발송 메일 목록 조회(최신순). 본문(body_html)은 목록에서 제외해 응답 크기를 줄이고,
 * 상세 미리보기는 getSentMail(id)로 따로 가져온다.
 */
export function listSentMails(filter: SentMailFilter = {}): Omit<SentMail, 'body_html'>[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (filter.template_code) {
    conditions.push('template_code = ?');
    params.push(filter.template_code);
  }
  if (filter.status) {
    conditions.push('status = ?');
    params.push(filter.status);
  }
  if (filter.date_from) {
    conditions.push('date(created_at) >= date(?)');
    params.push(filter.date_from);
  }
  if (filter.date_to) {
    conditions.push('date(created_at) <= date(?)');
    params.push(filter.date_to);
  }
  if (filter.q) {
    conditions.push('to_addr LIKE ?');
    params.push(`%${filter.q}%`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.min(filter.limit ?? 200, 500);
  const offset = filter.offset ?? 0;

  return db
    .prepare(`
      SELECT id, template_code, to_addr, subject, reason, actor, serial_id, status, error, created_at
      FROM sent_mails
      ${where}
      ORDER BY datetime(created_at) DESC, id DESC
      LIMIT ? OFFSET ?
    `)
    .all(...params, limit, offset) as Omit<SentMail, 'body_html'>[];
}

/** 단건 상세(본문 포함) — 미리보기 모달용. */
export function getSentMail(id: number): SentMail | undefined {
  return getDb()
    .prepare('SELECT * FROM sent_mails WHERE id = ?')
    .get(id) as SentMail | undefined;
}

/** 보관기간 초과 발송 로그 정리(activity_logs 정리와 동일 패턴). */
export function deleteOldSentMails(keepDays = 180): number {
  const result = getDb()
    .prepare("DELETE FROM sent_mails WHERE datetime(created_at) < datetime('now','localtime', ?)")
    .run(`-${keepDays} days`);
  return result.changes;
}
