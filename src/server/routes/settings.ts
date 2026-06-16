import { Router, Request, Response } from 'express';
import { getSettings, redactSettingsForClient, saveSettings } from '../../main/settings';
import { getDb } from '../../main/database';
import { runExpiryNoticeDryRun } from '../../main/scheduler';
import { notificationService } from '../../main/services/notification.service';
import { testMailConnection } from '../../main/services/mail/inbound.service';
import { runStopLifecycleNoticeDryRun } from '../../main/services/mail/lifecycle-notice.service';
import { refreshSchedulersForSettingsChange } from '../../main/services/scheduler-refresh.service';
import type { AppSettings } from '../../shared/types';

const router = Router();

function markDeprecated(res: Response, successor: string): void {
    res.setHeader('Deprecation', 'true');
    res.setHeader('Link', `<${successor}>; rel="successor-version"`);
    res.setHeader('Warning', `299 - "Deprecated: use ${successor}"`);
}

// GET /api/settings
router.get('/', (_req: Request, res: Response) => {
    res.json(redactSettingsForClient());
});

// GET /api/settings/scheduler-summary
router.get('/scheduler-summary', (_req: Request, res: Response) => {
    const row = getDb()
        .prepare("SELECT value FROM settings WHERE key='scheduler_summary'")
        .get() as { value: string } | undefined;
    if (!row?.value) {
        res.json({ summary: '', updated_at: '' });
        return;
    }
    try {
        res.json(JSON.parse(row.value));
    } catch {
        res.json({ summary: row.value, updated_at: '' });
    }
});

// POST /api/settings
router.post('/', (req: Request, res: Response) => {
    const beforeSettings = getSettings(true);
    saveSettings(req.body as Partial<AppSettings>);
    const afterSettings = getSettings(true);
    refreshSchedulersForSettingsChange(beforeSettings, afterSettings);
    res.json(redactSettingsForClient(afterSettings));
});

// GET /api/settings/report-times
router.get('/report-times', (_req: Request, res: Response) => {
    res.json(getSettings().daily_report_times || ['10:00']);
});

// POST /api/settings/report-times
router.post('/report-times', (req: Request, res: Response) => {
    const times = Array.isArray(req.body?.times) ? req.body.times.map(String) : ['10:00'];
    const beforeSettings = getSettings(true);
    saveSettings({ daily_report_times: times });
    const afterSettings = getSettings(true);
    refreshSchedulersForSettingsChange(beforeSettings, afterSettings);
    res.json(afterSettings.daily_report_times);
});

// POST /api/settings/test-smtp
router.post('/test-smtp', async (req: Request, res: Response) => {
    markDeprecated(res, '/api/mail/test-smtp');
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
    markDeprecated(res, '/api/mail/test-connection');
    const result = await testMailConnection(req.body);
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
