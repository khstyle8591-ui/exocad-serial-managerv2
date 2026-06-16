import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/main/settings', () => ({
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
}));

vi.mock('../src/main/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { getSettings } from '../src/main/settings';
import { logger } from '../src/main/utils/logger';
import { getPollStatus, pollNow, setPollStatusForTesting } from '../src/main/services/order.service';

const mockGetSettings = vi.mocked(getSettings);
const mockLogger = vi.mocked(logger);

describe('pollNow duplicate-run guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setPollStatusForTesting({
      running: false,
      lastRun: '',
      message: '아직 폴링하지 않았습니다.',
    });
  });

  it('returns a skip error without loading settings when polling is already running', async () => {
    setPollStatusForTesting({ running: true });

    const result = await pollNow('source-1');

    expect(result).toEqual({
      found: 0,
      errors: ['폴링이 이미 실행 중입니다. 잠시 후 다시 시도하세요.'],
    });
    expect(mockGetSettings).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      '[Polling] skipped because another polling job is already running (Source: source-1)',
    );
    expect(getPollStatus().running).toBe(true);
  });

  it('resets running status after the no-source path returns', async () => {
    mockGetSettings.mockReturnValue({
      poll_sources: [],
    } as ReturnType<typeof getSettings>);

    const result = await pollNow();

    expect(result).toEqual({
      found: 0,
      errors: ['활성화된 폴링 소스가 없습니다.'],
    });
    expect(getPollStatus().running).toBe(false);
  });
});
