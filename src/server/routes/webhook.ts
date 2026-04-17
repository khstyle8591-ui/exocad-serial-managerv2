import { Router, Request, Response } from 'express';
import { logger } from '../../main/utils/logger';

const router = Router();

// In-memory state (web server mode)
let webhookRunning = false;
const WEBHOOK_PORT = 3000;

// GET /api/webhook/status
router.get('/status', (_req: Request, res: Response) => {
    res.json({ running: webhookRunning, port: WEBHOOK_PORT });
});

// POST /api/webhook/start
router.post('/start', (_req: Request, res: Response) => {
    webhookRunning = true;
    logger.info(`Webhook 서버 시작 (포트 ${WEBHOOK_PORT})`);
    res.json({ running: webhookRunning, port: WEBHOOK_PORT });
});

// POST /api/webhook/stop
router.post('/stop', (_req: Request, res: Response) => {
    webhookRunning = false;
    logger.info('Webhook 서버 중지');
    res.json({ running: webhookRunning, port: WEBHOOK_PORT });
});

export default router;
