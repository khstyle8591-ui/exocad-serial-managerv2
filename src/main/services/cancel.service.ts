import { chromium, Browser, Page, BrowserContext } from 'playwright';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import { serialService } from './serial.service';
import { getSettings } from '../settings';
import { logger } from '../utils/logger';
import type { CancelResult, CancelDryRunResult } from '../../shared/types';

// 스크린샷 저장 디렉토리
function getScreenshotDir(): string {
  const dir = path.join(app.getPath('userData'), 'screenshots');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export class CancelService {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private isLoggedIn: boolean = false;

  // ============================================================
  // 단일 시리얼 cancel 처리
  // 전체 흐름: 로그인 → 라이선스 관리 페이지 → 검색 → 옵션 → cancel → 확인
  // ============================================================
  async cancelSubscription(serialNumber: string, headless: boolean = true): Promise<CancelResult> {
    const settings = getSettings();
    let page: Page | null = null;

    try {
      // ─── 브라우저 & 컨텍스트 초기화 ───
      // 기존 브라우저가 없거나 연결이 끊어진 경우 새로 생성
      // headless=true: 자동 스케줄러에서 호출 시 백그라운드 실행
      // headless=false: 수동 실행 시 화면 표시
      if (!this.browser || !this.browser.isConnected()) {
        this.browser = await chromium.launch({
          headless,
          args: [
            // ── 패스워드 저장 팝업 완전 차단 ────────────────────────────────────
            // 로그인 후 나타나는 Chromium 내장 "비밀번호를 저장하시겠습니까?" 버블을
            // OS 레벨에서 비활성화하여 이후 버튼/드롭다운 클릭 차단을 예방한다.
            '--disable-save-password-bubble',
            '--disable-features=PasswordManager,AutofillServerCommunication',
            '--password-store=basic',
          ],
        });
        this.context = await this.browser.newContext();
        // 네이티브 다이얼로그(alert, confirm) 자동 dismiss
        // 브라우저가 표시하는 모든 dialog를 즉시 dismiss하여 자동화 흐름을 보호한다.
        this.context.on('page', (p) => {
          p.on('dialog', async (dialog) => {
            logger.info(`[dialog] auto-dismiss: type=${dialog.type()}, msg=${dialog.message().slice(0, 80)}`);
            await dialog.dismiss().catch(() => { });
          });
        });
        this.isLoggedIn = false;
      }

      page = await this.context!.newPage();

      // ─── 1단계: 로그인 (세션이 없을 때만) ───
      // Align Tech SSO 페이지에서 이메일+비밀번호로 로그인
      // 한번 로그인하면 같은 context 내에서 쿠키가 유지되므로 재로그인 불필요
      if (!this.isLoggedIn) {
        await this.login(page, settings);
      }

      // ─── 2단계: 라이선스 관리 페이지로 이동 ───
      // 로그인 후 이미 target URL에 있으면 goto 생략 (불필요한 재로딩 방지)
      // 없으면 networkidle까지 대기하여 React SPA가 완전히 마운트된 후 진행
      const currentUrl = page.url();
      if (!currentUrl.startsWith(settings.exocad_site_url)) {
        await page.goto(settings.exocad_site_url, { waitUntil: 'domcontentloaded' });
        // networkidle을 추가 대기하여 React 컴포넌트 마운트 및 API 응답 완료 보장
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {
          logger.warn('networkidle 타임아웃 — searchSerial에서 직접 element 대기로 진행');
        });
      }

      // ─── 3단계: 시리얼 넘버 검색 ───
      await this.searchSerial(page, serialNumber);

      // ─── 4단계: 제품명 읽기 (cancel 버튼 결정용) ───
      const productName = await this.getProductNameFromRow(page);
      logger.info(`제품명 감지: "${productName}"`);

      // ─── 5단계: 옵션 버튼(⋮) 클릭 → 드롭다운 열기 ───
      await this.clickOptionButton(page, serialNumber, settings);

      // ─── 6단계: 드롭다운에서 제품별 Cancel 버튼 클릭 ───
      await this.clickCancelInDropdown(page, settings, productName);

      // ─── 7단계: 확인 팝업에서 제품별 확인 버튼 클릭 ───
      await this.confirmCancel(page, settings, productName);

      // ─── 8단계: 결과 검증 + 스크린샷 ───
      const verification = await this.verifyCancelResult(page, serialNumber);
      const screenshotPath = await this.captureResultScreenshot(page, serialNumber);

      logger.info(`Subscription cancelled 완료: ${serialNumber} (verified: ${verification.verified}, status: ${verification.status})`);
      return {
        serial_number: serialNumber,
        success: true,
        verified: verification.verified,
        verified_status: verification.status,
        screenshot_path: screenshotPath,
      };

    } catch (err: any) {
      logger.error(`Cancel 실패 [${serialNumber}]: ${err.message}`);

      // 로그인 관련 오류 시 세션 초기화 (다음 시도에서 재로그인)
      if (err.message.includes('로그인') || err.message.includes('login')) {
        this.isLoggedIn = false;
      }

      return { serial_number: serialNumber, success: false, error: err.message };
    } finally {
      // 페이지만 닫고 context(세션)는 유지 → 다음 시리얼 처리 시 재로그인 불필요
      if (page) {
        await page.close();
      }
    }
  }

  // ============================================================
  // 로그인 처리
  // URL: Align Tech SSO (https://myaccount-us.aligntech.com/u/login?...)
  // 필드: 이메일 + 비밀번호 → "Log in" 버튼 클릭
  // ============================================================
  private async login(page: Page, settings: any): Promise<void> {
    logger.info('Exocad 사이트 로그인 시작');

    // domcontentloaded로 을못하지 않게 진입 (스킠다론 테스트와 동일 방식)
    await page.goto(settings.exocad_login_url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    // ── Step 1: 이메일/username 입력 ──────────────────────────────────────────
    // Align Tech SSO는 username → Continue → password 의 2단계 로그인일 수 있음
    const username = settings.exocad_username || 'pm@geomedi.co.jp';
    const emailInput = page.locator(
      'input[type="email"], input[type="text"][name="username"], input[type="text"][name="email"], ' +
      'input[name="username"], input[name="email"], ' +
      'input[id="username"], input[id="email"]'
    ).first();
    await emailInput.waitFor({ state: 'visible', timeout: 10000 });
    await emailInput.fill(username);

    // "Continue" 혹은 "Next" 버튼 클릭 (2단계 SSO 대응)
    const continueBtn = page.locator(
      'button:has-text("Continue"), button:has-text("Next"), button:has-text("계속"), button:has-text("다음")'
    ).first();
    const hasContinue = await continueBtn.isVisible({ timeout: 2000 }).catch(() => false);
    if (hasContinue) {
      await continueBtn.click();
      await page.waitForTimeout(3000);
    }

    // ── Step 2: 비밀번호 입력 ────────────────────────────────────────────────
    const password = settings.exocad_password || 'Geomedi2012!';
    const passwordInput = page.locator(
      'input[type="password"]'
    ).first();
    await passwordInput.waitFor({ state: 'visible', timeout: 10000 });
    await passwordInput.fill(password);

    // ── Step 3: Submit ────────────────────────────────────────────────────────────
    const loginButton = page.locator(
      'button[type="submit"], input[type="submit"], ' +
      'button:has-text("Log in"), button:has-text("Login"), button:has-text("Sign in"), button:has-text("로그인")'
    ).first();
    await loginButton.waitFor({ state: 'visible', timeout: 5000 });
    await loginButton.click();
    logger.info('[login] 로그인 버튼 클릭 → SSO 리다이렉트 대기...');

    // ── SSO 리다이렉트 완료 대기 ────────────────────────────────────────────
    // networkidle은 SSO 리다이렉트 중 도달 불가능 → 30초 타임아웃 발생
    // 대신 URL이 aligntech.com 도메인에서 볮어날 때를 감지하는 waitForURL 사용
    // (standalone 테스트에서 이 방식으로 성공 확인됨)
    await page.waitForURL(
      (url) => !url.href.includes('myaccount-us.aligntech.com') && !url.href.includes('/u/login'),
      { timeout: 45000 }
    ).catch(async () => {
      logger.warn('[login] waitForURL 타임아웃 — 10초 추가 대기');
      await page.waitForTimeout(10000);
    });
    await page.waitForTimeout(3000);

    // 로그인 성공 여부 확인
    const currentUrl = page.url();
    logger.info(`[login] 현재 URL: ${currentUrl}`);
    if (currentUrl.includes('/u/login') || currentUrl.includes('signin')) {
      throw new Error('로그인 실패: 이메일 또는 비밀번호를 확인하세요');
    }

    this.isLoggedIn = true;
    logger.info(`로그인 성공 (현재 URL: ${currentUrl})`);
  }

  // ============================================================
  // 시리얼 넘버 검색
  // 위치: 라이선스 관리 페이지 왼쪽 상단의 search 필드
  // 동작: 시리얼 넘버 입력 → Enter
  // ============================================================
  private async searchSerial(page: Page, serialNumber: string): Promise<void> {
    logger.info(`시리얼 검색 시작: ${serialNumber}`);

    // ── Step 1: search-input이 DOM에 등장할 때까지 대기 ─────────────────────
    // React SPA는 JS 실행 → 컴포넌트 마운트 → data fetch 완료 후 input이 렌더됨.
    // 페이지 로딩이 10초 이상 걸릴 수 있으므로 최대 40초까지 대기.
    const searchInput = page.locator('[data-testid="search-input"]').first();
    await searchInput.waitFor({ state: 'visible', timeout: 40000 });
    logger.info(`[searchSerial] search-input 감지 완료`);

    // ── Step 2: React hydration 완료 보장 대기 ──────────────────────────────
    // element가 visible이 되어도 React의 synthetic event handler가
    // 아직 붙지 않았을 수 있음. 추가 대기로 interactive 상태 보장.
    await page.waitForTimeout(2000);

    // ── Step 3: element가 enabled(interactive) 상태인지 확인 후 클릭 ────────
    await searchInput.waitFor({ state: 'attached', timeout: 5000 });
    await searchInput.click();
    await page.waitForTimeout(300);
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(100);
    await page.keyboard.press('Delete');
    await page.waitForTimeout(200);

    // ── Step 4: fill()로 값 한 번에 설정 (1차 시도) ─────────────────────────
    await searchInput.fill(serialNumber);
    await page.waitForTimeout(500);

    // ── Step 5: fill() 결과 검증 → 불일치 시 React nativeInputValueSetter fallback ──
    let currentValue = await searchInput.inputValue().catch(() => '');
    if (currentValue !== serialNumber) {
      logger.warn(`[searchSerial] fill() 불일치 (got: "${currentValue}") → pressSequentially 시도`);
      await searchInput.click({ clickCount: 3 });
      await page.waitForTimeout(200);
      await page.keyboard.press('Delete');
      await page.waitForTimeout(200);
      await searchInput.pressSequentially(serialNumber, { delay: 80 });
      await page.waitForTimeout(500);

      // pressSequentially 후에도 불일치면 JS nativeInputValueSetter로 강제 입력
      currentValue = await searchInput.inputValue().catch(() => '');
      if (currentValue !== serialNumber) {
        logger.warn(`[searchSerial] pressSequentially도 불일치 → JS nativeInputValueSetter fallback`);
        await page.evaluate((args: { selector: string; value: string }) => {
          const el = document.querySelector(args.selector) as HTMLInputElement | null;
          if (!el) return;
          // React의 controlled input을 강제로 업데이트하는 방법:
          // nativeInputValueSetter를 사용해 value를 설정한 뒤 input 이벤트를 dispatch
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, 'value'
          )?.set;
          if (nativeInputValueSetter) {
            nativeInputValueSetter.call(el, args.value);
          } else {
            el.value = args.value;
          }
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }, { selector: '[data-testid="search-input"]', value: serialNumber });
        await page.waitForTimeout(500);

        currentValue = await searchInput.inputValue().catch(() => '');
        if (currentValue !== serialNumber) {
          logger.error(`[searchSerial] 모든 입력 방법 실패 — 현재 값: "${currentValue}"`);
          throw new Error(`search-input에 시리얼 번호 입력 실패 (got: "${currentValue}")`);
        } else {
          logger.info(`[searchSerial] JS nativeInputValueSetter 성공: "${currentValue}"`);
        }
      } else {
        logger.info(`[searchSerial] pressSequentially 성공: "${currentValue}"`);
      }
    } else {
      logger.info(`[searchSerial] fill() 성공: "${currentValue}"`);
    }

    // ── Step 6: Enter로 검색 실행 ───────────────────────────────────────────
    await searchInput.press('Enter');
    await page.keyboard.press('Enter'); // 확실한 트리거를 위해 직접 Enter 키 입력 추가
    logger.info(`[searchSerial] Enter 입력 완료 → 검색 결과 대기`);

    // ── Step 7: 검색 결과 대기 ──────────────────────────────────────────────
    // networkidle 대신 실제 결과 row가 DOM에 나타날 때까지 대기.
    // tbody tr 또는 data-testid="menu-button"이 나타나면 결과 로드 완료로 판단.
    try {
      await page.waitForSelector(
        'tbody tr, [data-testid="menu-button"], [role="row"]',
        { timeout: 20000 }
      );
      logger.info(`[searchSerial] 검색 결과 row 감지 완료`);
    } catch {
      // 결과가 없을 수도 있으므로 fallback으로 네트워크 안정화 대기
      logger.warn(`[searchSerial] 결과 row 감지 실패 → networkidle fallback 대기`);
      await page.waitForLoadState('networkidle').catch(() => { });
      await page.waitForTimeout(2000);
    }

    logger.info(`시리얼 검색 완료: ${serialNumber}`);
  }

  // ============================================================
  // 옵션 버튼 클릭 (검색 결과 행의 오른쪽)
  // 검색된 시리얼의 행에서 옵션 버튼(⋮, ..., 또는 기어 아이콘)을 찾아 클릭
  // → 드롭다운 메뉴가 열림
  //
  // 감지 모드 (Settings에서 선택):
  //   A. cancel_option_button_text 설정 시: aria-label / has-text 기반 감지 (권장)
  //      예) "more options", "actions" → [aria-label*="more options" i] 또는 button:has-text(...)
  //   B. 비어있으면: CSS 클래스 자동 감지 (기존 동작, 하위 호환)
  // ============================================================
  private async clickOptionButton(page: Page, serialNumber: string, settings: any): Promise<void> {
    logger.info(`옵션 버튼 클릭: ${serialNumber}`);

    // ── 1순위: data-testid="menu-button" (확인된 Exocad 사이트 HTML) ──────────
    // 시리얼 번호가 있는 행(tr 또는 div[role="row"])에서 menu-button을 찾음
    // 검색 후 결과가 1건이면 첫 번째 menu-button이 대상
    let optionButton = page.locator(
      `tr:has-text("${serialNumber}") [data-testid="menu-button"], ` +
      `[role="row"]:has-text("${serialNumber}") [data-testid="menu-button"], ` +
      `[data-testid*="row"]:has-text("${serialNumber}") [data-testid="menu-button"]`
    ).first();

    let found = await optionButton.isVisible({ timeout: 3000 }).catch(() => false);

    // ── 2순위: 검색 결과가 단일 행이면 페이지 내 첫 번째 menu-button 사용 ──────
    if (!found) {
      logger.info('행 기반 탐색 실패 → 페이지 내 첫 번째 menu-button 시도');
      optionButton = page.locator('[data-testid="menu-button"]').first();
      found = await optionButton.isVisible({ timeout: 3000 }).catch(() => false);
    }

    // ── 3순위: cancel_option_button_text 설정값으로 aria-label 탐색 ─────────
    if (!found) {
      const optionButtonText = (settings.cancel_option_button_text || '').trim();
      if (optionButtonText) {
        logger.info(`menu-button 없음 → aria-label 탐색 ("${optionButtonText}")`);
        optionButton = page.locator(
          `[aria-label*="${optionButtonText}" i], button:has-text("${optionButtonText}")`
        ).first();
        found = await optionButton.isVisible({ timeout: 3000 }).catch(() => false);
      }
    }

    if (!found) {
      throw new Error(`옵션 버튼(menu-button)을 찾을 수 없습니다. 시리얼: ${serialNumber}`);
    }

    await optionButton.click();

    // 드롭다운 메뉴가 열리는 것을 대기
    await page.waitForTimeout(1500);
    logger.info('옵션 버튼 클릭 완료 → 드롭다운 열림');
  }

  // ============================================================
  // 제품명 기반으로 드롭다운 cancel 버튼 텍스트 결정
  // - Chairside  → "Cancel subscription"
  // - DentalCAD  → "Opt out upgrade"
  // - exoplan    → "Cancel subscription"
  // - 기타       → Settings의 cancel_button_text 값 사용
  // ============================================================
  private resolveCancelButtonLabel(productName: string, settings: any): string {
    const p = (productName || '').toLowerCase();
    if (p.includes('chairside') || p.includes('exoplan')) {
      return 'Cancel subscription';
    }
    if (p.includes('dentalcad')) {
      return 'Opt out upgrade';
    }
    // fallback to settings value
    return settings.cancel_button_text || 'Opt out upgrade';
  }

  // ============================================================
  // 검색 결과 행에서 제품명 읽기
  // 검색 후 첫 번째 행의 product 셀 텍스트를 반환
  // ============================================================
  private async getProductNameFromRow(page: Page): Promise<string> {
    try {
      // 사용자님이 지정하신 h-[72px] 클래스를 가진 td 셀들 탐색
      const productNames = await page.evaluate(() => {
        const rows = document.querySelectorAll('tbody tr, [role="row"]');
        if (rows.length === 0) return [];

        const targetCells = rows[0].querySelectorAll('td.h-\\[72px\\], td[class*="h-[72px]"]');
        return Array.from(targetCells).map(c => c.textContent?.trim() || '');
      });

      logger.info(`[getProductNameFromRow] 감지된 셀 텍스트: ${JSON.stringify(productNames)}`);

      const productKeywords = ['chairside', 'dentalcad', 'exoplan'];
      for (const text of productNames) {
        const lowerText = text.toLowerCase();
        for (const kw of productKeywords) {
          if (lowerText.includes(kw)) return text;
        }
      }

      // fallback: 이전에 사용하던 방식 (모든 셀 탐색)
      const allCellTexts = await page.evaluate(() => {
        const rows = document.querySelectorAll('tbody tr, [role="row"]');
        if (rows.length === 0) return [];
        return Array.from(rows[0].querySelectorAll('td, [role="cell"]'))
          .map(c => c.textContent?.trim() || '');
      });

      for (const cell of allCellTexts) {
        if (productKeywords.some(k => cell.toLowerCase().includes(k))) {
          return cell;
        }
      }

      return allCellTexts.find(t => t.length > 0) || '';
    } catch (err: any) {
      logger.warn(`제품명 읽기 실패: ${err.message}`);
      return '';
    }
  }

  // ============================================================
  // 드롭다운 메뉴에서 Cancel 항목 클릭
  // 제품명에 따라 "Cancel subscription" 또는 "Opt out upgrade" 클릭
  // Exact confirmed HTML:
  //   <button class="cursor-pointer px-4 py-3 text-left text-black-dark hover:bg-black-hover">Cancel subscription</button>
  //   <button class="cursor-pointer px-4 py-3 text-left text-black-dark hover:bg-black-hover">Opt out upgrade</button>
  // ============================================================
  private async clickCancelInDropdown(page: Page, settings: any, productName: string = ''): Promise<void> {
    const cancelLabel = this.resolveCancelButtonLabel(productName, settings);
    logger.info(`드롭다운에서 "${cancelLabel}" 클릭 (제품: ${productName || 'unknown'})`);

    // Exact selector: button with confirmed class pattern + exact text
    const cancelItem = page.locator(
      `button.cursor-pointer:has-text("${cancelLabel}"), ` +
      `button:has-text("${cancelLabel}")`
    ).first();

    await cancelItem.waitFor({ state: 'visible', timeout: 5000 });

    // ── TrustArc 쿠키 배너 제거 ─────────────────────────────────────────────
    // partner.exocad.com에서 consent_blackbar (TrustArc GDPR 배너)가
    // fixed bottom-0 z-50으로 화면 하단을 덮어 버튼 클릭을 차단하는 문제 수정.
    // 클릭 전에 JS로 배너 요소를 DOM에서 제거하여 포인터 이벤트 차단을 해소한다.
    await page.evaluate(() => {
      const banner = document.getElementById('consent_blackbar');
      if (banner) banner.remove();
      // TrustArc가 동적으로 추가하는 다른 오버레이도 함께 제거
      document.querySelectorAll('[id*="truste"], [class*="truste"], #teconsent').forEach(el => el.remove());
    }).catch(() => { /* 배너가 없으면 무시 */ });

    // force: true로 포인터 이벤트 차단 요소 무시하여 확실히 클릭
    await cancelItem.click({ force: true });

    await page.waitForTimeout(1500);
  }

  // ============================================================
  // 제품명 기반으로 확인 팝업 버튼 텍스트 결정
  // - Chairside / exoplan → "Confirm cancellation"
  // - DentalCAD           → "Opt out"
  // - 기타                → Settings 값 또는 bg-red-55 fallback
  // ============================================================
  private resolveConfirmButtonLabel(productName: string, settings: any): string {
    const p = (productName || '').toLowerCase();
    if (p.includes('chairside') || p.includes('exoplan')) {
      return 'Confirm cancellation';
    }
    if (p.includes('dentalcad')) {
      return 'Opt out';
    }
    // fallback: settings에 값이 있으면 사용, 없으면 'Opt out'
    return settings.confirm_button_text || 'Opt out';
  }

  // ============================================================
  // 확인 팝업에서 제품별 확인 버튼 클릭
  // Exact confirmed HTML:
  //   <button type="button" class="... bg-red-55 text-white ...">Confirm cancellation</button>
  //   <button type="button" class="... bg-red-55 text-white ...">Opt out</button>
  // ============================================================
  private async confirmCancel(page: Page, settings: any, productName: string = ''): Promise<void> {
    const confirmLabel = this.resolveConfirmButtonLabel(productName, settings);
    logger.info(`확인 팝업에서 "${confirmLabel}" 클릭 (제품: ${productName || 'unknown'})`);

    // ── TrustArc 쿠키 배너 제거 (confirm 팝업 클릭 차단 방지) ──────────────
    await page.evaluate(() => {
      const banner = document.getElementById('consent_blackbar');
      if (banner) banner.remove();
      document.querySelectorAll('[id*="truste"], [class*="truste"], #teconsent').forEach(el => el.remove());
    }).catch(() => { });

    // 1순위: 제품별로 결정된 정확한 텍스트로 버튼 찾기
    let confirmButton = page.locator(
      `button.bg-red-55:has-text("${confirmLabel}"), ` +
      `button[type="button"].bg-red-55:has-text("${confirmLabel}"), ` +
      `button[type="button"]:has-text("${confirmLabel}")`
    ).first();

    try {
      await confirmButton.waitFor({ state: 'visible', timeout: 8000 });
      logger.info(`확인 버튼 감지 완료: "${confirmLabel}"`);
    } catch {
      // 2순위 fallback: bg-red-55 클래스를 가진 아무 버튼 (색상이 빨간 확인 버튼)
      logger.warn(`"${confirmLabel}" 텍스트로 못 찾음 → bg-red-55 버튼 fallback 시도`);
      confirmButton = page.locator(
        'button.bg-red-55, button[type="button"][class*="bg-red-55"]'
      ).first();
      try {
        await confirmButton.waitFor({ state: 'visible', timeout: 5000 });
        const btnText = await confirmButton.textContent();
        logger.info(`bg-red-55 fallback 버튼 발견: "${btnText?.trim()}"`);
      } catch (err2: any) {
        logger.error(`확인 팝업 버튼을 찾을 수 없습니다: ${err2.message}`);
        throw new Error(`확인 팝업 버튼을 찾을 수 없습니다 (시도: "${confirmLabel}", bg-red-55 fallback)`);
      }
    }

    await confirmButton.click({ force: true });
    await page.waitForLoadState('networkidle').catch(() => { });
    await page.waitForTimeout(3000);
    logger.info('확인 팝업 클릭 완료');
  }

  // ============================================================
  // Cancel 결과 검증
  // 확인 버튼 클릭 후 페이지에서 해당 시리얼이
  // "opted out" 또는 "expired" 상태인지 확인
  // ============================================================
  private async verifyCancelResult(page: Page, serialNumber: string): Promise<{ verified: boolean; status: string }> {
    try {
      // cancel 완료 후 페이지 갱신 대기
      await page.waitForTimeout(2000);

      // 시리얼이 포함된 행에서 상태 텍스트 확인
      const statusTexts = await page.evaluate((sn: string) => {
        const rows = Array.from(document.querySelectorAll('tbody tr, [role="row"]'));
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          if (row.textContent?.includes(sn)) {
            const cells = Array.from(row.querySelectorAll('td, [role="cell"]'));
            return cells.map((c: Element) => (c as HTMLElement).textContent?.trim()?.toLowerCase() || '');
          }
        }
        return [] as string[];
      }, serialNumber);

      const successStatuses = ['opted out', 'expired', 'cancelled', 'canceled'];
      const foundStatus = statusTexts.find(t => successStatuses.some(s => t.includes(s)));

      if (foundStatus) {
        logger.info(`[검증] ${serialNumber}: 상태 확인됨 → "${foundStatus}"`);
        return { verified: true, status: foundStatus };
      }

      // 행이 사라졌거나 상태가 변경된 경우도 성공으로 간주
      if (statusTexts.length === 0) {
        logger.info(`[검증] ${serialNumber}: 결과 행 없음 (cancel 완료로 간주)`);
        return { verified: true, status: 'row_removed' };
      }

      logger.warn(`[검증] ${serialNumber}: 상태 확인 실패 — 감지된 셀: ${JSON.stringify(statusTexts)}`);
      return { verified: false, status: statusTexts.join(' | ') };
    } catch (err: any) {
      logger.warn(`[검증] ${serialNumber}: 오류 — ${err.message}`);
      return { verified: false, status: `error: ${err.message}` };
    }
  }

  // ============================================================
  // 결과 스크린샷 캡처
  // cancel 완료 후 현재 페이지 상태를 PNG로 저장
  // ============================================================
  private async captureResultScreenshot(page: Page, serialNumber: string): Promise<string> {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const filename = `cancel_${serialNumber}_${timestamp}.png`;
      const filepath = path.join(getScreenshotDir(), filename);

      await page.screenshot({ path: filepath, fullPage: false });
      logger.info(`[스크린샷] 저장: ${filepath}`);
      return filepath;
    } catch (err: any) {
      logger.warn(`[스크린샷] 캡처 실패: ${err.message}`);
      return '';
    }
  }

  // ============================================================
  // 만료된 시리얼 일괄 cancel 처리 (즉시 만료)
  // - 오늘 날짜 기준으로 만료된 active 시리얼을 조회
  // - 갱신 요청(pending renewal)이 있는 시리얼은 건너뜀
  // - 한 번의 로그인으로 여러 시리얼을 순차 처리 (세션 재사용)
  // ============================================================
  async processExpiredSerials(): Promise<CancelResult[]> {
    const today = new Date().toISOString().slice(0, 10);
    const expiringSerials = serialService.getExpiringSerials(today);
    const results: CancelResult[] = [];

    for (const serial of expiringSerials) {
      // 갱신 요청이 있는 경우 cancel하지 않고 skip
      if (serialService.hasPendingRenewal(serial.id)) {
        logger.info(`Cancel 건너뜀: ${serial.serial_number} (갱신 요청 있음)`);
        continue;
      }

      const result = await this.cancelSubscription(serial.serial_number, true); // headless: background
      if (result.success) {
        // DB에서 해당 시리얼의 상태를 'cancelled'로 변경
        serialService.cancelSubscription(serial.id);
      }
      results.push(result);

      // 연속 요청 시 서버 부하 방지를 위한 딜레이 (2초)
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    return results;
  }

  // ============================================================
  // 만료 N일 전 자동 cancel 처리 (갱신 요청 없을 때만)
  // Settings의 auto_cancel_enabled / auto_cancel_days_before 기반으로 동작
  // - 스케줄러가 매일 자정에 호출
  // - 만료일이 "오늘 + N일" 인 active 시리얼 조회
  // - 갱신 요청(pending renewal)이 있으면 건너뜀
  // - 없으면 Exocad 사이트에서 자동 cancel 실행
  // ============================================================
  async processPreExpiryAutoCancel(): Promise<CancelResult[]> {
    const settings = getSettings();

    if (!settings.auto_cancel_enabled) {
      logger.info('자동 cancel 비활성화 — 건너뜀');
      return [];
    }

    const daysBefore = settings.auto_cancel_days_before ?? 1;
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + daysBefore);
    const targetDateStr = targetDate.toISOString().slice(0, 10);

    logger.info(`자동 cancel 체크: 만료일 = ${targetDateStr} (D-${daysBefore})`);

    // 만료일이 정확히 N일 후인 active 시리얼 조회
    const targetSerials = serialService.getExpiringSerialsOnDate(targetDateStr);
    const results: CancelResult[] = [];

    for (const serial of targetSerials) {
      // 갱신 요청이 있으면 skip
      if (serialService.hasPendingRenewal(serial.id)) {
        logger.info(`자동 cancel 건너뜀: ${serial.serial_number} (갱신 요청 있음)`);
        continue;
      }

      logger.info(`자동 cancel 실행: ${serial.serial_number} (만료일 ${serial.expiry_date}, 갱신 요청 없음)`);
      const result = await this.cancelSubscription(serial.serial_number, true); // headless: background
      if (result.success) {
        serialService.cancelSubscription(serial.id);
      }
      results.push(result);

      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    logger.info(`자동 cancel 완료: ${results.length}건 처리`);
    return results;
  }

  // ============================================================
  // 만료 N일 전 자동 cancel 대상 리스트 조회 (dry-run)
  // processPreExpiryAutoCancel()과 동일한 로직으로 대상 시리얼을 판별하고
  // 각 시리얼에 대해 Playwright로 실제 사이트까지 확인 (confirm 버튼은 누르지 않음)
  // ============================================================
  async processPreExpiryDryRun(): Promise<CancelDryRunResult[]> {
    const settings = getSettings();

    const daysBefore = settings.auto_cancel_days_before ?? 1;
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + daysBefore);
    const targetDateStr = targetDate.toISOString().slice(0, 10);

    logger.info(`[Dry-Run] 자동 cancel 체크: 만료일 = ${targetDateStr} (D-${daysBefore})`);

    const targetSerials = serialService.getExpiringSerialsOnDate(targetDateStr);
    const results: CancelDryRunResult[] = [];

    // ── 대상 시리얼이 없으면 테스트용 시리얼로 Playwright 동작 검증 ──────────
    // DB에 만료 예정 시리얼이 없어도 로그인→검색→옵션→cancel 클릭 흐름이
    // 올바르게 동작하는지 확인할 수 있도록 하드코딩된 테스트 시리얼을 사용한다.
    const TEST_SERIAL = '40E83399-8C74-A0721A02';
    if (targetSerials.length === 0) {
      logger.info(`[Dry-Run] 만료 예정 시리얼 없음 → 테스트 시리얼 (${TEST_SERIAL})로 Playwright 동작 검증`);
      const dryResult = await this.checkCancelDryRun(TEST_SERIAL);
      results.push({
        ...dryResult,
        customer_name: dryResult.customer_name || '(테스트)',
        expiry_date: dryResult.expiry_date || targetDateStr,
        has_renewal: false,
        is_test_serial: true,
      });
      logger.info(`[Dry-Run] 테스트 시리얼 검증 완료`);
      return results;
    }

    for (const serial of targetSerials) {
      const hasRenewal = serialService.hasPendingRenewal(serial.id);

      if (hasRenewal) {
        // 갱신 요청 있음 → 실제 cancel에서 skip될 대상 (Playwright 불필요)
        results.push({
          serial_number: serial.serial_number,
          customer_name: serial.customer_name,
          expiry_date: serial.expiry_date,
          has_renewal: true,
        });
        logger.info(`[Dry-Run] skip (갱신 요청 있음): ${serial.serial_number}`);
        continue;
      }

      // 갱신 요청 없음 → 실제 cancel 대상, Playwright 확인 실행
      logger.info(`[Dry-Run] Playwright 확인 시작: ${serial.serial_number}`);
      const dryResult = await this.checkCancelDryRun(serial.serial_number);
      results.push({
        ...dryResult,
        customer_name: serial.customer_name,
        expiry_date: serial.expiry_date,
        has_renewal: false,
      });

      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    logger.info(`[Dry-Run] 완료: 총 ${results.length}건 (skip ${results.filter(r => r.has_renewal).length}, 확인 ${results.filter(r => !r.has_renewal).length})`);
    return results;
  }

  // ============================================================
  // 단일 시리얼 Cancel Playwright Dry-Run
  // 로그인 → 검색 → 옵션 버튼 → cancel 메뉴 항목 가시성 확인
  // (confirm 버튼은 클릭하지 않음)
  // ============================================================
  async checkCancelDryRun(serialNumber: string): Promise<CancelDryRunResult> {
    const settings = getSettings();
    const result: CancelDryRunResult = {
      serial_number: serialNumber,
      customer_name: '',
      expiry_date: '',
      has_renewal: false,
      login_ok: false,
      serial_found: false,
      option_btn_found: false,
      cancel_item_found: false,
    };

    const dryBrowser = await chromium.launch({
      headless: false,
      args: [
        // ── 패스워드 저장 팝업 완전 차단 (Dry-Run) ──────────────────────────
        '--disable-save-password-bubble',
        '--disable-features=PasswordManager,AutofillServerCommunication',
        '--password-store=basic',
      ],
    });
    const dryContext = await dryBrowser.newContext();
    // 네이티브 다이얼로그 자동 dismiss
    dryContext.on('page', (p) => {
      p.on('dialog', async (dialog) => {
        logger.info(`[Dry-Run][dialog] auto-dismiss: type=${dialog.type()}, msg=${dialog.message().slice(0, 80)}`);
        await dialog.dismiss().catch(() => { });
      });
    });
    const page = await dryContext.newPage();

    try {
      // ── Step 1: 로그인 ──────────────────────────────────────────────────────
      await this.login(page, settings);
      result.login_ok = true;
      logger.info(`[Dry-Run] ${serialNumber} ✓ 로그인`);

      // ── Step 2: 라이선스 관리 페이지로 이동 ───────────────────────────────
      // 로그인 완료 후 SSO 리다이렉트로 이미 target URL에 있을 수 있음.
      // 이 경우 goto()를 호출하면 불필요한 페이지 재로딩이 발생하므로 URL 비교 후 스킵.
      const postLoginUrl = page.url();
      logger.info(`[Dry-Run] 로그인 후 현재 URL: ${postLoginUrl}`);
      if (!postLoginUrl.startsWith(settings.exocad_site_url)) {
        logger.info(`[Dry-Run] target URL이 아님 → goto 실행`);
        await page.goto(settings.exocad_site_url, { waitUntil: 'domcontentloaded' });
        // React SPA가 완전히 마운트될 때까지 networkidle 대기
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {
          logger.warn('[Dry-Run] networkidle 타임아웃 — searchSerial에서 element 대기로 진행');
        });
      } else {
        logger.info(`[Dry-Run] 이미 target URL에 있음 → goto 생략, networkidle 대기`);
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {
          logger.warn('[Dry-Run] networkidle 타임아웃 — searchSerial에서 element 대기로 진행');
        });
      }

      // ── Step 3: 시리얼 검색 ────────────────────────────────────────────────
      await this.searchSerial(page, serialNumber);

      // 검색 결과에 시리얼 번호가 실제로 표시되는지 확인
      const serialVisible = await page.locator(`text="${serialNumber}"`).first()
        .isVisible({ timeout: 5000 }).catch(() => false);
      result.serial_found = serialVisible;
      logger.info(`[Dry-Run] ${serialNumber} ${serialVisible ? '✓' : '✗'} 시리얼 검색결과 표시`);

      if (!serialVisible) {
        result.error = `검색 결과에 시리얼(${serialNumber})이 표시되지 않음`;
        return result;
      }

      // ── Step 4: 제품명 읽기 ────────────────────────────────────────────────
      const productName = await this.getProductNameFromRow(page);
      result.product_name = productName;
      const cancelLabel = this.resolveCancelButtonLabel(productName, settings);
      result.cancel_btn_label = cancelLabel;
      logger.info(`[Dry-Run] ${serialNumber} 제품명: "${productName}" → 버튼: "${cancelLabel}"`);

      // ── Step 5: 옵션 버튼(menu-button) 클릭 ──────────────────────────────
      await this.clickOptionButton(page, serialNumber, settings);
      result.option_btn_found = true;
      logger.info(`[Dry-Run] ${serialNumber} ✓ 옵션 버튼 클릭`);

      // ── Step 6: 드롭다운에서 cancel 메뉴 항목 가시성 확인 ─────────────────
      const cancelItem = page.locator(
        `button.cursor-pointer:has-text("${cancelLabel}"), ` +
        `button:has-text("${cancelLabel}")`
      ).first();

      const isVisible = await cancelItem.isVisible({ timeout: 5000 }).catch(() => false);
      result.cancel_item_found = isVisible;
      logger.info(`[Dry-Run] ${serialNumber} ${isVisible ? '✓' : '✗'} cancel 메뉴 항목 ("${cancelLabel}")`);

      if (!isVisible) {
        result.error = `드롭다운에서 "${cancelLabel}" 버튼을 찾을 수 없음 (제품: "${productName}")`;
      } else {
        // ── Step 7: cancel 메뉴 항목 클릭 (확인 팝업은 클릭하지 않음) ────────
        // 실제 cancel 흐름과 동일하게 드롭다운 버튼을 클릭하여 확인 다이얼로그가
        // 열리는 것까지 검증한다. 단, "Confirm cancellation" 버튼은 누르지 않아
        // 실제 취소는 발생하지 않는다.
        logger.info(`[Dry-Run] ${serialNumber} → "${cancelLabel}" 클릭 (확인 팝업은 클릭하지 않음)`);
        await cancelItem.click();
        await page.waitForTimeout(2000);
        result.cancel_item_clicked = true;
        logger.info(`[Dry-Run] ${serialNumber} ✓ cancel 드롭다운 버튼 클릭 완료 — 확인 팝업 열림 상태 (확인하지 않음)`);
      }

    } catch (err: any) {
      logger.error(`[Dry-Run] ${serialNumber} 오류: ${err.message}`);
      result.error = err.message;
    } finally {
      await page.close().catch(() => { });
      await dryContext.close().catch(() => { });
      await dryBrowser.close().catch(() => { });
    }

    return result;
  }

  // ============================================================
  // 브라우저 종료
  // 앱 종료 시 또는 수동으로 브라우저를 닫을 때 호출
  // ============================================================
  async closeBrowser(): Promise<void> {
    if (this.context) {
      await this.context.close();
      this.context = null;
    }
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
    this.isLoggedIn = false;
  }
}

export const cancelService = new CancelService();
