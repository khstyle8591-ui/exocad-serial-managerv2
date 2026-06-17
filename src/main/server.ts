// GCP 서버 진입점 — Express HTTP/HTTPS + 스케줄러 통합
import 'dotenv/config';
import path from 'path';
import fs from 'fs';
import http from 'http';
import https from 'https';
import express from 'express';
import basicAuth from 'express-basic-auth';
import bcrypt from 'bcryptjs';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { initDatabase, closeDatabase } from './database';
import { startScheduler, stopScheduler } from './scheduler';
import { startPollingScheduler, stopPollingScheduler } from './services/order.service';
import { cancelService } from './services/cancel.service';
import { logger } from './utils/logger';

// ── 라우터 ──────────────────────────────────────────────────────────────────
import serialsRouter from '../server/routes/serials';
import settingsRouter from '../server/routes/settings';
import ordersRouter from '../server/routes/orders';
import cancelRouter from '../server/routes/cancel';
import logsRouter from '../server/routes/logs';
import reportsRouter from '../server/routes/reports';
import webhookRouter from '../server/routes/webhook';
import customersRouter from '../server/routes/customers';
import mailTemplatesRouter from '../server/routes/mail-templates';
import legacyRouter from '../server/routes/legacy';
import mailRouter from '../server/routes/mail';
import automationRouter from '../server/routes/automation';
import portalRouter from '../server/portal/index';

const HTTP_PORT = Number(process.env.HTTP_PORT) || 3000;
const HTTPS_PORT = Number(process.env.HTTPS_PORT) || 3443;
const BIND_HOST = process.env.BIND_HOST || '127.0.0.1';
const isProduction = process.env.NODE_ENV === 'production';
const authDisabled = process.env.AUTH_DISABLED === 'true' && !isProduction;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required. Set it before starting the server.`);
  }
  return value;
}

function getAllowedOrigins(): string[] {
  return (process.env.ALLOWED_ORIGIN || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
}

if (process.env.AUTH_DISABLED === 'true' && isProduction) {
  throw new Error('AUTH_DISABLED cannot be used with NODE_ENV=production.');
}

if (!authDisabled) {
  requireEnv('API_USER');
  requireEnv('API_PASSWORD_HASH');
}

if (isProduction && getAllowedOrigins().length === 0) {
  throw new Error('ALLOWED_ORIGIN is required with NODE_ENV=production.');
}

// ── 초기화 ───────────────────────────────────────────────────────────────────
logger.init();
logger.info('=== Server mode started ===');

initDatabase();
startScheduler();
startPollingScheduler();

// ── Express ──────────────────────────────────────────────────────────────────
const app = express();
app.set('trust proxy', 1); // Cloudflare Tunnel / reverse proxy X-Forwarded-For 신뢰

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(helmet());

const allowedOrigins = getAllowedOrigins();
app.use(cors({
  credentials: true,
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    if (!isProduction && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
}));

const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: Number(process.env.RATE_LIMIT_PER_MINUTE) || 100,
  standardHeaders: true,
  legacyHeaders: false,
});

const strictApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: Number(process.env.STRICT_RATE_LIMIT_PER_MINUTE) || 5,
  standardHeaders: true,
  legacyHeaders: false,
});

const authMiddleware = authDisabled
  ? (_req: express.Request, _res: express.Response, next: express.NextFunction) => next()
  : basicAuth({
      challenge: true,
      authorizer(username: string, password: string) {
        const expectedUser = process.env.API_USER || '';
        const expectedHash = process.env.API_PASSWORD_HASH || '';
        return basicAuth.safeCompare(username, expectedUser) &&
          bcrypt.compareSync(password, expectedHash);
      },
      unauthorizedResponse: () => ({ error: 'Authentication required' }),
    });

app.use(globalLimiter);

// API 라우터
app.use('/api', authMiddleware);
app.use('/api/cancel', strictApiLimiter);
app.use('/api/orders/poll-now', strictApiLimiter);
app.use('/api/serials', serialsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/cancel', cancelRouter);
app.use('/api/logs', logsRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/webhook', webhookRouter);
app.use('/api/customers', customersRouter);
app.use('/api/mail-templates', mailTemplatesRouter);
app.use('/api/legacy', legacyRouter);
app.use('/api/mail', mailRouter);
app.use('/api/automation', automationRouter);

// 고객 포털 (portal_enabled=false 이면 503)
app.use('/portal', portalRouter);

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

// Serial Manager 관리 UI at /manage/ (BasicAuth)
const managerDir = path.join(__dirname, '../../manager');
if (fs.existsSync(managerDir)) {
  app.use('/manage', authMiddleware);
  app.use('/manage', express.static(managerDir));
  app.get('/manage/*', (_req, res) => {
    res.sendFile(path.join(managerDir, 'index.html'));
  });
}

// 포털 클라이언트 정적 파일 at / (인증 불필요 — 포털 API가 자체 인증 처리)
const portalClientDir = path.join(__dirname, '../../portal-client');
if (fs.existsSync(portalClientDir)) {
  app.use(express.static(portalClientDir));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(portalClientDir, 'index.html'));
  });
} else {
  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });
}

// ── HTTPS 인증서 경로 (Let's Encrypt) ────────────────────────────────────────
const CERT_DOMAIN = process.env.CERT_DOMAIN || 'geomedi-exocad.duckdns.org';
const certDir = process.env.CERT_DIR || `/etc/letsencrypt/live/${CERT_DOMAIN}`;
const hasCerts = fs.existsSync(`${certDir}/privkey.pem`) &&
  fs.existsSync(`${certDir}/fullchain.pem`);

// ── 서버 시작 ────────────────────────────────────────────────────────────────
let httpServer: http.Server;
let httpsServer: https.Server | null = null;

// HTTP 서버 (항상 실행)
httpServer = http.createServer(app);
// Playwright(Chromium)가 실행 중일 때 CPU/메모리 부하로 응답이 지연될 수 있음.
// keepAliveTimeout을 길게 설정하여 클라이언트가 연결을 유지할 수 있게 함.
httpServer.keepAliveTimeout = 65000;       // 65초 (nginx 기본값 60초보다 길게)
httpServer.headersTimeout = 70000;         // 70초
httpServer.timeout = 120000;               // 요청 자체 타임아웃 2분
httpServer.listen(HTTP_PORT, BIND_HOST, () => {
  logger.info(`HTTP server running: http://${BIND_HOST}:${HTTP_PORT}`);
});

