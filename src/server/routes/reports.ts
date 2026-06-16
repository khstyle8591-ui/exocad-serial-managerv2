import { Router, Request, Response } from 'express';
import { serialService } from '../../main/services/serial.service';
import { notificationService } from '../../main/services/notification.service';

const router = Router();

// GET /api/reports/daily
router.get('/daily', (_req: Request, res: Response) => {
    const todayLogs = serialService.getTodayLogs();
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
    const autoRenewals = todayLogs.filter(l => l.action === 'renewed' && l.actor === 'auto').length;
    const manualRenewals = todayLogs.filter(l => l.action === 'renewed' && l.actor !== 'auto').length;
    res.json({
        date: today,
        new_registrations: todayLogs.filter(l => l.action === 'registered' || l.action === 'bulk_imported').length,
        renewals: autoRenewals,
        auto_renewals: autoRenewals,
        manual_renewals: manualRenewals,
        cancellations: todayLogs.filter(l => l.action === 'cancelled').length,
        failed_cancellations: [],
        details: todayLogs,
    });
});

// GET /api/reports/monthly-expiry
router.get('/monthly-expiry', (_req: Request, res: Response) => {
    const now = new Date();
    const target = new Date(now.getFullYear(), now.getMonth() + 3, 1);
    const targetYear = target.getFullYear();
    const adjustedMonth = target.getMonth() + 1;
    const expiringSerials = serialService.getExpiringInMonth(targetYear, adjustedMonth);
    res.json({
        report_date: now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }),
        target_month: `${targetYear}-${String(adjustedMonth).padStart(2, '0')}`,
        expiring_serials: expiringSerials,
        total_count: expiringSerials.length,
    });
});

// POST /api/reports/send-daily
router.post('/send-daily', async (_req: Request, res: Response) => {
    const todayLogs = serialService.getTodayLogs();
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
    const autoRenewals = todayLogs.filter(l => l.action === 'renewed' && l.actor === 'auto').length;
    const manualRenewals = todayLogs.filter(l => l.action === 'renewed' && l.actor !== 'auto').length;
    await notificationService.sendDailyReport({
        date: today,
        new_registrations: todayLogs.filter(l => l.action === 'registered' || l.action === 'bulk_imported').length,
        renewals: autoRenewals,
        auto_renewals: autoRenewals,
        manual_renewals: manualRenewals,
        cancellations: todayLogs.filter(l => l.action === 'cancelled').length,
        failed_cancellations: [],
        details: todayLogs,
    });
    res.json({ ok: true });
});

export default router;
