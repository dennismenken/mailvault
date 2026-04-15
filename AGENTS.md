# AGENTS.md

Context for AI coding agents working on this repository. Human-facing setup and operations live in `README.md`. This file is the map an agent needs before touching code.

## Project shape

- Self-hosted IMAP archive. Two long-running processes:
  - `web` — Next.js 16 App Router, authenticates users and serves the UI/API.
  - `sync` — Node.js background worker that polls IMAP on a cron and owns the per-account SQLite files.
- Per-account, not per-tenant: every IMAP account has its own SQLite file under `./data/accounts/` created at account registration time. The main database under `./data/database/main.db` only stores users, IMAP credentials and sync state for the scheduler.
- The web container reaches the sync container through an internal HTTP trigger endpoint on port 3001 (compose network, not exposed to the host).

## Directory layout

```
prisma/                  Prisma schema and migrations for the main DB only
prisma.config.ts         Prisma 7 config loader (reads DATABASE_URL via dotenv)
src/
  app/                   Next.js App Router: pages + /api route handlers
  lib/
    auth.ts              Auth.js v5 config + NextAuth() handlers/auth exports
    prisma.ts            Lazy Proxy singleton around the main PrismaClient
    prisma-factory.{ts,js}  Driver-adapter factory (main + per-account clients)
  services/
    background-sync.js   Cron + in-flight guard + HTTP trigger + error classifier
    start-background-sync.js  Thin process wrapper (signals, heartbeat)
    imap-sync.js         IMAP fetch, better-sqlite3 writes with UPSERT
    imap-errors.js       Error classifier (auth vs. network vs. unknown)
    sync.js              One-off CLI runner for manual full/incremental sync
scripts/
  cli.js                 create-initial-user, status, reset, reset-sync-state
  migrate-account-databases.js  Idempotent account-DB migration runner
  docker-entrypoint*.sh  Image entrypoints (migrations, then exec CMD)
compose.yaml             Two-service compose setup (web + sync)
Dockerfile.web           Next.js standalone image
Dockerfile.sync          Background worker image
```

## Toolchain

- Node 22 (engines in `package.json`).
- Package manager: `npm`. Do not introduce `yarn`, `pnpm`, `bun`.
- TypeScript is strict. Next 16 build runs with `ignoreBuildErrors: true` for historical reasons, so rely on `tsc --noEmit` to catch type errors.
- ESLint flat config in `eslint.config.mjs`. `src/generated/**` and `.js` service files have targeted overrides; do not remove them.

## Build / test / run

```bash
npm install
npx prisma generate                 # required before tsc/next build
npx tsc --noEmit                    # 0 errors is the bar
npx eslint .                        # 0 errors + 0 warnings is the bar
npm run build                       # next build (prisma generate runs first)
npm run dev                         # Next dev server
node src/services/start-background-sync.js   # sync worker locally

# Docker
docker compose build
docker compose up -d
```

There is no test suite yet. Do not add one speculatively; if you add tests, pin the framework to what the task requires and wire `package.json` scripts explicitly.

## Database model

- **Main DB** (`prisma/schema.prisma`): `User`, `ImapAccount`, and two scaffolding tables (`Email`, `SyncState`) that are not used in the main DB at runtime. Do not write to `Email`/`SyncState` from the web container; those models are declared here only so Prisma generates the client types used by API routes that open per-account databases.
- **Account DBs**: raw SQLite files created and migrated by `scripts/migrate-account-databases.js`. Schema lives in three places:
  - The migration list at the top of that script (source of truth).
  - The `CREATE TABLE IF NOT EXISTS` block in `src/services/imap-sync.js` for brand-new DBs.
  - The Prisma models `Email` / `SyncState`, used as row-type ghosts by API routes reading via `createAccountPrismaClient`.
- Adding a column to an account DB means adding a new entry to the `MIGRATIONS` array **and** updating the CREATE TABLE statement and the Prisma model. All three must stay in sync.

## Prisma 7 driver adapter

- `datasource.url` is deliberately missing from `prisma/schema.prisma`. Prisma 7 routes DB access through `@prisma/adapter-better-sqlite3`.
- Use the factory, never `new PrismaClient()` directly:
  - `createMainPrismaClient()` — single instance for the main DB, wrapped in the lazy Proxy exported as `prisma` from `src/lib/prisma.ts`.
  - `createAccountPrismaClient(dbPath)` — one instance per account DB. Call `$disconnect()` when the handler is done or the SQLite file stays locked inside the sync container.
