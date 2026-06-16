import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/main/settings', () => ({
  getSettings: vi.fn(),
}));

vi.mock('../src/main/services/serial.service', () => ({
  serialService: {
    getBySerialNumber: vi.fn(),
    listSerialNumbers: vi.fn(),
  },
}));

import { getSettings } from '../src/main/settings';
import { serialService } from '../src/main/services/serial.service';
import { analyzeEmail, type ParsedEmail } from '../src/main/services/mail/inbound.service';

const mockGetSettings = vi.mocked(getSettings);
const mockSerialService = vi.mocked(serialService);

function makeEmail(overrides: Partial<ParsedEmail> = {}): ParsedEmail {
  return {
    messageId: 'message-1',
    from: 'customer@example.com',
    replyTo: '',
    to: 'support@example.com',
    cc: '',
    subject: 'Hello',
    body: '',
    date: '2026-02-20T00:00:00.000Z',
    deliveredTo: '',
    xForwardedTo: '',
    xOriginalTo: '',
    xForwardedFor: '',
    resent_to: '',
    xForwardedFrom: '',
    rawHeaders: '',
    ...overrides,
  };
}

function useSettings(overrides: Record<string, unknown> = {}) {
  mockGetSettings.mockReturnValue({
    renewal_product_keywords: ['exocad'],
    renewal_action_keywords: ['renew'],
    renewal_keywords: [],
    renewal_exclude_keywords: [],
    dedicated_email: '',
    mail_serial_pattern: 'XXXXXXXX-XXXX-XXXXXXXX',
    require_serial_format: true,
    ...overrides,
  } as ReturnType<typeof getSettings>);
}

describe('analyzeEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettings();
    mockSerialService.getBySerialNumber.mockReturnValue(undefined);
    mockSerialService.listSerialNumbers.mockReturnValue([]);
  });

  it('classifies serial plus stop keyword as a stop request candidate', () => {
    const result = analyzeEmail(makeEmail({
      subject: 'Please cancel AAAAAAAA-1111-BBBBBBBB',
    }));

    expect(result.classification).toBe('stop_request_candidate');
    expect(result.extractedSerial).toBe('AAAAAAAA-1111-BBBBBBBB');
    expect(result.missingFields).toEqual([]);
    expect(result.evidence).toContain('serial');
    expect(result.evidence).toContain('stop_keyword');
  });

  it('classifies stop intent without a serial as missing info', () => {
    const result = analyzeEmail(makeEmail({
      subject: 'Please cancel renewal',
    }));

    expect(result.classification).toBe('missing_info');
    expect(result.extractedSerial).toBeNull();
    expect(result.missingFields).toEqual(['serial']);
  });

  it('classifies serial without stop intent as missing info', () => {
    const result = analyzeEmail(makeEmail({
      subject: 'AAAAAAAA-1111-BBBBBBBB',
    }));

    expect(result.classification).toBe('missing_info');
    expect(result.extractedSerial).toBe('AAAAAAAA-1111-BBBBBBBB');
    expect(result.missingFields).toEqual(['stop_keyword']);
  });

  it('classifies dedicated mailbox traffic with missing details as missing info', () => {
    useSettings({ dedicated_email: 'renewals@example.com' });

    const result = analyzeEmail(makeEmail({
      to: 'renewals@example.com',
    }));

    expect(result.classification).toBe('missing_info');
    expect(result.isDedicated).toBe(true);
    expect(result.missingFields).toEqual(['serial', 'stop_keyword']);
  });

  it('classifies product matches with exclude keywords as unrelated', () => {
    useSettings({ renewal_exclude_keywords: ['newsletter'] });

    const result = analyzeEmail(makeEmail({
      subject: 'exocad newsletter',
    }));

    expect(result.classification).toBe('unrelated');
    expect(result.evidence).toEqual(['excluded']);
  });

  it('classifies ordinary mail without signals as unclassified', () => {
    const result = analyzeEmail(makeEmail({
      subject: 'Question about invoice',
      body: 'Can you check this?',
    }));

    expect(result.classification).toBe('unclassified');
    expect(result.extractedSerial).toBeNull();
    expect(result.missingFields).toEqual([]);
  });

  it('uses the configured serial pattern', () => {
    useSettings({ mail_serial_pattern: 'XXXX-XXXX' });

    const result = analyzeEmail(makeEmail({
      subject: 'cancel ABCD-1234',
    }));

    expect(result.classification).toBe('stop_request_candidate');
    expect(result.extractedSerial).toBe('ABCD-1234');
  });

  it('parses a valid structured response despite surrounding multilingual text', () => {
    mockSerialService.getBySerialNumber.mockReturnValue({
      id: 1,
      serial_number: 'AAAAAAAA-1111-BBBBBBBB',
      customer: { name: 'Tokyo Dental' },
    } as never);
    const result = analyzeEmail(makeEmail({
      body: `日本語の案内
**[CANCELLATION_RESPONSE_START]**
SERIAL_NUMBER: AAAAAAAA-1111-BBBBBBBB
CANCELLATION_CONFIRMATION: YES
CUSTOMER_NAME: Tokyo Dental
**[CANCELLATION_RESPONSE_END]**
Thank you`,
    }));
    expect(result.classification).toBe('stop_request_candidate');
    expect(result.evidence).toContain('structured_response');
    expect(result.responseErrors).toEqual([]);
  });

  it('ignores a quoted empty block and validates the latest answered block', () => {
    const result = analyzeEmail(makeEmail({
      body: `[CANCELLATION_RESPONSE_START]
SERIAL_NUMBER:
CANCELLATION_CONFIRMATION:
CUSTOMER_NAME:
[CANCELLATION_RESPONSE_END]

[CANCELLATION_RESPONSE_START]
SERIAL_NUMBER: bad
CANCELLATION_CONFIRMATION: NO
CUSTOMER_NAME:
[CANCELLATION_RESPONSE_END]`,
    }));
    expect(result.classification).toBe('invalid_cancellation_response');
    expect(result.responseErrors).toContain('SERIAL_NUMBER format is invalid');
    expect(result.responseErrors).toContain('CANCELLATION_CONFIRMATION must be YES');
  });
});
