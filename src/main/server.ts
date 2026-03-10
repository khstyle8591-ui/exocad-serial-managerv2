/**
 * GCP 서버용 진입점 (Electron 없이 실행)
 * 스케줄러 + 폴링 + DB만 실행
 */
import { initDatabase, closeDatabase } from './database';
import { startScheduler, stopScheduler } from './scheduler';
import { startPollingScheduler, stopPollingScheduler } from './services/order.service';
import { logger } from './utils/logger';

// 시작
logger.init();
logger.info('=== GCP 서버 모드 시작 ===');

initDatabase();
startScheduler();
startPollingScheduler();

logger.info('모든 스케줄러 실행 중. Ctrl+C로 종료.');

// 프로세스 종료 처리
const shutdown = () => {
  logger.info('서버 종료 중...');
  stopScheduler();
  stopPollingScheduler();
  closeDatabase();
  logger.info('=== GCP 서버 모드 종료 ===');
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// 프로세스가 종료되지 않도록 유지
setInterval(() => {}, 1000 * 60 * 60);