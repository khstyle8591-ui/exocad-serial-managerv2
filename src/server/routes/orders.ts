import { Router, Request, Response } from 'express';
import {
    getAllOrders,
    updatePendingOrder,
    approvePendingOrder,
    updateDataFromPendingOrder,
    rejectPendingOrder,
    deletePendingOrder,
    pollNow,
    pollDryRun,
    getPollStatus,
    startPollingScheduler,
} from '../../main/services/order.service';

const router = Router();

// GET /api/orders
router.get('/', (_req: Request, res: Response) => {
    res.json(getAllOrders());
});

// GET /api/orders/poll-status
router.get('/poll-status', (_req: Request, res: Response) => {
    res.json(getPollStatus());
});

// POST /api/orders/poll-now
router.post('/poll-now', async (req: Request, res: Response) => {
    const result = await pollNow(req.body?.sourceId);
    res.json(result);
});

// POST /api/orders/poll-dry-run
router.post('/poll-dry-run', async (req: Request, res: Response) => {
    const result = await pollDryRun(req.body?.sourceId, req.body?.sourceOverrides);
    res.json(result);
});

// POST /api/orders/restart-scheduler
router.post('/restart-scheduler', (_req: Request, res: Response) => {
    startPollingScheduler();
    res.json({ ok: true });
});

// PUT /api/orders/:id
router.put('/:id', (req: Request, res: Response) => {
    const result = updatePendingOrder(Number(req.params.id), req.body);
    res.json(result);
});

// POST /api/orders/:id/approve
router.post('/:id/approve', async (_req: Request, res: Response) => {
    const result = await approvePendingOrder(Number(_req.params.id));
    res.json(result);
});

// POST /api/orders/:id/update-data
router.post('/:id/update-data', async (req: Request, res: Response) => {
    const result = await updateDataFromPendingOrder(Number(req.params.id), req.body);
    res.json(result);
});

// POST /api/orders/:id/reject
router.post('/:id/reject', (_req: Request, res: Response) => {
    rejectPendingOrder(Number(_req.params.id));
    res.json({ ok: true });
});

// DELETE /api/orders/:id
router.delete('/:id', (_req: Request, res: Response) => {
    deletePendingOrder(Number(_req.params.id));
    res.json({ ok: true });
});

export default router;
