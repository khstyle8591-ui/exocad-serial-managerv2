import { Router, Request, Response } from 'express';
import { serialService } from '../../main/services/serial.service';
import { emailMonitorService } from '../../main/services/email-monitor.service';

const router = Router();

// GET /api/logs?limit=100&offset=0
router.get('/', (req: Request, res: Response) => {
    const limit = Number(req.query.limit) || 100;
    const offset = Number(req.query.offset) || 0;
    res.json(serialService.getLogs(limit, offset));
});

// GET /api/logs/today
router.get('/today', (_req: Request, res: Response) => {
    res.json(serialService.getTodayLogs());
});

// POST /api/logs/renewal-check  (메일 스캔)
router.post('/renewal-check', async (_req: Request, res: Response) => {
    const result = await emailMonitorService.checkForRenewalRequests();
    res.json(result);
});

// POST /api/logs/renewal-dry-run
router.post('/renewal-dry-run', async (_req: Request, res: Response) => {
    const result = await emailMonitorService.renewalDryRun();
    res.json(result);
});

export default router;
