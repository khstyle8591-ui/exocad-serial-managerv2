import { Router, Request, Response } from 'express';
import {
  listCustomers,
  getCustomerById,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  searchCustomers,
  findMergeCandidates,
} from '../../main/services/customer.service';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  res.json(listCustomers());
});

router.get('/search', (req: Request, res: Response) => {
  const q = String(req.query.q ?? '');
  res.json(searchCustomers(q));
});

router.get('/:id', (req: Request, res: Response) => {
  const c = getCustomerById(Number(req.params.id));
  if (!c) return res.status(404).json({ error: 'Not found' });
  res.json(c);
});

router.post('/', (req: Request, res: Response) => {
  const c = createCustomer(req.body);
  res.status(201).json(c);
});

router.put('/:id', (req: Request, res: Response) => {
  const c = updateCustomer(Number(req.params.id), req.body);
  if (!c) return res.status(404).json({ error: 'Not found' });
  res.json(c);
});

router.delete('/:id', (req: Request, res: Response) => {
  const result = deleteCustomer(Number(req.params.id));
  if (!result.success) return res.status(409).json({ error: result.error });
  res.json({ success: true });
});

router.post('/merge-candidates', (req: Request, res: Response) => {
  res.json(findMergeCandidates(req.body));
});

export default router;
