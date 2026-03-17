import { Router, Request, Response } from 'express';
import { serialService } from '../../main/services/serial.service';
import { emailMonitorService } from '../../main/services/email-monitor.service';
import fs from 'fs';
import path from 'path';

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

// GET /api/logs/system
    router.get('/system', (req: Request, res: Response) => {
    try {
        const date = (req.query.date as string) || new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
        const logDir = process.env.LOG_DIR || path.join(process.cwd(), 'logs');
        const logFile = path.join(logDir, `${date}.log`);

        if (!fs.existsSync(logFile)) {
            return res.json({ systemLogs: [], relatedEmails: [] });
        }

        const content = fs.readFileSync(logFile, 'utf-8');
        const lines = content.split('\n').filter(Boolean);

        const systemLogs: string[] = [];
        const relatedEmails: string[] = [];

        for (const line of lines) {
            if (line.includes('[System Log] 관련 메일 수신')) {
                relatedEmails.push(line);
            } else {
                systemLogs.push(line);
            }
        }

        res.json({ systemLogs: systemLogs.reverse(), relatedEmails: relatedEmails.reverse() });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/logs/mail/:id
router.get('/mail/:id', (req: Request, res: Response) => {
    try {
        const { getDb } = require('../../main/database');
        const db = getDb();
        const row = db.prepare('SELECT body FROM captured_emails WHERE id = ?').get(req.params.id) as { body: string } | undefined;
        if (!row) return res.status(404).send('메일을 찾을 수 없습니다.');
        res.send(row.body);
    } catch (err: any) {
        res.status(500).send(err.message);
    }
});

// GET /api/logs/screenshot/:filename  — Cancel 스크린샷 이미지 조회
router.get('/screenshot/:filename', (req: Request, res: Response) => {
    try {
        const filename = path.basename(req.params.filename); // path traversal 방지
        const screenshotDir = path.join(process.cwd(), 'data', 'screenshots');
        const filepath = path.join(screenshotDir, filename);

        if (!fs.existsSync(filepath)) {
            return res.status(404).send('스크린샷을 찾을 수 없습니다.');
        }
        res.setHeader('Content-Type', 'image/png');
        res.sendFile(filepath);
    } catch (err: any) {
        res.status(500).send(err.message);
    }
});

export default router;
