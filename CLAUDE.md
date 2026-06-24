# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development (server + Vite dev server)
npm run dev:web

# Type-check only (no emit)
tsc --noEmit                        # renderer/portal-client
tsc --noEmit -p tsconfig.main.json  # main/server process

# Build (all deployable artifacts)
npm run build          # build:main + build:manager + build:portal
npm run build:main     # tsc -p tsconfig.main.json                  → dist/main
npm run build:portal   # vite build --config vite.portal.config.ts  → dist/portal-client
npm run build:manager  # vite build --config vite.manager.config.ts → dist/manager

# Run built server
npm run start:server   # node dist/main/server.js
# Production runs this under PM2 — see ecosystem.config.js

# After adding/changing native deps (rebuilds better-sqlite3 against the host Node ABI)
npm rebuild better-sqlite3

# Install Playwright browser (required once)
npx playwright install chromium
```

## Architecture

This is a **Node.js + Express + React + TypeScript + SQLite** web app, deployed as a single Express server on a GCP VM behind a Cloudflare Tunnel (no Electron — the desktop app was abandoned).

### Server (`src/main/server.ts`)

The actual production entrypoint (`ecosystem.config.js` → PM2 → `dist/main/server.js`):
- Initializes the DB, starts the cron schedulers (`startScheduler`, `startPollingScheduler`)
- Mounts REST routers from `src/server/routes/*` under `/api/*` (BasicAuth + rate-limited)
- Mounts the customer portal router (`src/server/portal/`) under `/portal/*`
- Serves the manager SPA (`dist/manager`, built from `src/renderer/`) as static files at `/manage` (BasicAuth)
- Serves the portal-client SPA (`dist/portal-client`, built from `src/portal-client/`) as static files at `/` (self-authenticated)
- Listens on HTTP always; adds HTTPS if Let's Encrypt certs are present at `CERT_DIR`

All business logic lives in `src/main/services/`, called directly by the route handlers — there is no IPC layer.

### REST Flow

```
renderer (src/renderer/api.ts, fetch-based) → /api/* → router in src/server/routes/* → service in src/main/services/*
```

Adding a new feature: (1) add/extend a service in `src/main/services/`, (2) add a route in the matching `src/server/routes/*.ts` router, (3) add a method to `src/renderer/api.ts` wrapping the `fetch` call, (4) call it from the React UI.

**Shared types** (`src/shared/types.ts`): TypeScript interfaces shared between server and renderer (no IPC channel constants — those were removed with the Electron layer).

### Services (`src/main/services/`)

| File | Responsibility |
|------|---------------|
| `serial.service.ts` | Serial CRUD, bulk Excel import |
| `cancel.service.ts` | Playwright automation against Exocad SSO site |
| `order.service.ts` | URL polling (Playwright), pending orders DB |
| `mail/inbound.service.ts` | POP3/IMAP inbound mail classification and stop-request handling |
| `mail/template.service.ts` | Built-in and custom mail template CRUD |
| `mail/smtp.service.ts` | Template-based transactional mail sending |
| `notification.service.ts` | Slack webhook + SMTP email notifications |
| `excel.service.ts` | Excel template generation and parsing |

### Database (`src/main/database.ts`)

SQLite file path comes from the required `DB_PATH` env var (see `ecosystem.config.js`) — no fallback. Tables: `serials`, `renewal_requests`, `activity_logs`, `settings`, `pending_orders`. Settings are stored as key-value pairs in the `settings` table (serialized JSON for complex values like arrays/objects).

### Scheduling (`src/main/scheduler.ts`)

`node-cron` drives two schedulers:
- `startScheduler()` — auto-cancel cron (reads `auto_cancel_time` from settings)
- `startPollingScheduler()` in `order.service.ts` — URL polling cron (per-source `schedule_times`)

Both are started directly in `server.ts` on boot and stopped on `SIGTERM`/`SIGINT`.

### i18n

`src/renderer/i18n.ts` contains `ko`/`en`/`ja` translation tables. Access via `useLang()` hook (from `LanguageContext` in `App.tsx`) and `t(lang, key)` function.

### Build Output Paths

```
tsconfig.main.json: rootDir=src → outDir=dist/main
  src/main/server.ts   → dist/main/main/server.js   (package.json "main", PM2 entry)
  src/shared/types.ts  → dist/main/shared/types.js

vite.manager.config.ts: root=src/renderer → outDir=dist/manager   (served at /manage)
vite.portal.config.ts:  root=src/portal-client → outDir=dist/portal-client (served at /)
```

`vite.config.mts` is a dev-only Vite config used by `dev:web`/`dev:renderer` to serve the manager UI with HMR; it has no production build target (the deployable manager bundle comes from `vite.manager.config.ts`).

### Deployment

- Runs as a single Node process under PM2 (`ecosystem.config.js`) on a GCP e2-micro VM
- Exposed to the internet via a Cloudflare Quick Tunnel (URL changes on restart; `server.ts`'s CORS allowlist auto-allows `*.trycloudflare.com`)
- Required env vars: `DB_PATH`, `API_USER`, `API_PASSWORD_HASH`, `ALLOWED_ORIGIN` (production), plus mail/Slack settings — see `ecosystem.config.js`

### Playwright Cancel Flow (`cancel.service.ts`)

The Exocad site automation sequence (confirmed selectors):
1. SSO login: email → Continue → password
2. Navigate to `exocad_site_url`
3. Search serial: `[data-testid="search-input"]`
4. Extract product name from result row
5. Click option menu: `[data-testid="menu-button"]` (3-tier fallback)
6. Resolve cancel button label by product keyword (chairside/exoplan → "Cancel subscription", dentalcad → "Opt out upgrade")
7. Confirm cancel: `button.bg-red-55:has-text("Confirm cancellation")`
