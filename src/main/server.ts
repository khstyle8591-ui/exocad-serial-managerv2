// GCP 서버 진입점 — Express HTTP/HTTPS + 스케줄러 통합
import 'dotenv/config';
import path from 'path';
import fs from 'fs';
import http from 'http';
import https from 'https';
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
const HTTP_PORT = Number(process.env.HTTP_PORT) || 3000;
const HTTPS_PORT = Number(process.env.HTTPS_PORT) || 3443;

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

// ── HTTPS 인증서 경로 (Let's Encrypt) ────────────────────────────────────────
const CERT_DOMAIN = process.env.CERT_DOMAIN || 'geomedi-exocad.duckdns.org';
const certDir = `/etc/letsencrypt/live/${CERT_DOMAIN}`;
const hasCerts = fs.existsSync(`${certDir}/privkey.pem`) &&
  fs.existsSync(`${certDir}/fullchain.pem`);

// ── 서버 시작 ────────────────────────────────────────────────────────────────
let httpServer: http.Server;
let httpsServer: https.Server | null = null;

// HTTP 서버 (항상 실행)
httpServer = http.createServer(app);
httpServer.listen(HTTP_PORT, '0.0.0.0', () => {
  logger.info(`HTTP  서버 실행 중: http://0.0.0.0:${HTTP_PORT}`);
});

// HTTPS 서버 (인증서 있을 때만 실행)
if (hasCerts) {
  const sslOptions = {
    key: fs.readFileSync(`${certDir}/privkey.pem`),
    cert: fs.readFileSync(`${certDir}/fullchain.pem`),
  };
  httpsServer = https.createServer(sslOptions, app);
  httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
    logger.info(`HTTPS 서버 실행 중: https://0.0.0.0:${HTTPS_PORT}`);
  });
} else {
  logger.warn(`SSL 인증서 없음 (${certDir}) — HTTP 전용 모드`);
}

logger.info('모든 스케줄러 실행 중. Ctrl+C로 종료.');

// ── 종료 처리 ─────────────────────────────────────────────────────────────────
const shutdown = () => {
  logger.info('서버 종료 중...');
  httpServer.close(() => {
    httpsServer?.close(() => {
      stopScheduler();
      stopPollingScheduler();
      closeDatabase();
      logger.info('서버 종료 완료');
      process.exit(0);
    });
    if (!httpsServer) {
      stopScheduler();
      stopPollingScheduler();
      closeDatabase();
      logger.info('서버 종료 완료');
      process.exit(0);
    }
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);