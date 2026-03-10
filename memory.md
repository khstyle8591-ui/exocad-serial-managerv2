# Exocad Manager — Memory

> Last Update: 2026-03-03 (Order Polling — CAD Category Pre-select)

## Projects

### 1. exocad-manager (Electron Desktop App)
- **Path**: `C:\Users\pf-5y\OneDrive\Desktop\Project\exocad-manager`
- **Stack**: Electron 28, React 18, TypeScript 5, Vite, better-sqlite3
- **Tools**: Playwright (Chromium), node-pop3, imap, nodemailer, node-cron, xlsx

### 2. exocad-web-server (Web Server — NEW)
- **Path**: `C:\Users\pf-5y\OneDrive\Desktop\Project\exocad-web-server`
- **Stack**: Express.js + React 18 + Vite, better-sqlite3, same service layer
- **Status**: ✅ Running on External Server (Oracle Cloud).
- **Public URL**: Managed via `scripts/tunnel.js` (supports Cloudflare, ngrok, direct).
- **Deployment**: `scripts/deploy.sh` for one-click Ubuntu setup.
- **Config**: Settings managed via `.env` (prioritized) and `tunnel.config.json`.

## exocad-web-server Architecture

- `src/main/`: Node.js backend services (copied & adapted from Electron)
  - `database.ts` — uses `process.cwd()/data` (not Electron path)
  - `settings.ts`, `scheduler.ts`, `utils/logger.ts`
  - `services/`: serial, cancel, email-monitor, notification, excel, order
  - `types/node-pop3.d.ts` — custom declaration shim
- `src/server/`: Express HTTP server
  - `index.ts` — entry point, mounts all routers, serves React build
  - `routes/`: serials, settings, orders, logs, cancel, renewal, reports
- `src/renderer/`: React frontend, uses `src/renderer/api.ts` (fetch-based, replaces `window.electronAPI`)
- `src/shared/types.ts`

### Key Adaptations (Electron → Web)
- `window.electronAPI.*` → `api.*` (fetch calls to `/api/...`)
- `app.getPath('userData')` → `process.cwd()/data`
- `dialog.showOpenDialog()` → `<input type="file">` + multipart POST
- `generateTemplate()` → returns `Buffer` for HTTP streaming
- `ipcMain` handlers → Express routes

### Build Fixes Applied
- `tsconfig.server.json` `outDir`: `"dist/server"` → `"dist"` (rootDir=src → src/server/index.ts compiles to dist/server/index.js)
- `vite.config.mts` `root`/`outDir`: changed to `path.resolve(__dirname,...)` + `fileURLToPath(import.meta.url)` for ESM `__dirname`
- `tsconfig.server.json` `lib`: added `"dom"` for Playwright `page.evaluate()` callbacks
- Route imports: `../main/` → `../../main/` (routes are in `src/server/routes/`)
- `node-pop3` has no `@types` — added `src/main/types/node-pop3.d.ts`
- Removed Windows-incompatible `postinstall` script (used Unix `true` command)

## exocad-manager Architecture (Electron)

- `src/main/`: Electron Main — `database.ts`, `settings.ts`, `ipc-handlers.ts`, `preload.ts`, `scheduler.ts`
  - `services/`: serial, cancel, email-monitor, notification, excel, order
- `src/renderer/`: React UI — `App.tsx`, `i18n.ts` (ko/en/ja), pages/
- `src/shared/types.ts`

## DB Schema (shared between both projects)
- `serials`: active/cancelled/expired serials
- `renewal_requests`: renewal logs (email/manual)
- `activity_logs`: registered/renewed/cancelled/addon_added/bulk_imported
- `settings`: key-value config
- `pending_orders`: URL-polled orders awaiting approval

## Key Features
- **Auto-Cancel**: D-N days before expiry, no pending renewal → Playwright cancels on Exocad site
  - Login fallback `pm@geomedi.co.jp`, SSO button, search via fill/pressSequentially/JS nativeInputValueSetter
  - Product detection: `td.h-[72px]`, Chairside/exoplan → "Cancel subscription", DentalCAD → "Opt out upgrade"
