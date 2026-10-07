import { Router, Request, Response } from 'express';
import multer from 'multer';
import { serialService } from '../../main/services/serial.service';
import { logger } from '../../main/utils/logger';
import { excelService } from '../../main/services/excel.service';
import { sendStopRequestReceivedNotice, sendManualRenewalConfirmNotice } from '../../main/services/mail/lifecycle-notice.service';
import { sendManualRenewalPo } from '../../main/services/automation.service';
import { listSerialMailNoticeLogs } from '../../main/services/serial-mail-notice-log.service';
import { listLogs } from '../../main/services/activity-log.service';
import {
    parseAddOnInput,
    parseSerialInput,
    parseSerialListQuery,
    parseSerialUpdateInput,
} from '../../shared/serial-contract';
import { SERVER_ERRORS } from '../../shared/server-errors';
import type { SerialExportQuery } from '../../shared/types';
import { previewBulkUpdate, applyBulkUpdate } from '../../main/services/serial-bulk-update.service';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

// GET /api/serials
router.get('/', (req: Request, res: Response) => {
    try {
        if (req.query.paged === '1' || req.query.limit !== undefined || req.query.offset !== undefined) {
            res.json(serialService.list(parseSerialListQuery(req.query)));
            return;
        }
        res.setHeader('Deprecation', 'true');
        res.setHeader('Link', '</api/serials?paged=1>; rel="successor-version"');
        res.setHeader('Warning', '299 - "Deprecated: use /api/serials?paged=1"');
        res.json(serialService.getAll());
    } catch (err) {
        res.status(400).json({ error: errorMessage(err) });
    }
});

// GET /api/serials/stats
router.get('/stats', (_req: Request, res: Response) => {
    res.json(serialService.getStats());
});

// GET /api/serials/stats/counts
router.get('/stats/counts', (_req: Request, res: Response) => {
    res.json(serialService.getStats());
});

// GET /api/serials/stats/series?granularity=day&range=30
router.get('/stats/series', (req: Request, res: Response) => {
    const granularity = String(req.query.granularity || 'day') as 'day' | 'month' | 'year';
    const range = Number(req.query.range) || 30;
    res.json(serialService.getStatsSeries(granularity, range));
});

// GET /api/serials/template/download
router.get('/template/download', async (_req: Request, res: Response) => {
    const buf = await excelService.generateTemplateBuffer();
    res.setHeader('Content-Disposition', 'attachment; filename="serial_template.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
});

// GET /api/serials/search?q=...
router.get('/search', (req: Request, res: Response) => {
    const q = String(req.query.q || '');
    res.json(serialService.search(q));
});

// GET /api/serials/expiring-soon?days=60&limit=50
router.get('/expiring-soon', (req: Request, res: Response) => {
    const days = Number(req.query.days) || 60;
    const limit = Number(req.query.limit) || 50;
    res.json(serialService.getExpiringSoon(days, limit));
});

// GET /api/serials/version-summary
router.get('/version-summary', (_req: Request, res: Response) => {
    res.json(serialService.getVersionSummary());
});

// GET /api/serials/:id/mail-notice-logs
router.get('/:id/mail-notice-logs', (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'invalid serial id' });
    res.json(listSerialMailNoticeLogs(id));
});

// GET /api/serials/:id/activity-logs — 시리얼별 전체 활동 이력(자동·수동·시스템), 최신순
router.get('/:id/activity-logs', (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'invalid serial id' });
    res.json(listLogs({ serial_id: id }));
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
        const result = serialService.create(parseSerialInput(req.body));
        res.json(result);
    } catch (err) {
        res.status(400).json({ error: errorMessage(err) });
    }
});

