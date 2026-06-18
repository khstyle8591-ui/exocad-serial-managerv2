/**
 * 세션 만료 시 partner.exocad.com 동작 확인 스크립트
 * 실행: npx tsx scripts/test-session-expiry.ts
 *
 * DB에서 로그인 정보를 읽어 로그인 → 쿠키 삭제(세션 만료 시뮬레이션) →
 * 페이지 재접속 → URL + DOM 요소 캡처
 */
import Database from 'better-sqlite3';
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

// ── DB에서 설정 읽기 ──────────────────────────────────────────────────────────
const DB_PATH =
  process.env.DB_PATH ||
  path.join(
    process.env.APPDATA || '',
    'Exocad Serial Manager',
    'exocad.db',
  );

if (!fs.existsSync(DB_PATH)) {
  console.error(`DB not found: ${DB_PATH}`);
  process.exit(1);
}

const db = new Database(DB_PATH, { readonly: true });

function getSetting(key: string): string {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  if (!row) return '';
  try {
    const parsed = JSON.parse(row.value);
    return typeof parsed === 'string' ? parsed : row.value;
  } catch {
    return row.value;
  }
}

const loginUrl = getSetting('exocad_login_url');
const siteUrl  = getSetting('exocad_site_url');
const username = getSetting('exocad_username');
const password = getSetting('exocad_password');

console.log(`\n=== 설정 확인 ===`);
console.log(`login URL : ${loginUrl}`);
console.log(`site URL  : ${siteUrl}`);
console.log(`username  : ${username}`);
console.log(`password  : ${'*'.repeat(password.length)}`);

if (!loginUrl || !siteUrl || !username || !password) {
  console.error('\n설정이 비어있습니다. Electron 앱에서 Exocad 로그인 정보를 먼저 입력하세요.');
  process.exit(1);
}

// ── 스크린샷 저장 경로 ────────────────────────────────────────────────────────
const OUT_DIR = path.join(process.cwd(), 'scripts', 'session-expiry-shots');
fs.mkdirSync(OUT_DIR, { recursive: true });

async function capture(page: import('playwright').Page, name: string) {
  const filePath = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  console.log(`  [screenshot] ${filePath}`);
  return filePath;
}

