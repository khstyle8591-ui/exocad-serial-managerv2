import { chromium, type Browser, type BrowserContext } from 'playwright';

const AUTOMATION_BROWSER_ARGS = [
  '--disable-save-password-bubble',
  '--disable-features=PasswordManager,AutofillServerCommunication',
  '--password-store=basic',
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