// POST /api/serials/bulk-import  (multipart/form-data)
router.post('/bulk-import', upload.single('file'), async (req: Request, res: Response) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: SERVER_ERRORS.IMPORT_NO_FILE });
        }

        const { serials, errors: parseErrors } = await excelService.parseExcelBuffer(req.file.buffer);

        if (serials.length === 0) {
            return res.json({
                imported: 0,
                errors: parseErrors.length > 0 ? parseErrors : [SERVER_ERRORS.IMPORT_NO_DATA]
            });
        }

        const importResult = serialService.bulkImport(serials);
        res.json({ imported: importResult.imported, errors: [...parseErrors, ...importResult.errors] });
    } catch (err) {
        logger.error(`Bulk import error: ${errorMessage(err)}`);
        res.status(500).json({ error: '임포트 중 오류 발생: ' + errorMessage(err) });
    }
});

// POST /api/serials/bulk-update?mode=preview|apply  (multipart/form-data)
// 벌크 upsert. mode=preview(기본)는 쓰기 없이 dry-run 리포트만, mode=apply는 백업 후 트랜잭션 반영.
// apply 시 동일 파일을 재업로드하며, 반영 직전 현재 DB 기준으로 충돌을 재검증한다.
router.post('/bulk-update', upload.single('file'), async (req: Request, res: Response) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: SERVER_ERRORS.IMPORT_NO_FILE });
        }
        const parsed = await excelService.parseBulkUpdateBuffer(req.file.buffer);
        if (parsed.parseErrors.length > 0) {
            return res.status(400).json({ error: parsed.parseErrors.join('; ') });
        }
        const result = String(req.query.mode) === 'apply'
            ? await applyBulkUpdate(parsed)
            : previewBulkUpdate(parsed);
        res.json(result);
    } catch (err) {
        logger.error(`Bulk update error: ${errorMessage(err)}`);
        res.status(500).json({ error: errorMessage(err) });
    }
});

// POST /api/serials/export
router.post('/export', async (req: Request, res: Response) => {
    try {
        const serials = Array.isArray(req.body?.serials) ? req.body.serials : [];
        const buf = await excelService.exportSerialsBuffer(serials);
        res.setHeader('Content-Disposition', 'attachment; filename="serials.xlsx"');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buf);
    } catch (err) {
        res.status(400).json({ error: errorMessage(err) });
    }
});

// POST /api/serials/export-filtered
// 필터 조건에 맞는 시리얼 전체를 서버에서 엑셀로 생성. list API의 500건 캡을 타지 않는다
// (listForExport는 LIMIT 없이 조회). "시리얼 DB 다운로드"가 이 경로를 사용.
router.post('/export-filtered', async (req: Request, res: Response) => {
    try {
        const body = (req.body ?? {}) as Record<string, unknown>;
        const query = {
            search: typeof body.search === 'string' ? body.search : undefined,
            status: typeof body.status === 'string' ? (body.status as SerialExportQuery['status']) : undefined,
            customer_id: body.customer_id != null ? Number(body.customer_id) : undefined,
            renewal_stop_requested:
                typeof body.renewal_stop_requested === 'boolean' ? body.renewal_stop_requested : undefined,
            expiring_this_month: body.expiring_this_month ? true : undefined,
        } satisfies SerialExportQuery;
        const serials = serialService.listForExport(query);
        // 숨김 id 열 + 스냅샷 시트 포함 (다운로드 = 벌크 업데이트 편집 템플릿)
        const buf = await excelService.exportBulkUpdateBuffer(serials);
        res.setHeader('Content-Disposition', 'attachment; filename="serials.xlsx"');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buf);
    } catch (err) {
        res.status(400).json({ error: errorMessage(err) });
    }
});

// POST /api/serials/:id/addon
router.post('/:id/addon', (req: Request, res: Response) => {
    try {
        const result = serialService.addAddon(Number(req.params.id), parseAddOnInput(req.body));
        res.json(result);
    } catch (err) {
        res.status(400).json({ error: errorMessage(err) });
    }
});

// POST /api/serials/:id/activate
router.post('/:id/activate', (req: Request, res: Response) => {
    try {
        res.json(serialService.activate(Number(req.params.id)));
    } catch (err) {
        res.status(400).json({ error: errorMessage(err) });
    }
});

