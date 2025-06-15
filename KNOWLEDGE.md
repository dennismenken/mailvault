# Mail Vault - Knowledge Base

## 📋 Project Overview

**Mail Vault** is a secure email archiving and search application built with Next.js that synchronizes emails from IMAP accounts and stores them locally in SQLite databases for fast searching and viewing.

### Core Features
- ✅ **Multi-account IMAP synchronization** with configurable intervals
- ✅ **HTML & Plain text email rendering** with proper content type detection
- ✅ **Attachment download system** with secure file storage
- ✅ **Full-text search** across all emails and accounts
- ✅ **User management** with NextAuth authentication
- ✅ **Real-time sync monitoring** with error handling
- ✅ **Docker deployment** with separate web and sync services
- ✅ **Database schema migrations** for both main and account databases

## 🏗️ Architecture

### Service Architecture
```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Web Service   │    │   Sync Service   │    │   File System   │
│   (Next.js)     │    │   (Background)   │    │                 │
│   Port 3000     │    │   IMAP Sync      │    │  data/          │
└─────────────────┘    └──────────────────┘    │  ├─main.db      │
         │                        │             │  ├─accounts/    │
         └────────────┬─────────────┘             │  └─attachments/│
                      │                          └─────────────────┘
              ┌───────────────┐
              │  Shared Data  │
              │   Storage     │
              └───────────────┘
```

### Database Architecture
- **Main Database** (`data/main.db`): Users, IMAP accounts, configuration
- **Account Databases** (`data/accounts/{email}_{timestamp}.db`): Individual email storage
- **Attachments** (`data/attachments/{accountId}/{messageId}/`): File storage

### Key Technologies
- **Frontend**: Next.js 15, React 19, TypeScript, Tailwind CSS, shadcn/ui
- **Backend**: Next.js API Routes, NextAuth.js
- **Database**: SQLite with Prisma ORM
- **Email**: node-imap, mailparser
- **Deployment**: Docker, Docker Compose

## 📊 Database Schema

### Main Database Schema
```sql
-- Users table
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  passwordHash TEXT NOT NULL,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- IMAP Accounts table
CREATE TABLE imapAccounts (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  email TEXT NOT NULL,
  imapServer TEXT NOT NULL,
  imapPort INTEGER NOT NULL,
  imapUsername TEXT NOT NULL,
  imapPassword TEXT NOT NULL,
  useTls BOOLEAN DEFAULT true,
  isActive BOOLEAN DEFAULT true,
  syncEnabled BOOLEAN DEFAULT true,
  dbPath TEXT NOT NULL,
  lastSyncAt DATETIME,
  errorMessage TEXT,
  errorCount INTEGER DEFAULT 0,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (userId) REFERENCES users (id) ON DELETE CASCADE
);
```

### Account Database Schema
```sql
-- Emails table (per account)
CREATE TABLE emails (
  id TEXT PRIMARY KEY,
  messageId TEXT UNIQUE NOT NULL,
  subject TEXT,
  fromAddress TEXT,
  fromName TEXT,
  toAddresses TEXT, -- JSON array
  date DATETIME,
  folder TEXT NOT NULL,
  bodyText TEXT,
  bodyHtml TEXT,
  contentType TEXT DEFAULT 'PLAIN', -- 'PLAIN' or 'HTML'
  hasAttachments BOOLEAN DEFAULT FALSE,
  attachmentsPath TEXT,
  attachments TEXT, -- JSON metadata
  size INTEGER,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX idx_emails_date ON emails(date);
CREATE INDEX idx_emails_from ON emails(fromAddress);
CREATE INDEX idx_emails_subject ON emails(subject);
CREATE INDEX idx_emails_folder ON emails(folder);
CREATE INDEX idx_emails_has_attachments ON emails(hasAttachments);
CREATE INDEX idx_emails_content_type ON emails(contentType);
```

## 🔄 Migration System

### Migration Scripts
- **Main Database**: Standard Prisma migrations in `prisma/migrations/`
- **Account Databases**: Custom migration script `scripts/migrate-account-databases.js`

### Migration Commands
```bash
# Main database migrations
npx prisma migrate dev
npx prisma migrate deploy

# Account database migrations
npm run migrate:accounts
```

### Critical Migration Notes
- Account databases must be migrated separately from main database
- Schema changes require both Prisma migration AND account migration
- Always backup before migrations: `tar -czf backup.tar.gz data/`

## 🚀 API Endpoints

