import { Router, Request, Response } from 'express';
import {
  listTemplates,
  getTemplate,
  upsertTemplate,
  deleteTemplate,
  previewTemplate,
} from '../../main/services/mail/template.service';
import { sendTemplate, sendTestDryRun } from '../../main/services/mail/smtp.service';

const router = Router();

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

router.get('/', (_req: Request, res: Response) => {
  res.json(listTemplates());
});

router.get('/:code', (req: Request, res: Response) => {
  const t = getTemplate(req.params.code);
  if (!t) return res.status(404).json({ error: 'Not found' });
  res.json(t);
});

router.get('/:code/preview', (req: Request, res: Response) => {
  try {
    const result = previewTemplate(req.params.code, Number(req.query.serialId));
    res.json(result);
  } catch (e: unknown) {
    res.status(400).json({ error: errorMessage(e) });
  }
});

router.post('/', (req: Request, res: Response) => {
  const t = upsertTemplate(req.body);
  res.json(t);
});

router.delete('/:code', (req: Request, res: Response) => {
  deleteTemplate(req.params.code);
  res.json({ success: true });
});

export default router;
