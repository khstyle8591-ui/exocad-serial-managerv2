import { Router } from 'express';
import type { Request, Response } from 'express';
import { requirePortalAuth, requireCsrf, type PortalRequest } from '../middleware';
import { createAccountLink, getAccountLinks, isSerialLinked, findAccountById, setCustomerMismatch } from '../db';
import { syncPortalAccountIfNeeded } from '../sync';
import { logActivity } from '../../../main/services/activity-log.service';
import { serialService } from '../../../main/services/serial.service';
import { getDb } from '../../../main/database';
import type { Customer } from '../../../shared/types';

const router = Router();

interface SerialEntry {
  serial_number: string;
  main_product: string;
  status: string;
  renewal_stop_requested: number;
}

interface ExpandedLink {
  customer_id: number;
  verified_serial: string;
  serials: SerialEntry[];
}

// Returns true if at least one non-empty field matches (email OR phone OR name)
function accountMatchesCustomer(
  account: { email: string; phone: string; name: string },
  customer: Pick<Customer, 'email' | 'phone' | 'name'>,
): boolean {
  const pairs: Array<[string | undefined, string | undefined]> = [
    [account.email, customer.email],
    [account.phone, customer.phone],
    [account.name,  customer.name],
  ];
  return pairs.some(([a, c]) => {
    const av = a?.trim().toLowerCase();
    const cv = c?.trim().toLowerCase();
    return av && cv && av === cv;
  });
}

// POST /portal/setup/link-serial
router.post('/link-serial', requirePortalAuth, requireCsrf, (req: Request, res: Response) => {
  const pr = req as PortalRequest;
  const accountId = pr.portalSession!.account_id;
  const { serial } = req.body as Record<string, string>;

  if (!serial?.trim()) {
    res.status(400).json({ error: 'serial_required' });
    return;
  }

  const serialRecord = serialService.getBySerialNumber(serial.trim());
  if (!serialRecord) {
    res.status(404).json({ code: 'identity_mismatch', error: 'serial_not_found' });
    return;
  }

  // Idempotent — already linked to this customer
  if (isSerialLinked(accountId, serialRecord.customer_id)) {
    res.json({ ok: true, customer_id: serialRecord.customer_id, main_product: serialRecord.main_product, already_linked: true });
    return;
  }

  // Identity verification: serial's customer must match account (email / phone / name)
  const account = findAccountById(accountId);
  if (!account) { res.status(404).json({ error: 'Account not found' }); return; }

  if (!accountMatchesCustomer(account, serialRecord.customer)) {
    res.status(403).json({
      code: 'identity_mismatch',
      error: 'identity_mismatch',
    });
    return;
  }

  createAccountLink(accountId, serialRecord.customer_id, serialRecord.serial_number.toUpperCase());
  syncPortalAccountIfNeeded(accountId);

  // Detect data mismatch between portal account and customer DB
  const mismatch: Record<string, [string, string]> = {};
  const cust = serialRecord.customer;
  const pairs: Array<[string, string, string]> = [
    ['name',  account.name?.trim()  ?? '', cust.name?.trim()  ?? ''],
    ['email', account.email?.trim() ?? '', cust.email?.trim() ?? ''],
    ['phone', account.phone?.trim() ?? '', cust.phone?.trim() ?? ''],
  ];
  for (const [field, av, cv] of pairs) {
    if (av && cv && av.toLowerCase() !== cv.toLowerCase()) {
      mismatch[field] = [cv, av]; // [customer_db_value, portal_value]
    }
  }
  if (Object.keys(mismatch).length > 0) {
    setCustomerMismatch(accountId, mismatch);
    logActivity({
      action: 'system',
      actor: 'system',
      severity: 'warn',
      details: `Portal account #${accountId} linked serial ${serialRecord.serial_number} — customer data mismatch: ${JSON.stringify(mismatch)}`,
    });
  }

  res.json({ ok: true, customer_id: serialRecord.customer_id, main_product: serialRecord.main_product });
});

// GET /portal/setup/matches — 계정 정보(email/phone/name)와 매치되는 고객의 제품명 반환 (시리얼 비노출)
router.get('/matches', requirePortalAuth, (req: Request, res: Response) => {
  const pr = req as PortalRequest;
  const account = findAccountById(pr.portalSession!.account_id);
  if (!account) { res.status(404).json({ error: 'Account not found' }); return; }

  const db = getDb();
  const conds: string[] = [];
  const params: string[] = [];
  const email = account.email?.trim().toLowerCase();
  const phone = account.phone?.trim().toLowerCase();
  const name  = account.name?.trim().toLowerCase();
  if (email) { conds.push('LOWER(TRIM(c.email)) = ?'); params.push(email); }
  if (phone) { conds.push('LOWER(TRIM(c.phone)) = ?'); params.push(phone); }
  if (name)  { conds.push('LOWER(TRIM(c.name))  = ?'); params.push(name); }

  if (conds.length === 0) { res.json({ products: [], has_match: false }); return; }

  const rows = db
    .prepare<string[], { main_product: string }>(
      `SELECT DISTINCT s.main_product
         FROM serials s
         JOIN customers c ON c.id = s.customer_id
        WHERE ${conds.join(' OR ')}
        ORDER BY s.main_product ASC`,
    )
    .all(...params);

  const products = rows.map(r => r.main_product).filter(Boolean);
  res.json({ products, has_match: products.length > 0 });
});

// GET /portal/setup/links — 연결된 고객의 모든 시리얼 포함하여 반환
router.get('/links', requirePortalAuth, (req: Request, res: Response) => {
  const pr = req as PortalRequest;
  const accountId = pr.portalSession!.account_id;
  const db = getDb();

  const baseLinks = getAccountLinks(accountId);

  const links: ExpandedLink[] = baseLinks.map(({ customer_id, verified_serial }) => {
    const rows = db
      .prepare<[number], SerialEntry>(
        'SELECT serial_number, main_product, status, renewal_stop_requested FROM serials WHERE customer_id = ? ORDER BY created_at DESC',
      )
      .all(customer_id);
    const serials = rows.map(s => ({
      ...s,
      status: s.renewal_stop_requested === 1 ? 'stop_requested' : s.status,
    }));
    return { customer_id, verified_serial, serials };
  });

  res.json({ links });
});

export default router;
