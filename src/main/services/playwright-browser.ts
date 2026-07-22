import { chromium, type Browser, type BrowserContext } from 'playwright';

const AUTOMATION_BROWSER_ARGS = [
  '--disable-save-password-bubble',
  '--disable-features=PasswordManager,AutofillServerCommunication',
  '--password-store=basic',
  '--disable-dev-shm-usage',  // GCP e2-micro 등 저메모리 VM에서 공유 메모리 크래시 방지
];

export async function launchAutomationBrowser(headless: boolean): Promise<Browser> {
  return chromium.launch({
    headless,
    args: AUTOMATION_BROWSER_ARGS,
  });
}

export async function newAutomationContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  });
}

// ── 프로세스 전역 Playwright 실행 슬롯 (동시성 1) ─────────────────────────────
// e2-micro(1GB) 등 저사양 VM에서 취소·크레딧배분(cancel.service)과 주문 폴링(order.service)이
// 각각 chromium을 띄워 동시에 활성화되면 메모리 스파이크로 OOM 위험이 있다. 프로세스 전역에
// 단일 실행 큐를 두어 "브라우저 작업"이 한 번에 하나만 활성화되도록 직렬화한다.
// (cancel.service의 cancelQueue와 동일한 검증된 패턴 — 한 작업의 실패가 큐를 막지 않도록 .catch 체이닝)
// 주의: 슬롯 안의 작업이 다시 withBrowserSlot을 호출하면 데드락이 발생하므로 재진입 금지.
let browserSlotTail: Promise<unknown> = Promise.resolve();

export function withBrowserSlot<T>(task: () => Promise<T>): Promise<T> {
  const result = browserSlotTail.catch(() => {}).then(task);
  browserSlotTail = result.catch(() => {});
  return result;
}