### Authentication
- `GET /api/auth/session` - Get current session
- `POST /api/auth/signin` - Sign in user
- `POST /api/auth/signout` - Sign out user

### Email Search
- `GET /api/emails/search` - Search emails across all accounts
  - Query params: `query`, `page`, `limit`, `folder`, `fromAddress`, `dateFrom`, `dateTo`
  - Special: `fullContentId` - Returns full content for specific email ID
- Response includes truncated content for list view, full content for detail view

### Attachment Management
- `GET /api/attachments/[emailId]` - List all attachments for an email
- `GET /api/attachments/[emailId]/[filename]` - Download specific attachment
- Secure path validation and content-type detection
- User authentication and access control

### User Management
- `GET /api/users` - List all users (admin)
- `POST /api/users` - Create new user
- `DELETE /api/users/[id]` - Delete user

### IMAP Accounts
- `GET /api/imap-accounts` - List user's IMAP accounts
- `POST /api/imap-accounts` - Create new IMAP account
- `PUT /api/imap-accounts/[id]` - Update IMAP account
- `DELETE /api/imap-accounts/[id]` - Delete IMAP account

### Sync Operations
- `POST /api/sync/trigger` - Trigger manual sync
- `GET /api/sync/status` - Get sync status

## 🔧 Critical Solutions & Fixes

### 1. Hydration Errors (React)
**Problem**: Browser extensions causing hydration mismatch
**Solution**: Added `suppressHydrationWarning={true}` to `<body>` in layout.tsx

### 2. Email Content Truncation
**Problem**: HTML emails truncated at 1000 characters, text at 500 characters
**Solution**: 
- Modified search API with `fullContentId` parameter
- Returns full content when viewing specific email
- Maintains truncation for list performance
- Client-side loads full content on email open

### 3. Database Path Resolution
**Problem**: Relative paths in SQLite connections failing in API routes
**Solution**: Always resolve to absolute paths using `path.resolve(process.cwd(), dbPath)`

### 4. IMAP Sync Stability Issues
**Problem**: Connection timeouts, large batch failures
**Solutions Applied**:
- Reduced batch size from 100 to 1 email (Gmail-optimized)
- Added delays between operations (500ms)
- Implemented reconnection logic after connection issues
- Added exponential backoff for failed connections
- Proper connection cleanup and timeout handling
- Removed sync limits for full email synchronization

### 5. Content Type Detection
**Problem**: Mixed content types not properly detected
**Solution**: 
- Enhanced content type detection in IMAP sync
- Added `contentType` field to database schema
- UI properly renders HTML vs plain text based on content type

### 6. Attachment Storage & Download System
**Problem**: Attachments not being saved or downloadable
**Solution**:
- Implemented secure directory structure: `data/attachments/{accountId}/{messageId}/`
- Added attachment download API endpoints with security validation
- Secure filename sanitization to prevent path traversal attacks
- Added `hasAttachments`, `attachmentsPath`, and `attachments` fields
- UI with download buttons and file type icons
- Comprehensive attachment metadata storage

### 7. Next.js 15 Compatibility
**Problem**: Async params warnings in API routes
**Solution**: Updated all API routes to properly await params:
```typescript
// Before
const { emailId } = params;

// After  
const { emailId } = await params;
```

## 🐳 Docker Deployment

### Two-Service Architecture
- **Web Service** (`Dockerfile.web`): Next.js application on port 3000
- **Sync Service** (`Dockerfile.sync`): Background IMAP synchronization
- **Shared Volumes**: Data persistence and attachment storage
- **Network Isolation**: Internal communication between services

### Docker Compose Configuration
```yaml
services:
  web:
    build:
      dockerfile: Dockerfile.web
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data
      - attachments:/app/data/attachments
    depends_on:
      - sync

  sync:
    build:
      dockerfile: Dockerfile.sync
    volumes:
      - ./data:/app/data
      - attachments:/app/data/attachments
    environment:
      - SYNC_INTERVAL_MINUTES=30
```

### Deployment Commands
```bash
# Build and start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Create initial user
docker-compose exec web node scripts/cli.js create-initial-user

# Backup data
docker-compose down
tar -czf backup.tar.gz data/
docker-compose up -d
```

## 🔍 Sync System

### Background Sync Service
- **Interval**: Configurable via `SYNC_INTERVAL_MINUTES` (default: 30 minutes)
- **Full Synchronization**: Processes all folders and accounts
- **Duplicate Prevention**: Uses Message-ID to avoid re-downloading emails
- **Error Handling**: Automatic retry with exponential backoff
- **Account Management**: Disables accounts after repeated failures

