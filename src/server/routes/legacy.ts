import { Router, Request, Response } from 'express';
import {
  detectLegacy,
  listLegacySerials,
  findMergeCandidatesForLegacy,
  importSerial,
} from '../../main/services/legacy-import.service';

const router = Router();

router.get('/detect', (_req: Request, res: Response) => {
  res.json(detectLegacy());
});

router.post('/serials', (req: Request, res: Response) => {
  res.json(listLegacySerials(req.body));
});

router.post('/suggest-merge', (req: Request, res: Response) => {
  res.json(findMergeCandidatesForLegacy(req.body));
});

router.post('/import', (req: Request, res: Response) => {
  const result = importSerial(req.body);
  res.json(result);
});

export default router;
