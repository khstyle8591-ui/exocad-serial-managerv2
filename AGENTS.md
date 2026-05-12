# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Commands

```bash
# Development (runs 3 concurrent processes)
npm run dev

# Type-check only (no emit)
tsc --noEmit                        # renderer
tsc --noEmit -p tsconfig.main.json  # main process

# Build
npm run build         # build:main (tsc) + build:renderer (vite)
npm run build:main    # tsc -p tsconfig.main.json
npm run build:renderer # vite build --config vite.config.mts

# Run built app
npm start             # electron dist/main/main/index.js

# Package (Windows x64 exe, output → ExocadBuild/)
npm run package       # npm run build && node scripts/package.js

# After adding/changing native deps
npx electron-rebuild -f -w better-sqlite3

# Install Playwright browser (required once)
npx playwright install chromium
```

## Architecture

This is an **Electron + React + TypeScript + SQLite** desktop app. The process boundary is the most important architectural concept:

### Process Boundary

**Main process** (`src/main/`, compiled to CommonJS via `tsconfig.main.json`):
- Runs in Node.js — has full filesystem, DB, and native module access
- Entry: `src/main/index.ts` → initializes DB, registers IPC handlers, starts schedulers
- All business logic lives in `src/main/services/`

**Renderer process** (`src/renderer/`, compiled by Vite as ESM):
- React UI — no direct Node.js access
- Communicates with main via `window.electronAPI` (exposed in `preload.ts`)

**Preload** (`src/main/preload.ts`):
- Critical constraint: **no external module imports** — runs in Electron sandbox where `require()` is blocked. IPC channel strings must be inlined, not imported from `shared/types`.

**Shared types** (`src/shared/types.ts`):
- All TypeScript interfaces/types shared between main and renderer
- Contains `IPC_CHANNELS` constant (used in main and renderer, but NOT in preload)

### IPC Flow

```
renderer → window.electronAPI.xxx() → preload bridge → ipcMain.handle() in ipc-handlers.ts → service
```

All IPC handlers are registered in `src/main/ipc-handlers.ts`. Adding a new feature requires: (1) add channel to `IPC_CHANNELS` in `types.ts`, (2) add handler in `ipc-handlers.ts`, (3) expose via `preload.ts` with inline string, (4) call from renderer via `window.electronAPI`.

### Services (`src/main/services/`)

| File | Responsibility |
|------|---------------|
| `serial.service.ts` | Serial CRUD, bulk Excel import |
| `cancel.service.ts` | Playwright automation against Exocad SSO site |
| `order.service.ts` | URL polling (Playwright), pending orders DB |
| `email-monitor.service.ts` | POP3/IMAP email monitoring for renewal detection |
| `notification.service.ts` | Slack webhook + SMTP email notifications |
| `excel.service.ts` | Excel template generation and parsing |

### Database (`src/main/database.ts`)

SQLite file at `{app.getPath('userData')}/exocad.db`. Tables: `serials`, `renewal_requests`, `activity_logs`, `settings`, `pending_orders`. Settings are stored as key-value pairs in the `settings` table (serialized JSON for complex values like arrays/objects).

### Scheduling (`src/main/scheduler.ts`)

`node-cron` drives two schedulers:
- `startScheduler()` — auto-cancel cron (reads `auto_cancel_time` from settings)
- `startPollingScheduler()` in `order.service.ts` — URL polling cron (per-source `schedule_times`)

Both are started in `index.ts` on app ready and stopped on `before-quit`.

### i18n

`src/renderer/i18n.ts` contains `ko`/`en`/`ja` translation tables. Access via `useLang()` hook (from `LanguageContext` in `App.tsx`) and `t(lang, key)` function.

### Build Output Paths

```
tsconfig.main.json: rootDir=src → outDir=dist/main
  src/main/index.ts    → dist/main/main/index.js   (package.json "main")
  src/main/preload.ts  → dist/main/main/preload.js
  src/shared/types.ts  → dist/main/shared/types.js

vite: root=src/renderer → outDir=dist/renderer
  Production renderer path: path.join(__dirname, '../../renderer/index.html')
```

### Packaging Notes

- Uses `@electron/packager` with `--no-asar` (asar causes Windows path separator failures)
- Output: `ExocadBuild/Exocad Serial Manager-win32-x64/`
- `electron-builder` (`npm run dist`) requires Windows Developer Mode for symlink creation

### Playwright Cancel Flow (`cancel.service.ts`)

The Exocad site automation sequence (confirmed selectors):
1. SSO login: email → Continue → password
2. Navigate to `exocad_site_url`
3. Search serial: `[data-testid="search-input"]`
4. Extract product name from result row
5. Click option menu: `[data-testid="menu-button"]` (3-tier fallback)
6. Resolve cancel button label by product keyword (chairside/exoplan → "Cancel subscription", dentalcad → "Opt out upgrade")
7. Confirm cancel: `button.bg-red-55:has-text("Confirm cancellation")`