// HTTPS 서버 (인증서 있을 때만 실행)
if (hasCerts) {
  const sslOptions = {
    key: fs.readFileSync(`${certDir}/privkey.pem`),
    cert: fs.readFileSync(`${certDir}/fullchain.pem`),
  };
  httpsServer = https.createServer(sslOptions, app);
  httpsServer.keepAliveTimeout = 65000;
  httpsServer.headersTimeout = 70000;
  httpsServer.timeout = 120000;
  httpsServer.listen(HTTPS_PORT, BIND_HOST, () => {
    logger.info(`HTTPS server running: https://${BIND_HOST}:${HTTPS_PORT}`);
  });
} else {
  logger.warn(`SSL certificate not found (${certDir}); HTTP-only mode`);
}

logger.info('All schedulers are running. Press Ctrl+C to exit.');

// ── 종료 처리 ─────────────────────────────────────────────────────────────────
let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('Server shutting down...');
  const forceExitTimer = setTimeout(() => {
    logger.error('Server shutdown timed out; forcing exit');
    process.exit(1);
  }, 15_000);

  try {
    await new Promise<void>(resolve => httpServer.close(() => resolve()));
    if (httpsServer) {
      await new Promise<void>(resolve => httpsServer?.close(() => resolve()));
    }
    await cancelService.cleanup();
    stopScheduler();
    stopPollingScheduler();
    closeDatabase();
    clearTimeout(forceExitTimer);
    logger.info('Server shutdown complete');
    process.exit(0);
  } catch (err: unknown) {
    clearTimeout(forceExitTimer);
    logger.error(`Server shutdown failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
