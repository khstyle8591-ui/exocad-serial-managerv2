import { Router, Request, Response } from 'express';
import { getSettings, saveSettings } from '../../main/settings';
import { restartPreExpiryTask, runExpiryNoticeDryRun, startDailyReportTasks, startExpiryNoticeTask, startMailCheck } from '../../main/scheduler';
import { startPollingScheduler } from '../../main/services/order.service';
import { notificationService } from '../../main/services/notification.service';
import { emailMonitorService } from '../../main/services/email-monitor.service';
import { runStopLifecycleNoticeDryRun } from '../../main/services/mail/lifecycle-notice.service';
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
    startDailyReportTasks();
    startExpiryNoticeTask();
    startPollingScheduler();
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

// POST /api/settings/test-slack-related
router.post('/test-slack-related', async (req: Request, res: Response) => {
    const result = await notificationService.testSlackRelatedWebhook(req.body);
    res.json(result);
});

// POST /api/settings/test-mail-connection
router.post('/test-mail-connection', async (req: Request, res: Response) => {
    const result = await emailMonitorService.testMailConnection(req.body);
    res.json(result);
});

// POST /api/settings/expiry-notice-dry-run
router.post('/expiry-notice-dry-run', async (req: Request, res: Response) => {
    const result = await runExpiryNoticeDryRun(req.body);
    res.json(result);
});

// POST /api/settings/stop-lifecycle-notice-dry-run
router.post('/stop-lifecycle-notice-dry-run', async (req: Request, res: Response) => {
    const result = await runStopLifecycleNoticeDryRun(req.body);
    res.json(result);
});

export default router;
