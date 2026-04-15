# Mail Vault

Self-hosted IMAP archive and search for arbitrary mail accounts. Emails are synchronised into per-account SQLite databases, attachments land on disk, and a Next.js front end provides auth, search, filtering and download.

## Stack

- Next.js 16 (App Router, Turbopack), React 19, TypeScript
- Auth.js v5 (credentials provider, JWT sessions)
- Prisma 7 with the `@prisma/adapter-better-sqlite3` driver adapter
- `node-imap` + `mailparser` for IMAP fetch and MIME parsing
- `better-sqlite3` for account databases, WAL mode
- `node-cron` scheduled sync with manual-trigger HTTP endpoint
- Packaged as two Docker images: `web` (Next.js) and `sync` (background worker)

## Requirements

- Node.js 24 LTS (or Docker with the shipped `node:24-alpine` base)
- A writable data directory (SQLite files and attachment storage)

## Deployment

Docker Compose is the supported deployment path.

```bash
cp docker.env.example .env
# edit .env: set AUTH_SECRET, DATABASE_URL, SYNC_TRIGGER_TOKEN
docker compose up -d
docker compose logs -f
```

Migrations run automatically on both containers. `web` applies Prisma migrations for the main database; `sync` additionally upgrades the per-account SQLite files via `scripts/migrate-account-databases.js`.

### Create the initial user

There is no default account. After the stack is up, create one user from the CLI. The command refuses to run a second time.

```bash
# Docker
docker compose exec web node scripts/cli.js create-initial-user <email> <password> "Optional Name"

# Local
npm run create-initial-user <email> <password> "Optional Name"
```

Further users and IMAP accounts are managed from the web UI after login.

### Behind a reverse proxy

```yaml
# compose.yaml
services:
  web:
    ports: []
    expose:
      - "3000"
```

```env
# .env
AUTH_URL=https://mailvault.example.com
AUTH_TRUST_HOST=true
```

## Configuration

All variables are read from `.env` (mounted into both containers).

| Variable | Purpose | Default |
| --- | --- | --- |
| `AUTH_SECRET` | Auth.js session secret. Legacy `NEXTAUTH_SECRET` still accepted. | required |
| `AUTH_URL` | Public URL of the web app. | `http://localhost:3000` |
| `DATABASE_URL` | Main SQLite DB. Relative paths resolve against the process CWD. | `file:./data/database/main.db` |
| `DATA_DIR` | Directory used when creating new account databases. | `./data/accounts` |
| `ATTACHMENTS_DIR` | Root for attachment storage. | `./data/attachments` |
| `SYNC_INTERVAL_MINUTES` | Cron cadence for the background sync. | `30` |
| `MAX_SYNC_ERRORS` | Soft-error retries before an account is disabled. | `5` |
| `SYNC_SERVICE_URL` | Web container uses this to call the sync service. | `http://sync:3001` |
| `SYNC_TRIGGER_TOKEN` | Shared secret for the internal trigger API. | required when set |
| `SYNC_HTTP_HOST` / `SYNC_HTTP_PORT` | Sync service HTTP bind. | `0.0.0.0` / `3001` |
| `SYNC_BATCH_SIZE` / `SYNC_BATCH_DELAY` | Per-batch tuning for Gmail-friendly fetches. | `5` / `1000` |
| `LOG_LEVEL` | `info` by default. | `info` |

## Usage

1. Log in with the initial user.
2. Add an IMAP account from the UI. Credentials are stored in the main database. The next sync cycle picks it up automatically.
3. Search from the dashboard. Results are aggregated across all active accounts owned by the calling user, paginated at 20 per page.
4. Attachments can be downloaded from the email detail view.

### Manual sync

The sync service exposes an internal API consumed by the web container:

```bash
# From the web container, trigger a sync of a specific account.
curl -X POST http://localhost:3000/api/sync/trigger \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"accountId":"<id>"}'

# Or all accounts of the caller.
curl -X POST http://localhost:3000/api/sync/trigger -b cookies.txt -d '{}'

# Current cycle state (authenticated caller).
curl -s http://localhost:3000/api/sync/trigger -b cookies.txt
```

The endpoint requires a valid session and scopes `accountId` to the caller. Unreachable sync service returns HTTP 502.

## Operations

```bash
# Logs
docker compose logs -f web
docker compose logs -f sync

# Status snapshot
docker compose exec web node scripts/cli.js status

# Force a full resync cursor reset after an IMAP UIDVALIDITY change
docker compose exec web node scripts/cli.js reset-sync-state --account-id <id>

# Backup and restore
docker compose down
tar -czf mail-vault-$(date +%F).tar.gz data/
docker compose up -d
```

Healthy log tags are `[sync]`, `[imap]`, `[attach]`, `[db]`, `[migrate]`, `[entrypoint]`, `[sync-entrypoint]`. `[err]` indicates an actionable failure; auth failures disable the offending account immediately rather than burning retries against the IMAP server.

## Troubleshooting

- **`DATABASE_URL is not set`** — the runtime fails fast. Confirm `.env` is mounted and non-empty.
- **`no such column: ccAddresses`** — an account DB predates migration `003`. Run `docker compose exec sync node scripts/migrate-account-databases.js` once; the migration is idempotent.
- **Sync disabled unexpectedly** — inspect `ImapAccount.errorMessage` via `node scripts/cli.js status`. Auth failures set `errorCount` to a sentinel value and flip `syncEnabled` off; rotate credentials and re-enable from the UI.
- **Attachment download 404** — verify `attachmentsPath` on the row and the directory under `ATTACHMENTS_DIR/{accountId}/` exists.

## Backup discipline

The main DB and every per-account DB live under `./data`. A crash-consistent snapshot is obtained by stopping both containers or by copying the SQLite WAL sidecars (`*-wal`, `*-shm`) together with the base files.

## License

MIT. See `LICENSE`.
