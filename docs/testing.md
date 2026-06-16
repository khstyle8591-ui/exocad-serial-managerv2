# Testing

## Standard verification

Run the normal safety check before handing off changes:

```bash
npm run verify
```

This runs Vitest, runs the Electron SQLite schema checks, and then builds the
main and renderer bundles.

## Native SQLite tests

`tests/database-schema.test.ts` uses in-memory SQLite through `better-sqlite3`.
This project rebuilds `better-sqlite3` for Electron during install, so the same
native module may not load in the plain Node runtime used by Vitest. When that
happens, the Vitest schema tests are intentionally skipped and the skip reason is
reported by the test suite.

The actual schema checks run in Electron, where the native module ABI matches
the desktop app:

```bash
npm run test:db
```

`test:db` builds the main process and executes
`scripts/electron-db-schema-test.cjs` with Electron against an in-memory
database.

Do not run `npm rebuild better-sqlite3` casually just to make Vitest load the
module. Rebuilding for Node can break the Electron runtime. Prefer the existing
`electron-rebuild` flow for app development:

```bash
npx electron-rebuild -f -w better-sqlite3
```

## Deferred DB test work

The following tests are still useful, but should wait until the native SQLite
coverage is expanded:

- `processEmail` DB save flow using `initDatabaseForTesting()`
- pending order unique migration checks

`npm run verify` remains the default gate. It may still report the Vitest DB
schema file as skipped under Node, but the Electron DB schema runner is part of
the same verification command.
