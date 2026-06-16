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
import { resolveMailFrom, resolveReplyAddress, type ParsedEmail } from '../src/main/services/mail/inbound.service';

const mockGetSettings = vi.mocked(getSettings);

function makeEmail(overrides: Partial<ParsedEmail> = {}): ParsedEmail {
  return {
    messageId: 'message-1',
    from: 'support@example.com',
    replyTo: '',
    to: 'renewals@example.com',
    cc: '',
    subject: 'Forwarded message',
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

function useSettings() {
  mockGetSettings.mockReturnValue({
    pop3_user: 'support@example.com',
    imap_user: 'imap@example.com',
    smtp_user: 'smtp@example.com',
    report_email_to: 'admin@example.com',
    smtp_test_address: 'test@example.com',
    dedicated_email: 'renewals@example.com',
  } as ReturnType<typeof getSettings>);
}

describe('resolveReplyAddress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettings();
  });

  it('prefers an external reply-to address', () => {
    const result = resolveReplyAddress(makeEmail({
      from: 'support@example.com',
      replyTo: 'Customer <customer@example.net>',
    }));

    expect(result).toBe('customer@example.net');
  });

  it('uses x-forwarded-from before an internal from address', () => {
    const result = resolveReplyAddress(makeEmail({
      from: 'support@example.com',
      xForwardedFrom: 'Original Sender <original@example.net>',
    }));

    expect(result).toBe('original@example.net');
  });

  it('extracts original sender from an English forwarded body header', () => {
    const result = resolveReplyAddress(makeEmail({
      from: 'support@example.com',
      body: [
        'Forwarded message',
        'From: Original Sender <original@example.net>',
        'Subject: License stop',
      ].join('\n'),
    }));

    expect(result).toBe('original@example.net');
  });

  it('extracts original sender from a Korean forwarded body header', () => {
    const result = resolveReplyAddress(makeEmail({
      body: '보낸 사람: 고객 <customer@example.kr>\n본문입니다.',
    }));

    expect(result).toBe('customer@example.kr');
  });

  it('extracts original sender from a Japanese forwarded body header', () => {
    const result = resolveReplyAddress(makeEmail({
      body: '差出人: 顧客 <customer@example.jp>\n本文です。',
    }));

    expect(result).toBe('customer@example.jp');
  });

  it('falls back to an internal address when no external address exists', () => {
    const result = resolveReplyAddress(makeEmail({
      from: 'support@example.com',
      replyTo: 'admin@example.com',
      body: 'No external address here',
    }));

    expect(result).toBe('admin@example.com');
  });
});

describe('resolveMailFrom', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettings();
  });

  it('returns the resolved external reply address for stored mail sender fields', () => {
    const result = resolveMailFrom(makeEmail({
      from: 'support@example.com',
      body: 'From: Customer <customer@example.net>',
    }));

    expect(result).toBe('customer@example.net');
  });
});
