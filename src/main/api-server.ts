import express from 'express';
import http from 'http';
import { logger } from './utils/logger';

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

const PORT = Number(process.env.API_PORT) || 3001;

let server: http.Server | null = null;

export function startApiServer(): void {
  const app = express();

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

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

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  server = http.createServer(app);
  server.listen(PORT, '127.0.0.1', () => {
    logger.info(`API 서버 시작: http://127.0.0.1:${PORT}`);
  });
}

export function stopApiServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!server) return resolve();
    server.close(() => resolve());
    server = null;
  });
}