// ── 메인 ────────────────────────────────────────────────────────────────────
(async () => {
  const browser = await chromium.launch({
    headless: false, // 시각적으로 확인
    args: ['--disable-dev-shm-usage'],
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // ── STEP 1: 로그인 ───────────────────────────────────────────────────────
    console.log('\n=== STEP 1: 로그인 ===');
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    // 이메일 입력
    const emailInput = page.locator(
      'input[type="email"], input[name="username"], input[name="email"], input[id="username"]'
    ).first();
    await emailInput.waitFor({ state: 'visible', timeout: 15000 });
    await emailInput.fill(username);

    // Continue 버튼 (2단계 SSO)
    const continueBtn = page.locator(
      'button:has-text("Continue"), button:has-text("Next")'
    ).first();
    const hasContinue = await continueBtn.isVisible({ timeout: 2000 }).catch(() => false);
    if (hasContinue) {
      await continueBtn.click();
      await page.waitForTimeout(2000);
    }

    // 비밀번호
    const pwInput = page.locator('input[type="password"]').first();
    await pwInput.waitFor({ state: 'visible', timeout: 10000 });
    await pwInput.fill(password);

    const loginBtn = page.locator(
      'button[type="submit"], button:has-text("Log in"), button:has-text("Sign in")'
    ).first();
    await loginBtn.click();

    // SSO 리다이렉트 대기
    await page.waitForURL(
      url => !url.href.includes('aligntech.com') && !url.href.includes('/u/login'),
      { timeout: 45000 }
    ).catch(() => console.warn('  waitForURL timeout; continuing...'));

    await page.waitForTimeout(3000);
    console.log(`  로그인 후 URL: ${page.url()}`);
    await capture(page, '01_after_login');

    // ── STEP 2: 라이선스 관리 페이지 이동 ───────────────────────────────────
    console.log('\n=== STEP 2: 라이선스 관리 페이지 이동 ===');
    if (!page.url().startsWith(siteUrl)) {
      await page.goto(siteUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    }
    console.log(`  이동 후 URL: ${page.url()}`);
    await capture(page, '02_license_management');

    // ── STEP 3: 쿠키 전부 삭제 (세션 만료 시뮬레이션) ───────────────────────
    console.log('\n=== STEP 3: 쿠키 삭제 (세션 만료 시뮬레이션) ===');
    await context.clearCookies();
    console.log('  쿠키 삭제 완료');

    // ── STEP 4: 라이선스 관리 페이지 재접속 ─────────────────────────────────
    console.log('\n=== STEP 4: 라이선스 관리 페이지 재접속 ===');
    await page.goto(siteUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000); // 리다이렉트 충분히 대기

    const urlAfterExpiry = page.url();
    console.log(`  착지 URL: ${urlAfterExpiry}`);
    await capture(page, '03_after_session_expiry');

    // ── STEP 5: DOM 분석 ─────────────────────────────────────────────────────
    console.log('\n=== STEP 5: DOM 분석 ===');

    const title = await page.title();
    console.log(`  페이지 title: "${title}"`);

    const bodyText = await page.locator('body').textContent().catch(() => '');
    const firstLine = (bodyText || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    console.log(`  body text (300자): "${firstLine}"`);

    // 주요 요소 존재 여부
    const checks = [
      { name: 'search-input',    selector: '[data-testid="search-input"]' },
      { name: 'login input',     selector: 'input[type="password"], input[name="username"]' },
      { name: 'session-expired text', selector: ':text("session"), :text("expired"), :text("login"), :text("sign in")' },
      { name: 'error message',   selector: '[class*="error"], [class*="Error"], [role="alert"]' },
    ];

    for (const c of checks) {
      const visible = await page.locator(c.selector).first().isVisible({ timeout: 2000 }).catch(() => false);
      console.log(`  ${visible ? '✅' : '❌'} ${c.name}`);
    }

    // localStorage/sessionStorage 키 확인
    const storageKeys = await page.evaluate(() => ({
      local: Object.keys(localStorage),
      session: Object.keys(sessionStorage),
    })).catch(() => ({ local: [], session: [] }));
    console.log(`  localStorage keys: ${storageKeys.local.join(', ') || '(없음)'}`);
    console.log(`  sessionStorage keys: ${storageKeys.session.join(', ') || '(없음)'}`);

    // ── STEP 6: 추가 URL 변화 대기 ──────────────────────────────────────────
    console.log('\n=== STEP 6: 5초 추가 대기 후 최종 URL ===');
    await page.waitForTimeout(5000);
    const finalUrl = page.url();
    console.log(`  최종 URL: ${finalUrl}`);
    await capture(page, '04_final_state');

    // ── 결론 ─────────────────────────────────────────────────────────────────
    console.log('\n=== 결론 ===');
    console.log(`  쿠키 삭제 전 URL : ${siteUrl}`);
    console.log(`  쿠키 삭제 후 URL : ${urlAfterExpiry}`);
    console.log(`  최종 URL         : ${finalUrl}`);
    const sameUrl = finalUrl.startsWith(siteUrl);
    console.log(`  URL 변화 없음 (SPA 내부 렌더)  : ${sameUrl ? 'YES → 고유 DOM 요소로 감지 필요' : 'NO → URL로 감지 가능'}`);
    console.log(`\n  스크린샷 위치: ${OUT_DIR}`);

  } finally {
    // 브라우저를 바로 닫지 않고 확인할 수 있도록 10초 대기
    console.log('\n브라우저를 10초 후 닫습니다...');
    await page.waitForTimeout(10000);
    await browser.close();
    db.close();
  }
})();