- **Renewal Detection**: POP3/IMAP email scan, keyword match + `dedicated_email` header detection
  - `testMailConnection(settingsOverride?)` — tests with unsaved form values
  - `renewalDryRun()` — read-only preview of what would be processed
- **Order Polling**: Playwright crawls geomedi.online, pagination via `a[href="#N"]`, keyword filter on 품명
  - ⭐ **CAD Pre-select**: `stock_serial.html` 접속 후 폴링 전 `select[name="s_h_code_fk"]` 값을 `"0013"(CAD)`으로 설정 → `change` 이벤트 + `sub_dir10()` 호출 → 2000ms 대기 → 날짜 설정 → 검색. `crawlSource` + `crawlSourceDryRun` 양쪽 모두 적용.
- **Reporting**: Daily + monthly reports via Slack webhook + SMTP email

## TODO
- [x] Set up `cloudflared` on external server.
- [x] Create one-click deployment script (`deploy.sh`).
- [x] Implement dynamic tunnel switcher (`scripts/tunnel.js`).
- [x] Move configuration to `.env` as primary source.
- [ ] Set up Cloudflare Named Tunnel for fixed permanent URL.
- [ ] E2E verify full cancel flow with an Active serial in web server.

## Dev Commands

### exocad-web-server
- `npm run build` — compile server (tsc) + renderer (vite)
- `npm start` — run Express on port 3000
- `npm run tunnel` — Cloudflare public URL (cloudflared must be installed)
- `npm run pm2:start` — 24/7 with PM2
- `npm run playwright:install` — install Chromium for auto-cancel
- Build check: `cmd /c "cd C:\Users\pf-5y\OneDrive\Desktop\Project\exocad-web-server && npx tsc -p tsconfig.server.json --noEmit 2>&1"`

### exocad-manager (Electron)
- `npm run dev` — run all (main + renderer + electron)
- Build check: `cmd /c "node_modules\.bin\tsc -p tsconfig.main.json --noEmit"` (PowerShell execution policy workaround)


## Project Overview
Exocad serial number management automation desktop app.
- **Stack**: Electron 28, React 18, TypeScript 5, Vite, tsc
- **Tools**: SQLite (better-sqlite3), Playwright (Chromium), node-pop3, imap, nodemailer, node-cron, xlsx (SheetJS)

## Architecture
- `src/main/`: Electron Main.
  - `database.ts`, `settings.ts`, `ipc-handlers.ts`, `preload.ts`, `scheduler.ts` (cron jobs).
  - `services/`: `serial` (CRUD), `cancel` (Playwright), `email-monitor` (POP3/IMAP), `notification` (Slack/SMTP), `excel`, `order` (URL polling).
- `src/renderer/`: React UI.
  - `App.tsx`, `i18n.ts` (ko/en/ja), `pages/` (Dashboard, Serials, Orders, Settings, Logs).
- `src/shared/`: `types.ts` (Shared types, IPC channels).

## DB Schema
- `serials`: Master serials (active/cancelled/expired).
- `renewal_requests`: Renewal logs from email/manual.
- `activity_logs`: Logs for registered/renewed/cancelled/addon_added/bulk_imported.
- `settings`: Key-Value config.
- `pending_orders`: URL polled orders.

## Recent Updates (2026-02-20)

### 1. Auto-Cancel Optimization & Dry-Run
- **Fixes (`cancel.service.ts`)**:
  - Login fallback `pm@geomedi.co.jp`, SSO button detection, wait strategy `domcontentloaded`+`waitForURL`.
  - Search: double trigger + fallback input (`fill` → `pressSequentially` → JS `nativeInputValueSetter`).
  - Product Detection: `td.h-[72px]`, fallback all cells (Chairside/DentalCAD/exoplan).
  - Cancel Buttons: Chairside/exoplan → "Cancel subscription", DentalCAD → "Opt out upgrade".
