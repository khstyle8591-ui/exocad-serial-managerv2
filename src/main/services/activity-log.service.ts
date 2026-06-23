/**
 * activity-log.service.ts
 *
 * Typed activity logger for activity_logs table.
 * After every INSERT, pushes a `logs:push` IPC event to all open renderer windows
 * so the Logs page can poll for the new entry without full polling.
 */

import { BrowserWindow } from 'electron';
import { getDb } from '../database';
import { getNowTimestampString } from '../utils/date-utils';
import { getSettings } from '../settings';
import type { ActivityLog, LogFilter, LocalizedText } from '../../shared/types';

/**
 * 매니저 앱 설정 언어(app_language)에 맞는 문자열을 반환.
 * activity_logs.details 등 매니저에게 표시되는 로그 문구를 다국어로 기록할 때 사용.
 */
export function pickLang(text: LocalizedText): string {
  const lang = getSettings().app_language;
  return text[lang] ?? text.ko;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LogInput {
  serial_id?: number | null;
  action: ActivityLog['action'];
  actor: ActivityLog['actor'];
  diff?: Record<string, unknown>;   // {field: [old, new]}
  details?: string;
  trigger_id?: string | null;
  severity?: ActivityLog['severity'];
}

// ── Core write ────────────────────────────────────────────────────────────────

/**
 * Insert an activity log entry and push `logs:push` to renderer windows.
 */
export function logActivity(input: LogInput): number {
  const db = getDb();
  const result = db
    .prepare(
      `INSERT INTO activity_logs
         (serial_id, action, actor, diff, details, trigger_id, severity, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.serial_id ?? null,
      input.action,
      input.actor,
      JSON.stringify(input.diff ?? {}),
      input.details ?? '',
      input.trigger_id ?? null,
      input.severity ?? 'info',
      getNowTimestampString()
    );

  const id = result.lastInsertRowid as number;
  pushLogEvent(id);
  return id;
}

/** Push logs:push event to all open BrowserWindow instances. */
function pushLogEvent(id: number): void {
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('logs:push', { id });
      }
    }
  } catch {
    // Silently ignore — renderer may not be ready yet (e.g., during startup)
  }
}

// ── Read ──────────────────────────────────────────────────────────────────────

/**
 * Query activity_logs with optional filters.
 */
export function listLogs(filter: LogFilter = {}): ActivityLog[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (filter.date_from) {
    conditions.push("date(created_at) >= date(?)");
    params.push(filter.date_from);
  }
  if (filter.date_to) {
    conditions.push("date(created_at) <= date(?)");
    params.push(filter.date_to);
  }
  if (filter.actions && filter.actions.length > 0) {
    conditions.push(`action IN (${filter.actions.map(() => '?').join(',')})`);
    params.push(...filter.actions);
  }
  if (filter.actors && filter.actors.length > 0) {
    conditions.push(`actor IN (${filter.actors.map(() => '?').join(',')})`);
    params.push(...filter.actors);
  }
  if (filter.severities && filter.severities.length > 0) {
    conditions.push(`severity IN (${filter.severities.map(() => '?').join(',')})`);
    params.push(...filter.severities);
  }
  if (filter.serial_id != null) {
    conditions.push('serial_id = ?');
    params.push(filter.serial_id);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filter.limit ?? 200;
  const offset = filter.offset ?? 0;

  return db
    .prepare(
      `SELECT * FROM activity_logs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset) as ActivityLog[];
}

/**
 * Return the most recent failure logs (severity = warn|error|critical).
 */
export function getFailureLogs(limit = 50): ActivityLog[] {
  return getDb()
    .prepare(
      `SELECT * FROM activity_logs
       WHERE severity IN ('warn','error','critical')
       ORDER BY created_at DESC LIMIT ?`
    )
    .all(limit) as ActivityLog[];
}

/**
 * Return today's logs.
 */
export function getTodayLogs(): ActivityLog[] {
  return getDb()
    .prepare(
      `SELECT * FROM activity_logs
       WHERE date(created_at) = date('now','localtime')
       ORDER BY created_at DESC`
    )
    .all() as ActivityLog[];
}

export function deleteOldActivityLogs(keepDays = 180): number {
  const result = getDb()
    .prepare("DELETE FROM activity_logs WHERE datetime(created_at) < datetime('now', 'localtime', ?)")
    .run(`-${keepDays} days`);
  return result.changes;
}
