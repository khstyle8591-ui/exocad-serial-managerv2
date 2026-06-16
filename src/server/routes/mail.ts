import { Router, Request, Response } from 'express';
import { checkInboundNow, inboundDryRun, listInboundMails, testMailConnection, confirmStopRequestFromMail, sendMissingInfoTemplateForMail } from '../../main/services/mail/inbound.service';
import { sendTemplate, sendTestDryRun, testSmtp } from '../../main/services/mail/smtp.service';

const router = Router();

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

router.post('/check-inbound-now', async (_req: Request, res: Response) => {
  res.json(await checkInboundNow());
});

router.post('/inbound-dry-run', async (_req: Request, res: Response) => {
  res.json(await inboundDryRun());
});

router.post('/test-connection', async (req: Request, res: Response) => {
  res.json(await testMailConnection(req.body));
});

router.post('/inbound-mails', (req: Request, res: Response) => {
  res.json(listInboundMails(req.body));
});

router.post('/inbound-mails/:id/confirm-stop', async (req: Request, res: Response) => {
  res.json(await confirmStopRequestFromMail(Number(req.params.id)));
});

router.post('/inbound-mails/:id/send-missing-info', async (req: Request, res: Response) => {
  res.json(await sendMissingInfoTemplateForMail(Number(req.params.id)));
});

router.post('/send-template', async (req: Request, res: Response) => {
  const { code, to, vars, options } = req.body;
  try {
    const result = await sendTemplate(code, to, vars, options);
    res.json(result);
  } catch (e: unknown) {
    res.status(500).json({ error: errorMessage(e) });
  }
});

router.post('/test-smtp', async (req: Request, res: Response) => {
  res.json(await testSmtp(req.body));
});

router.post('/send-test-dry-run', async (req: Request, res: Response) => {
  res.json(await sendTestDryRun(req.body));
});

export default router;
