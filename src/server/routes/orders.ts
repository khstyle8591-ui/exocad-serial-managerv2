import { Router, Request, Response } from 'express';
import {
    getAllOrders,
    listGroupedOrders,
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
import {
    parseOrderApproveInput,
    parseOrderId,
    parseOrderPollDryRunInput,
    parseOrderPollNowInput,
    parseOrderPollTargetDate,
    parseOrderUpdateDataInput,
    parseOrderUpdateInput,
} from '../../shared/order-contract';

const router = Router();

function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

// GET /api/orders
router.get('/', (_req: Request, res: Response) => {
    res.json(getAllOrders());
});

// GET /api/orders/grouped
router.get('/grouped', (_req: Request, res: Response) => {
    res.json(listGroupedOrders());
});

// GET /api/orders/poll-status
router.get('/poll-status', (_req: Request, res: Response) => {
    res.json(getPollStatus());
});

// POST /api/orders/poll-now
router.post('/poll-now', async (req: Request, res: Response) => {
    try {
        const result = await pollNow(
            parseOrderPollNowInput(req.body?.sourceId),
            parseOrderPollTargetDate(req.body?.targetDate),
        );
        res.json(result);
    } catch (err) {
        res.status(400).json({ error: errorMessage(err) });
    }
});

// POST /api/orders/poll-dry-run
router.post('/poll-dry-run', async (req: Request, res: Response) => {
    try {
        const input = parseOrderPollDryRunInput(req.body);
        const result = await pollDryRun(input.sourceId, input.sourceOverrides, input.targetDate);
        res.json(result);
    } catch (err) {
        res.status(400).json({ error: errorMessage(err) });
    }
});

// POST /api/orders/restart-scheduler
router.post('/restart-scheduler', (_req: Request, res: Response) => {
    startPollingScheduler();
    res.json({ ok: true });
});

// PUT /api/orders/:id
router.put('/:id', (req: Request, res: Response) => {
    try {
        const result = updatePendingOrder(parseOrderId(req.params.id), parseOrderUpdateInput(req.body));
        res.json(result);
    } catch (err) {
        res.status(400).json({ error: errorMessage(err) });
    }
});

// POST /api/orders/:id/approve
router.post('/:id/approve', async (req: Request, res: Response) => {
    try {
        const result = await approvePendingOrder(parseOrderId(req.params.id), parseOrderApproveInput(req.body));
        res.json(result);
    } catch (err) {
        res.status(400).json({ error: errorMessage(err) });
    }
});

// POST /api/orders/:id/update-data
router.post('/:id/update-data', async (req: Request, res: Response) => {
    try {
        const result = await updateDataFromPendingOrder(parseOrderId(req.params.id), parseOrderUpdateDataInput(req.body));
        res.json(result);
    } catch (err) {
        res.status(400).json({ error: errorMessage(err) });
    }
});

// POST /api/orders/:id/reject
router.post('/:id/reject', (_req: Request, res: Response) => {
    try {
        rejectPendingOrder(parseOrderId(_req.params.id));
        res.json({ ok: true });
    } catch (err) {
        res.status(400).json({ error: errorMessage(err) });
    }
});

// DELETE /api/orders/:id
router.delete('/:id', (_req: Request, res: Response) => {
    try {
        deletePendingOrder(parseOrderId(_req.params.id));
        res.json({ ok: true });
    } catch (err) {
        res.status(400).json({ error: errorMessage(err) });
    }
});

export default router;
