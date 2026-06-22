/**
 * system-log.service.ts
 *
 * 포털(서버) 발 작업을 winston 파일 로그(System Logs 페이지 소스)에 기록하는 헬퍼.
 * 메시지는 매니저 앱 언어(settings.app_language) 기준으로 선택되어 기록되므로,
 * System Logs 페이지에서 매니저가 설정한 언어로 표시된다.
 */

import { logger } from '../utils/logger';
import { getSettings } from '../settings';
import type { LocalizedText } from '../../shared/types';

export function logSystem(text: LocalizedText, level: 'info' | 'warn' | 'error' = 'info'): void {
  const lang = getSettings().app_language;
  const message = text[lang] ?? text.ko;
  logger[level](`[System Log] ${message}`);
}