// POST /api/serials/:id/stop-requested
router.post('/:id/stop-requested', async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        const flag = !!req.body?.flag;
        const before = serialService.getById(id);
        const result = serialService.setStopRequested(id, flag, req.body?.triggerId);
        if (flag && before && before.renewal_stop_requested !== 1 && result) {
            await sendStopRequestReceivedNotice(result).catch(() => {});
        }
        res.json(result);
    } catch (err) {
        res.status(400).json({ error: errorMessage(err) });
    }
});

// POST /api/serials/:id/mail-settings — 시리얼별 메일 발송 on/off 토글
router.post('/:id/mail-settings', (req: Request, res: Response) => {
    try {
        const body = (req.body ?? {}) as Record<string, unknown>;
        const settings = {
            mail_expiry_notice_enabled:
                typeof body.mail_expiry_notice_enabled === 'boolean' ? body.mail_expiry_notice_enabled : undefined,
            mail_order_form_enabled:
                typeof body.mail_order_form_enabled === 'boolean' ? body.mail_order_form_enabled : undefined,
            mail_lifecycle_notice_enabled:
                typeof body.mail_lifecycle_notice_enabled === 'boolean' ? body.mail_lifecycle_notice_enabled : undefined,
        };
        const result = serialService.setMailSettings(Number(req.params.id), settings);
        if (!result) return res.status(404).json({ error: 'not found' });
        res.json(result);
    } catch (err) {
        res.status(400).json({ error: errorMessage(err) });
    }
});

// POST /api/serials/:id/cancel-db
router.post('/:id/cancel-db', (req: Request, res: Response) => {
    try {
        res.json(serialService.cancelManual(Number(req.params.id)));
    } catch (err) {
        res.status(400).json({ error: errorMessage(err) });
    }
});

// POST /api/serials/:id/remove-module
router.post('/:id/remove-module', (req: Request, res: Response) => {
    try {
        res.json(serialService.removeModule(Number(req.params.id), String(req.body?.name || '')));
    } catch (err) {
        res.status(400).json({ error: errorMessage(err) });
    }
});

// POST /api/serials/:id/renew
router.post('/:id/renew', (req: Request, res: Response) => {
    try {
        const result = serialService.renewSerial(Number(req.params.id), 'manual');
        res.json(result);
    } catch (err) {
        res.status(400).json({ error: errorMessage(err) });
    }
});

// POST /api/serials/:id/send-renewal-notice  — 수동 갱신 팝업에서 "고객 갱신 안내 메일 발송" 선택 시
router.post('/:id/send-renewal-notice', async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        const previousExpiryDate = req.body?.previous_expiry_date ?? null;
        const serial = serialService.getById(id);
        if (!serial) { res.status(404).json({ error: 'Serial not found' }); return; }
        const result = await sendManualRenewalConfirmNotice(serial, previousExpiryDate);
        res.json(result ?? { ok: true });
    } catch (err) {
        res.status(400).json({ error: errorMessage(err) });
    }
});

// POST /api/serials/:id/send-renewal-po  — 수동 갱신 발주서 발송 팝업에서 "승인" 클릭 시
router.post('/:id/send-renewal-po', async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        const previousExpiryDate = req.body?.previous_expiry_date ?? null;
        const result = await sendManualRenewalPo(id, previousExpiryDate);
        res.json(result);
    } catch (err) {
        res.status(400).json({ error: errorMessage(err) });
    }
});

// PUT /api/serials/:id
router.put('/:id', (req: Request, res: Response) => {
    try {
        const result = serialService.update(Number(req.params.id), parseSerialUpdateInput(req.body));
        res.json(result);
    } catch (err) {
        res.status(400).json({ error: errorMessage(err) });
    }
});

// DELETE /api/serials/:id
router.delete('/:id', (req: Request, res: Response) => {
    serialService.delete(Number(req.params.id));
    res.json({ ok: true });
});

export default router;
