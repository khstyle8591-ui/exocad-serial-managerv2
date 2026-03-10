import { Router, Request, Response } from 'express';
import { cancelService } from '../../main/services/cancel.service';
import { restartPreExpiryTask } from '../../main/scheduler';

const router = Router();

// POST /api/cancel/:serialNumber  (수동 취소)
router.post('/:serialNumber', async (req: Request, res: Response) => {
    const result = await cancelService.cancelSubscription(req.params.serialNumber, true); // headless=true (서버)
    res.json(result);
});

// POST /api/cancel/run/expired  (만료된 시리얼 일괄 취소)
router.post('/run/expired', async (_req: Request, res: Response) => {
    const results = await cancelService.processExpiredSerials();
    res.json(results);
});

// POST /api/cancel/run/pre-expiry  (만료 N일 전 자동 취소)
router.post('/run/pre-expiry', async (_req: Request, res: Response) => {
    const results = await cancelService.processPreExpiryAutoCancel();
    res.json(results);
});

// POST /api/cancel/run/dry-run  (dry-run)
router.post('/run/dry-run', async (_req: Request, res: Response) => {
    const results = await cancelService.processPreExpiryDryRun();
    res.json(results);
});

// POST /api/cancel/restart-scheduler
router.post('/restart-scheduler', (_req: Request, res: Response) => {
    restartPreExpiryTask();
    res.json({ ok: true });
});

export default router;
