import { Router, Request, Response } from 'express';
import { getSettings, saveSettings } from '../../main/settings';
import { restartPreExpiryTask, startMailCheck } from '../../main/scheduler';
import { notificationService } from '../../main/services/notification.service';
import { emailMonitorService } from '../../main/services/email-monitor.service';
import type { AppSettings } from '../../shared/types';

const router = Router();

// GET /api/settings
router.get('/', (_req: Request, res: Response) => {
    res.json(getSettings());
});

// POST /api/settings
router.post('/', (req: Request, res: Response) => {
    saveSettings(req.body as Partial<AppSettings>);
    restartPreExpiryTask();
    startMailCheck();
    res.json(getSettings());
});

// POST /api/settings/test-smtp
router.post('/test-smtp', async (req: Request, res: Response) => {
    const result = await notificationService.testSmtpConnection(req.body);
    res.json(result);
});

// POST /api/settings/test-slack
router.post('/test-slack', async (req: Request, res: Response) => {
    const result = await notificationService.testSlackWebhook(req.body);
    res.json(result);
});

// POST /api/settings/test-mail-connection
router.post('/test-mail-connection', async (req: Request, res: Response) => {
    const result = await emailMonitorService.testMailConnection(req.body);
    res.json(result);
});

export default router;