### Manual Sync
```bash
# One-time sync of all accounts
node src/services/sync.js

# Background service (runs continuously)
node src/services/start-background-sync.js
```

### Sync Features
- **Gmail-Optimized**: 1 email per batch with 500ms delays
- **Folder Prioritization**: INBOX first, then Sent, Drafts, etc.
- **Progress Monitoring**: Real-time status updates
- **Attachment Processing**: Automatic download and storage
- **Connection Management**: Automatic reconnection on failures

## 🔐 Security Features

### Authentication
- **NextAuth.js**: Secure session management
- **Password Hashing**: bcrypt for user passwords
- **Session Validation**: All API routes protected

### File Security
- **Path Traversal Protection**: Secure filename validation
- **User Isolation**: Each user can only access their own data
- **Attachment Security**: Sandboxed file storage per account/email

### Database Security
- **SQL Injection Prevention**: Parameterized queries via Prisma
- **Data Isolation**: Separate databases per IMAP account
- **Connection Security**: TLS encryption for IMAP connections

## 📈 Performance Optimizations

### Database Indexing
- **Search Performance**: Indexes on date, sender, subject, folder
- **Filter Performance**: Indexes on hasAttachments, contentType
- **Unique Constraints**: Message-ID uniqueness prevents duplicates

### Content Management
- **Truncated Previews**: Reduced payload for email lists
- **On-Demand Loading**: Full content loaded only when needed
- **Attachment Streaming**: Direct file serving without memory loading

### Sync Efficiency
- **Incremental Sync**: Only new emails are downloaded
- **Batch Processing**: Optimized batch sizes for different providers
- **Connection Reuse**: Persistent IMAP connections where possible

## 🛠️ Development Setup

### Prerequisites
- Node.js 18+
- SQLite 3
- Git

### Installation
```bash
# Clone repository
git clone <repository-url>
cd mail-vault

# Install dependencies
npm install

# Setup database
npx prisma migrate dev
npx prisma generate

# Create initial user
node scripts/cli.js create-initial-user

# Start development server
npm run dev
```

### Environment Variables
```env
# Required
NEXTAUTH_SECRET=your-secret-key-here
NEXTAUTH_URL=http://localhost:3000
DATABASE_URL=file:./data/main.db

# Optional
SYNC_INTERVAL_MINUTES=30
MAX_SYNC_ERRORS=5
DATA_DIR=./data
```

## 🧪 Testing

### Manual Testing
```bash
# Test IMAP connection
node scripts/test-imap-connection.js

# Test email search
node scripts/test-email-search.js

# Test attachment system
node scripts/test-attachments.js
```

### Database Testing
```bash
# Check database integrity
sqlite3 data/main.db "PRAGMA integrity_check;"

# View sync statistics
node scripts/sync-stats.js
```

## 📚 Troubleshooting

### Common Issues

**1. IMAP Connection Failures**
- Check server settings and credentials
- Verify TLS/SSL configuration
- Check firewall and network connectivity

**2. Database Lock Errors**
- Stop all services: `docker-compose down`
- Check for zombie processes: `ps aux | grep node`
- Restart services: `docker-compose up -d`

**3. Attachment Download Issues**
- Verify file permissions: `ls -la data/attachments/`
- Check disk space: `df -h`
- Review API logs for path errors

**4. Sync Performance Issues**
- Reduce batch size in environment variables
- Increase sync intervals for large mailboxes
- Monitor Gmail API quotas and limits

### Log Analysis
```bash
# Docker logs
docker-compose logs -f web
docker-compose logs -f sync

# Application logs
tail -f logs/application.log
tail -f logs/sync.log
```

## 🚀 Production Deployment

### System Requirements
- **CPU**: 2+ cores recommended
- **RAM**: 4GB minimum, 8GB recommended
- **Storage**: 50GB+ for email data
- **Network**: Stable internet connection

### Security Checklist
- [ ] Change default NEXTAUTH_SECRET
- [ ] Use strong database passwords
- [ ] Enable TLS for all IMAP connections
- [ ] Regular backup schedule
- [ ] Monitor disk usage
- [ ] Update dependencies regularly

### Monitoring
- **Health Checks**: Built-in service status endpoints
- **Log Rotation**: Configure log rotation for long-term operation
- **Backup Strategy**: Automated daily backups recommended
- **Performance Monitoring**: Track sync times and error rates

---

*This knowledge base is continuously updated as the project evolves. For the latest information, check the project repository and documentation.* 