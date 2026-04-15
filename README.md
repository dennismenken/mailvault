# Mail Vault

A secure, self-hosted email management system built with Next.js 16, Prisma 7, and IMAP synchronization.

## Features

- 🔐 **Secure Authentication** - Auth.js v5 with credential-based login
- 📧 **Multi-Account IMAP Sync** - Support for multiple email accounts
- 📎 **Attachment Management** - Download and manage email attachments
- 🔍 **Advanced Search** - Full-text search across all emails
- 📱 **Responsive Design** - Modern UI that works on all devices
- 🐳 **Docker Ready** - Easy deployment with Docker Compose
- 🔄 **Background Sync** - Automatic email synchronization
- 🗄️ **SQLite Storage** - Lightweight, file-based database

## Quick Start

### Prerequisites

- Node.js 18+ or Docker
- Git

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd mail-vault
   ```

2. **Set up environment**
   ```bash
   cp docker.env.example .env
   ```

3. **Configure your environment**
   Edit `.env` and set your values:
   ```env
   AUTH_SECRET=your-super-secret-key-change-this
   NEXTAUTH_URL=http://localhost:3000
   ```

### Development

```bash
# Install dependencies
npm install

# Set up database
npm run db:migrate

# Start development server
npm run dev
```

### Production (Docker)

```bash
# Start with Docker Compose
docker compose up -d

# View logs
docker compose logs -f
```

### Create the Initial User

There are no default credentials. After the containers are up, create the
first user via the CLI. The command refuses to run if a user already exists,
so it is safe to invoke once per fresh deployment.

```bash
# Local dev
npm run create-initial-user <email> <password> "Optional Name"

# Docker
docker compose exec web node scripts/cli.js create-initial-user <email> <password> "Optional Name"
```

Further accounts are managed from the web UI after login.

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_ENV` | Environment mode | `development` |
| `PORT` | Application port | `3000` |
| `NEXTAUTH_URL` | Application URL | `http://localhost:3000` |
| `AUTH_SECRET` | Auth.js v5 secret key (legacy `NEXTAUTH_SECRET` still honored) | *required* |
| `DATABASE_URL` | Main database path | `file:./data/database/main.db` |
| `DATA_DIR` | Account databases directory | `./data/accounts` |
| `ATTACHMENTS_DIR` | Attachment storage directory | `./data/attachments` |
| `SYNC_INTERVAL_MINUTES` | Background sync interval | `30` |
| `MAX_SYNC_ERRORS` | Max sync errors before disabling | `5` |
| `LOG_LEVEL` | Logging level | `info` |

### Directory Structure

```
data/
├── database/
│   └── main.db              # Main application database
├── accounts/
│   └── {accountId}.db       # Individual account databases
└── attachments/
    └── {accountId}/
        └── {emailId}/       # Email attachments
```

### Database Notes

- **`DATABASE_URL`**: Use `file:./data/database/main.db` from the project root. With Prisma 7 and the better-sqlite3 driver adapter, relative paths resolve against the process working directory (project root for the app, `/app` in Docker), so a single URL works for CLI commands and the application runtime.
- **Docker**: Same value; the `./data` volume is mounted at `/app/data`.

## Usage

### Adding Email Accounts

1. Log in to the application
2. Navigate to Settings → Email Accounts
3. Click "Add Account"
4. Enter your IMAP credentials:
   - Email address
   - IMAP server (e.g., `imap.gmail.com`)
   - Port (usually 993 for SSL)
   - Username and password
5. Save and enable synchronization

### Managing Attachments

- Attachments are automatically detected during sync
- Click the attachment icon in the email list to view attachments
- Download individual attachments or view attachment details
- Attachments are stored securely in the filesystem

### Search and Filtering

- Use the search bar to find emails by subject, sender, or content
- Filter by account, folder, or attachment status
- Advanced search supports multiple criteria

## API Endpoints

### Authentication
- `POST /api/auth/signin` - User login
- `POST /api/auth/signout` - User logout

### Email Management
- `GET /api/emails` - List emails with filtering
- `GET /api/emails/[id]` - Get specific email

### Attachments
- `GET /api/attachments/[emailId]` - List email attachments
- `GET /api/attachments/[emailId]/[filename]` - Download attachment

### Account Management
- `GET /api/accounts` - List IMAP accounts
- `POST /api/accounts` - Create IMAP account
- `PUT /api/accounts/[id]` - Update IMAP account
- `DELETE /api/accounts/[id]` - Delete IMAP account

## Development

### Database Migrations

```bash
# Create new migration
npx prisma migrate dev --name migration-name

# Apply migrations
npx prisma migrate deploy

# Reset database (development only)
npx prisma migrate reset
```

### Manual Sync

```bash
# Run one-time sync
node src/services/sync.js

# Start background sync service
node src/services/start-background-sync.js
```

### Debugging

```bash
# View database content
npx prisma studio

# Check logs
tail -f logs/app.log
```

## Docker Deployment

### Using Docker Compose (Recommended)

```bash
# Start services
docker compose up -d

# View logs
docker compose logs -f web
docker compose logs -f sync

# Stop services
docker compose down
```

### Manual Docker Build

```bash
# Build web service
docker build -f Dockerfile.web -t mail-vault-web .

# Build sync service
docker build -f Dockerfile.sync -t mail-vault-sync .

# Run with volumes
docker run -d \
  -p 3000:3000 \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/logs:/app/logs \
  --env-file .env \
  mail-vault-web
```

## Security

- All passwords are hashed using bcrypt
- IMAP credentials are encrypted in the database
- File access is restricted to authenticated users
- Attachment downloads include security checks
- CSRF protection enabled
- Secure session management

## Troubleshooting

### Common Issues

1. **Database locked errors**
   - Ensure only one sync process is running
   - Check file permissions on data directory

2. **IMAP connection failures**
   - Verify server settings and credentials
   - Check firewall and network connectivity
   - Enable "Less secure app access" for Gmail

3. **Attachment download issues**
   - Verify file permissions
   - Check available disk space
   - Ensure attachment path exists

### Logs

- Application logs: `logs/app.log`
- Docker logs: `docker compose logs`
- Database logs: Check SQLite journal files

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

This project is licensed under the MIT License - see the LICENSE file for details.
