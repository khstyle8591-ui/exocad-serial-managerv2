import type { Locator, Page } from 'playwright';
import { logger } from '../utils/logger';

export async function waitForSettledPage(page: Page, label: string, timeout = 10000): Promise<void> {
  await page.waitForLoadState('domcontentloaded', { timeout }).catch(() => {
    logger.warn(`[playwright] ${label}: domcontentloaded wait timed out`);
  });
  await page.waitForLoadState('networkidle', { timeout }).catch(() => {
    logger.warn(`[playwright] ${label}: networkidle wait timed out`);
  });
}

export async function waitForVisible(locator: Locator, label: string, timeout = 10000): Promise<void> {
  await locator.waitFor({ state: 'visible', timeout }).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`${label} not visible within ${timeout}ms: ${message}`);
  });
}

export async function shortPause(page: Page, ms: number, reason: string): Promise<void> {
  logger.info(`[playwright] pause ${ms}ms: ${reason}`);
  await page.waitForTimeout(ms);
}
