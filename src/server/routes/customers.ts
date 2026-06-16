import { Router, Request, Response } from 'express';
import {
  listCustomers,
  getCustomerById,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  searchCustomers,
  listCustomerSerialSummaries,
  findMergeCandidates,
} from '../../main/services/customer.service';
import {
  parseCustomerInput,
  parseCustomerMergeQuery,
  parseCustomerSearchQuery,
  parseCustomerUpdateInput,
} from '../../shared/customer-contract';

const router = Router();

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

router.get('/', (_req: Request, res: Response) => {
  res.json(listCustomers());
});

router.get('/serial-summaries', (_req: Request, res: Response) => {
  res.json(listCustomerSerialSummaries());
});

router.get('/search', (req: Request, res: Response) => {
  try {
    res.json(searchCustomers(parseCustomerSearchQuery(req.query.q)));
  } catch (err) {
    res.status(400).json({ error: errorMessage(err) });
  }
});

router.get('/:id', (req: Request, res: Response) => {
  const c = getCustomerById(Number(req.params.id));
  if (!c) return res.status(404).json({ error: 'Not found' });
  res.json(c);
});

router.post('/', (req: Request, res: Response) => {
  try {
    const c = createCustomer(parseCustomerInput(req.body));
    res.status(201).json(c);
  } catch (err) {
    res.status(400).json({ error: errorMessage(err) });
  }
});

router.put('/:id', (req: Request, res: Response) => {
  try {
    const c = updateCustomer(Number(req.params.id), parseCustomerUpdateInput(req.body));
    if (!c) return res.status(404).json({ error: 'Not found' });
    res.json(c);
  } catch (err) {
    res.status(400).json({ error: errorMessage(err) });
  }
});

router.delete('/:id', (req: Request, res: Response) => {
  const result = deleteCustomer(Number(req.params.id));
  if (!result.success) return res.status(409).json({ error: result.error });
  res.json({ success: true });
});

router.post('/merge-candidates', (req: Request, res: Response) => {
  try {
    res.json(findMergeCandidates(parseCustomerMergeQuery(req.body)));
  } catch (err) {
    res.status(400).json({ error: errorMessage(err) });
  }
});

export default router;
