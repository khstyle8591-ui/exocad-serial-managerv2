import { Router, Request, Response } from 'express';
import { runAutoRenewNow, runAutoCancelNow, runLimboFallbackNow } from '../../main/services/automation.service';

const router = Router();

router.post('/run-auto-renew', async (_req: Request, res: Response) => {
  res.json(await runAutoRenewNow());
});

router.post('/run-auto-cancel', async (_req: Request, res: Response) => {
  res.json(await runAutoCancelNow());
});

router.post('/run-limbo-fallback', async (_req: Request, res: Response) => {
  res.json(await runLimboFallbackNow());
});

export default router;
