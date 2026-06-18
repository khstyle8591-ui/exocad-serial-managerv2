import { Router } from 'express';
import type { Request, Response } from 'express';
import { requirePortalAuth, requireCsrf, type PortalRequest } from '../middleware';
import { createAccountLink, getAccountLinks, isSerialLinked, findAccountById } from '../db';
import { syncPortalAccountIfNeeded } from '../sync';
import { serialService } from '../../../main/services/serial.service';
import { getDb } from '../../../main/database';
import type { Customer } from '../../../shared/types';

const router = Router();

interface SerialEntry {
  serial_number: string;
  main_product: string;
  status: string;
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
    res.status(400).json({ error: '시리얼을 입력해주세요.' });
    return;
  }

  const serialRecord = serialService.getBySerialNumber(serial.trim());
  if (!serialRecord) {
    res.status(404).json({ code: 'identity_mismatch', error: '시리얼을 찾을 수 없습니다. 입력을 확인하거나 PM에 문의해주세요.' });
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
      error: '입력한 시리얼의 고객 정보와 계정 정보가 일치하지 않습니다. 이메일, 연락처, 이름을 확인해주세요.',
    });
    return;
  }

  createAccountLink(accountId, serialRecord.customer_id, serialRecord.serial_number.toUpperCase());
  syncPortalAccountIfNeeded(accountId);

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
    const serials = db
      .prepare<[number], SerialEntry>(
        'SELECT serial_number, main_product, status FROM serials WHERE customer_id = ? ORDER BY created_at DESC',
      )
      .all(customer_id);
    return { customer_id, verified_serial, serials };
  });

  res.json({ links });
});

export default router;
