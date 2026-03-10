// GCP 서버 진입점 — Express HTTP + 스케줄러 통합
import 'dotenv/config';
import path from 'path';
import express from 'express';
import { initDatabase, closeDatabase } from './database';
import { startScheduler, stopScheduler } from './scheduler';
import { startPollingScheduler, stopPollingScheduler } from './services/order.service';
import { logger } from './utils/logger';

// ── 라우터 ──────────────────────────────────────────────────────────────────
import serialsRouter from '../server/routes/serials';
import settingsRouter from '../server/routes/settings';
import ordersRouter from '../server/routes/orders';
import cancelRouter from '../server/routes/cancel';
import logsRouter from '../server/routes/logs';
import reportsRouter from '../server/routes/reports';

// ── 초기화 ───────────────────────────────────────────────────────────────────
logger.init();
logger.info('=== 서버 모드 시작 ===');

initDatabase();
startScheduler();
startPollingScheduler();

// ── Express ──────────────────────────────────────────────────────────────────
const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// API 라우터
app.use('/api/serials', serialsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/cancel', cancelRouter);
app.use('/api/logs', logsRouter);
app.use('/api/reports', reportsRouter);

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

// React 빌드 정적 파일 서빙
const staticDir = path.join(__dirname, '../renderer');
app.use(express.static(staticDir));
app.get('*', (_req, res) => {
  res.sendFile(path.join(staticDir, 'index.html'));
});

// ── 서버 시작 ────────────────────────────────────────────────────────────────
const server = app.listen(PORT, '0.0.0.0', () => {
  logger.info(`HTTP 서버 실행 중: http://0.0.0.0:${PORT}`);
  logger.info('모든 스케줄러 실행 중. Ctrl+C로 종료.');
});

// ── 종료 처리 ─────────────────────────────────────────────────────────────────
const shutdown = () => {
  logger.info('서버 종료 중...');
  server.close(() => {
    stopScheduler();
    stopPollingScheduler();
    closeDatabase();
    logger.info('=== 서버 모드 종료 ===');
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);