- `prisma.config.ts` is read by the Prisma CLI. It loads `.env` via `dotenv` and passes `DATABASE_URL` to the CLI; missing URL falls through to an empty string so `npx prisma generate` still works during image builds.

## Sync worker contract

- Cron expression is derived from `SYNC_INTERVAL_MINUTES`.
- A single `cycleInFlight` flag prevents overlapping runs across startup, cron and manual triggers.
- Manual triggers are queued (`manualQueue: Set<accountId|'__all__'>`) and drained serially. Cron skips if a manual drain is running.
- Errors from `imap-sync.incrementalSync()` flow through `classifyImapError`:
  - `kind: 'auth'` — `syncEnabled` flipped to `false` and `errorCount` pinned to `9999`. Re-enabling requires the UI.
  - `kind: 'network'` / `'dns'` / `'unknown'` — soft errors, increment `errorCount` up to `MAX_SYNC_ERRORS` before disabling.
- HTTP endpoint on `SYNC_HTTP_PORT` (default 3001):
  - `POST /trigger` with optional `{ accountId }`. Validates `x-sync-token` against `SYNC_TRIGGER_TOKEN` when set.
  - `GET /status` returns `{ isRunning, cycleInFlight, manualInFlight, queued[], intervalMinutes }`.
- The web route `POST /api/sync/trigger` scopes `accountId` to the caller before forwarding. Do not add an unauthenticated pass-through.

## Conventions

- **No emojis in code, logs, commits or docs.** Use `[sync]`, `[imap]`, `[attach]`, `[db]`, `[migrate]`, `[entrypoint]`, `[sync-entrypoint]`, `[ok]`, `[err]`, `[warn]` prefixes in log lines.
- Write German user-facing strings with umlauts (`ä`, `ö`, `ü`, `ß`), never digraphs. Code, commits, comments and this repo's docs stay in English; the git history is English imperative.
- Commits: no `Co-Authored-By` trailer. One coherent change per commit.
- Prefer deleting dead code over flagging it. The sync path has a history of parallel TS/JS duplicates; if you touch one, make sure the other does not quietly diverge.
- Catch `unknown`, narrow with `error instanceof Error ? error.message : String(error)`. A helper `errorMessage()` already exists where needed.
- Do not re-flow prose into hard-wrapped columns. Paragraphs are a single line; the renderer handles wrapping. Diff noise on edits is worse than ragged right edges in raw view.

## Path resolution (production hazard)

- The factory resolves relative SQLite URLs against `process.cwd()` (`/app` in Docker). `DATABASE_URL=file:./data/database/main.db` lands at `/app/data/database/main.db`, which is where the compose volume is mounted. **Do not reintroduce `file:../data/...`** — it silently resolves to `/data/...`, outside the volume, and the production DB disappears on the next container restart.
- Account `dbPath` values in the DB can be absolute or relative; the factory handles both. Keep them relative (`data/accounts/...`) when creating new accounts so the deployment stays portable.

## Known hazards

- `INSERT OR REPLACE` → `ON CONFLICT(messageId) DO UPDATE`: re-fetched rows keep their `id` and `createdAt` now. Old code regenerated `id`, which the download API did not depend on, but any new feature reading the `id`-to-attachments-path relationship has to use the `attachmentsPath` field instead of reconstructing it.
- Legacy account rows may have `NULL` in `ccAddresses`, `bccAddresses` and `flags`. There is no backfill command; adding one requires a real IMAP `UID FETCH HEADER.FIELDS (Cc Bcc) FLAGS` pass, not just clearing `sync_state`. `reset-sync-state` is a UIDVALIDITY recovery helper, not a metadata backfill, and the docs are explicit about that.
- The `sync` container only runs a single instance; `docker compose up --scale sync=N` will produce duplicate writes and SQLite busy errors.

## Security notes

- Credentials in `ImapAccount` are stored in clear text. Any feature that exposes account data to the UI must filter `imapPassword`.
- Session JWTs survive across deploys while `AUTH_SECRET` stays the same. Rotating the secret logs everyone out.
- The `SYNC_TRIGGER_TOKEN` lives only on the internal docker network. Do not forward it or the trigger endpoint through the reverse proxy.

## Release flow

1. Work on a branch or directly on `main` depending on the ask.
2. Before committing: `npx tsc --noEmit`, `npx eslint .`, `npm run build`.
3. Use a conventional English imperative subject, body explains the "why". No Co-authored-By.
4. Docker build smoke test when touching service wiring: `docker compose build && docker compose up -d` followed by checking `docker logs mail-vault-sync` for `[sync] http endpoint listening`.
5. Push when the validation-critic skill reports clean.
