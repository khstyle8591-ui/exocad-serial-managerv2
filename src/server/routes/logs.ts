import { Router, Request, Response } from 'express';
import { serialService } from '../../main/services/serial.service';
import { checkInboundNow, inboundDryRun } from '../../main/services/mail/inbound.service';
import fs from 'fs';
import path from 'path';
import { LOG_DIR, SCREENSHOT_DIR } from '../../main/utils/paths';
import { getDb } from '../../main/database';
import {
    getAutoRenewalOrderNoticeLog,
    listAutoRenewalOrderNoticeLogs,
} from '../../main/services/auto-renewal-order-notice-log.service';

const router = Router();

function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

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
    const result = await checkInboundNow();
    res.json(result);
});

// POST /api/logs/renewal-dry-run
router.post('/renewal-dry-run', async (_req: Request, res: Response) => {
    const result = await inboundDryRun();
    res.json(result);
});

// GET /api/logs/system
    router.get('/system', (req: Request, res: Response) => {
    try {
        const date = (req.query.date as string) || new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
        const logFile = path.join(LOG_DIR, `${date}.log`);

        if (!fs.existsSync(logFile)) {
            return res.json({ systemLogs: [], relatedEmails: [], adminReviews: listAdminReviews() });
        }

        const content = fs.readFileSync(logFile, 'utf-8');
        const lines = content.split('\n').filter(Boolean);

        const systemLogs: string[] = [];
        const relatedEmails: string[] = [];

        for (const line of lines) {
            if (
                line.includes('[System Log] Related mail received') ||
                line.includes('[System Log] 관련 메일 수신')
            ) {
                relatedEmails.push(line);
            } else {
                systemLogs.push(line);
            }
        }

        res.json({ systemLogs: systemLogs.reverse(), relatedEmails: relatedEmails.reverse(), adminReviews: listAdminReviews() });
    } catch (err: unknown) {
        res.status(500).json({ error: errorMessage(err) });
    }
});

// GET /api/logs/mail/:id
router.get('/mail/:id', (req: Request, res: Response) => {
    try {
        const db = getDb();
        const row = db.prepare('SELECT body FROM inbound_mails WHERE id = ?').get(req.params.id) as { body: string } | undefined;
        if (!row) return res.status(404).send('메일을 찾을 수 없습니다.');
        res.send(row.body);
    } catch (err: unknown) {
        res.status(500).send(errorMessage(err));
    }
});

// GET /api/logs/auto-renewal-order-notices
router.get('/auto-renewal-order-notices', (req: Request, res: Response) => {
    try {
        const limit = Math.min(Number(req.query.limit) || 100, 500);
        res.json(listAutoRenewalOrderNoticeLogs(limit));
    } catch (err: unknown) {
        res.status(500).json({ error: errorMessage(err) });
    }
});

// GET /api/logs/auto-renewal-order-notices/:id
router.get('/auto-renewal-order-notices/:id', (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'invalid notice id' });
        const item = getAutoRenewalOrderNoticeLog(id);
        if (!item) return res.status(404).json({ error: 'not found' });
        res.json(item);
    } catch (err: unknown) {
        res.status(500).json({ error: errorMessage(err) });
    }
});

// GET /api/logs/screenshot/:filename  — Cancel 스크린샷 이미지 조회
router.get('/screenshot/:filename', (req: Request, res: Response) => {
    try {
        const filename = path.basename(req.params.filename); // path traversal 방지
        const filepath = path.join(SCREENSHOT_DIR, filename);

        if (!fs.existsSync(filepath)) {
            return res.status(404).send('스크린샷을 찾을 수 없습니다.');
        }
        res.setHeader('Content-Type', 'image/png');
        res.sendFile(filepath);
    } catch (err: unknown) {
        res.status(500).send(errorMessage(err));
    }
});

function listAdminReviews() {
    return getDb().prepare(`
        SELECT id, received_at, mail_from, subject, extracted_serial, response_errors, response_attempt
        FROM inbound_mails
        WHERE admin_review = 1 AND admin_review_resolved = 0
        ORDER BY received_at DESC, id DESC
    `).all();
}

router.post('/admin-review/:id/resolve', (req: Request, res: Response) => {
    try {
        const result = getDb().prepare(
            'UPDATE inbound_mails SET admin_review_resolved = 1 WHERE id = ? AND admin_review = 1'
        ).run(req.params.id);
        res.json({ success: result.changes > 0 });
    } catch (err: unknown) {
        res.status(500).json({ error: errorMessage(err) });
    }
});

export default router;
