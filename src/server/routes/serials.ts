import { Router, Request, Response } from 'express';
import { serialService } from '../../main/services/serial.service';
import { excelService } from '../../main/services/excel.service';
import type { SerialInput, AddOn } from '../../shared/types';

const router = Router();

// GET /api/serials
router.get('/', (_req: Request, res: Response) => {
    res.json(serialService.getAll());
});

// GET /api/serials/stats
router.get('/stats', (_req: Request, res: Response) => {
    res.json(serialService.getStats());
});

// GET /api/serials/template/download
router.get('/template/download', (_req: Request, res: Response) => {
    const buf = excelService.generateTemplateBuffer();
    res.setHeader('Content-Disposition', 'attachment; filename="serial_template.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
});

// GET /api/serials/search?q=...
router.get('/search', (req: Request, res: Response) => {
    const q = String(req.query.q || '');
    res.json(serialService.search(q));
});

// GET /api/serials/:id
router.get('/:id', (req: Request, res: Response) => {
    const item = serialService.getById(Number(req.params.id));
    if (!item) return res.status(404).json({ error: 'not found' });
    res.json(item);
});

// POST /api/serials
router.post('/', (req: Request, res: Response) => {
    try {
        const result = serialService.create(req.body as SerialInput);
        res.json(result);
    } catch (err: any) {
        res.status(400).json({ error: err.message });
    }
});

// POST /api/serials/bulk-import  (application/octet-stream 또는 multipart — raw buffer)
router.post('/bulk-import', (req: Request, res: Response) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (!buf.length) return res.status(400).json({ error: '파일이 없습니다' });
        const { serials, errors: parseErrors } = excelService.parseExcelBuffer(buf);
        if (serials.length === 0) {
            return res.json({ imported: 0, errors: parseErrors.length > 0 ? parseErrors : ['유효한 데이터가 없습니다'] });
        }
        const importResult = serialService.bulkImport(serials);
        res.json({ imported: importResult.imported, errors: [...parseErrors, ...importResult.errors] });
    });
});

// POST /api/serials/:id/addon
router.post('/:id/addon', (req: Request, res: Response) => {
    try {
        const result = serialService.addAddon(Number(req.params.id), req.body as AddOn);
        res.json(result);
    } catch (err: any) {
        res.status(400).json({ error: err.message });
    }
});

// POST /api/serials/:id/renew
router.post('/:id/renew', (req: Request, res: Response) => {
    try {
        const result = serialService.renewSerial(Number(req.params.id), 'manual');
        res.json(result);
    } catch (err: any) {
        res.status(400).json({ error: err.message });
    }
});

// PUT /api/serials/:id
router.put('/:id', (req: Request, res: Response) => {
    try {
        const result = serialService.update(Number(req.params.id), req.body as Partial<SerialInput>);
        res.json(result);
    } catch (err: any) {
        res.status(400).json({ error: err.message });
    }
});

// DELETE /api/serials/:id
router.delete('/:id', (req: Request, res: Response) => {
    serialService.delete(Number(req.params.id));
    res.json({ ok: true });
});

export default router;
