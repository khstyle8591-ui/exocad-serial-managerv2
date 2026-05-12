import { getSettings } from '../../settings';
import { serialService } from '../serial.service';
import { logger } from '../../utils/logger';
import { sendTemplate } from './smtp.service';
import type { SerialWithCustomer } from '../../../shared/types';

type NoticeKind = 'stop_request' | 'cancel_complete';

function today(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
}

export function buildSerialTemplateVars(serial: SerialWithCustomer | null): Record<string, string> {
  const todayStr = today();
  if (!serial) {
    return {
      CUSTOMER_NAME: 'Sample Customer',
      CUSTOMER_EMAIL: 'sample@example.com',
      SERIAL_NUMBER: 'SAMPLE-0000',
      EXPIRY_DATE: todayStr,
      PURCHASE_DATE: todayStr,
      MAIN_PRODUCT: 'exocad DentalCAD',
      MODULES: 'Sample Add-on',
      TODAY: todayStr,
      DEALER: 'Sample Dealer',
      SALES_MANAGER: 'Sample Manager',
    };
  }

  return {
    CUSTOMER_NAME: serial.customer.name,
    CUSTOMER_EMAIL: serial.customer.email,
    SERIAL_NUMBER: serial.serial_number,
    EXPIRY_DATE: serial.expiry_date ?? '',
    PURCHASE_DATE: serial.purchase_date ?? '',
    MAIN_PRODUCT: serial.main_product,
    MODULES: (JSON.parse(serial.modules || '[]') as string[]).join(', '),
    TODAY: todayStr,
    DEALER: serial.customer.dealer,
    SALES_MANAGER: serial.customer.sales_manager,
  };
}

function pickSampleSerial(kind: NoticeKind): SerialWithCustomer | null {
  const all = serialService.getAll();
  const preferred = kind === 'stop_request'
    ? all.find(serial => serial.renewal_stop_requested && serial.customer.email)
    : all.find(serial => serial.status === 'cancelled' && serial.customer.email);
  return preferred ?? all.find(serial => serial.customer.email) ?? all[0] ?? null;
}

export async function sendStopRequestReceivedNotice(serial: SerialWithCustomer): Promise<void> {
  const settings = getSettings();
  if (settings.stop_request_notice_enabled === false) return;
  if (!serial.customer.email) {
    logger.warn(`[mail] stop request notice skipped: no customer email (${serial.serial_number})`);
    return;
  }

  const template = settings.stop_request_notice_template || 'stop_request_received';
  const result = await sendTemplate(
    template,
    serial.customer.email,
    buildSerialTemplateVars(serial),
    { serial_id: serial.id, actor: 'auto' }
  );
  if (!result.success) {
    logger.error(`[mail] stop request notice failed: ${serial.serial_number} - ${result.message}`);
  }
}

export async function sendCancelCompleteNotice(serial: SerialWithCustomer): Promise<void> {
  const settings = getSettings();
  if (settings.cancel_complete_notice_enabled === false) return;
  if (!serial.customer.email) {
    logger.warn(`[mail] cancel complete notice skipped: no customer email (${serial.serial_number})`);
    return;
  }

  const template = settings.cancel_complete_notice_template || 'cancel_confirmation';
  const result = await sendTemplate(
    template,
    serial.customer.email,
    buildSerialTemplateVars(serial),
    { serial_id: serial.id, actor: 'auto' }
  );
  if (!result.success) {
    logger.error(`[mail] cancel complete notice failed: ${serial.serial_number} - ${result.message}`);
  }
}

export async function runStopLifecycleNoticeDryRun(input: {
  kind: NoticeKind;
  template_code: string;
  test_email: string;
}): Promise<{ success: boolean; message: string; sample_serial?: string; sample_sent_to?: string }> {
  const template = (input.template_code || '').trim();
  if (!template) return { success: false, message: '템플릿을 선택해주세요.' };

  const testEmail = (input.test_email || '').trim();
  if (!testEmail) return { success: false, message: '샘플 메일을 받을 테스트 주소를 입력해주세요.' };

  const sample = pickSampleSerial(input.kind);
  const result = await sendTemplate(
    template,
    testEmail,
    buildSerialTemplateVars(sample),
    { serial_id: sample?.id, actor: 'manual' }
  );

  return {
    success: result.success,
    message: result.success ? 'Dry-run 샘플 메일 발송 완료.' : result.message,
    sample_serial: sample?.serial_number,
    sample_sent_to: result.success ? testEmail : undefined,
  };
}