- **Dry-Run Result**: Tested with `40E83399-8C74-A0721A02` (already cancelled, correctly skipped).

### 2. Order Polling Bug Fixes
- **Fixes (`order.service.ts`)**: Filter tables <5 cols, fix `商品コード` typo, `YY.MM.DD`→`20YY-MM-DD` parsing, login selector `button.btn_login`, `dispatchEvent('input')`, `serial_alt` fallback, **Pagination** via `a[href="#N"]` loop.

### 4. Order Polling — CAD 품목대분류 사전 선택 (2026-03-03)
- **변경 파일**: `src/main/services/order.service.ts`
- **변경 위치**: `crawlSource()` 및 `crawlSourceDryRun()` 내 `stock_serial.html` 처리 블록
- **로직**: 페이지 접속 후 날짜 설정 전에 아래 순서로 실행
  1. `select[name="s_h_code_fk"]` `.value = '0013'` 설정
  2. `change` 이벤트 `dispatchEvent` (bubbles: true)
  3. `window.sub_dir10()` 직접 호출 (onchange 핸들러)
  4. `waitForTimeout(2000)` — 소분류 갱신 대기
  5. 날짜 설정 → 검색 버튼 클릭 (기존 동작)
- **로그**: 성공 시 `품목대분류 CAD(0013) 선택 완료`, 실패 시 `s_h_code_fk 드롭다운을 찾지 못했습니다.` (warn)
- **빌드**: `tsc --noEmit` 통과 확인

### 3. Renewal Detection — Dry-Run, Keyword Settings, Connection Test
- **New methods (`email-monitor.service.ts`)**:
  - `renewalDryRun()`: Scans POP3/IMAP (no delete/markSeen). Returns matched emails with `matched_keywords`, `is_dedicated`, `serial_number`, `serial_exists`. IMAP fetches last 50 ALL mails read-only.
  - `testMailConnection(settingsOverride?)`: POP3 uses `UIDL()` for count; IMAP opens INBOX read-only. Accepts `settingsOverride` param so unsaved form values can be tested without saving first.
- **Bug Fixed**: Connection test was reading DB (saved settings). Fixed by passing current `formVals.current` from Settings.tsx → IPC (`renewal:testConnection`) → service override.
- **New types (`types.ts`)**: `RenewalDryRunEmail`, `RenewalDryRunResult`, `MailConnectionResult`. IPC channels: `renewal:dryRun`, `renewal:testConnection`.
- **Settings UI (`Settings.tsx`)**: Added to mail section — 🔑 keyword editor (moved from `section_other`), 🔌 connection test button (+result badge), 🔍 Renewal Dry-Run button (+results table: From/Subject/Date/Keywords/Dedicated/Serial/DBExists).

## Auto-Cancel Flow
- **Trigger**: `auto_cancel_enabled` && D-N days to expiry && `hasPendingRenewal()` == false.
- **Flow**: Scheduler → `processPreExpiryAutoCancel()` → `cancelSubscription(serial)` → DB status 'cancelled'.
- **Settings**: Days before (`auto_cancel_days_before`), time (`auto_cancel_time`), credentials, URLs.
- **Renewal Detection**: Keywords configurable in Settings (`renewal_keywords[]`). Also detects `dedicated_email` in headers (Delivered-To, X-Forwarded-To, etc.) without keywords.

## TODO
- Implement Webhook Express server (Medium).
- Define active restoration policy on cancelled serial renewal (Medium).
- Link Webhook port & auto-cancel time to UI (Low).
- E2E verify full cancel flow with an Active serial (High).

## Dev Commands
- `npm run dev` (run everything sequentially/concurrently)
- `npm run dev:main`, `npm run dev:renderer`, `npm run dev:electron`.
- Build check: `cmd /c "node_modules\.bin\tsc -p tsconfig.main.json --noEmit"` (PowerShell 실행 정책 제한으로 npx 대신 직접 경로 호출)
