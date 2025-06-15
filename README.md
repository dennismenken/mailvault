# Mail Vault

A secure email archiving and search application built with Next.js, Prisma, and IMAP synchronization.

## Features

- 🔐 Secure user authentication
- 📧 IMAP email synchronization from multiple accounts
- 🗄️ Separate SQLite databases per email account for optimal performance
- 🔍 Full-text search across all email accounts
- 📱 Modern, responsive web interface
- ⚡ Real-time email synchronization with background scheduler
- 📊 Email management and organization
- 🛡️ Privacy-focused with local data storage

## Technology Stack

- **Frontend**: Next.js 15, React 19, Tailwind CSS, Shadcn/ui
- **Backend**: Next.js API Routes, Prisma ORM
- **Database**: SQLite (main app + individual account databases)
- **Authentication**: NextAuth.js
- **Email**: IMAP protocol with node-imap and mailparser
- **Scheduling**: node-cron for background synchronization

## 🚀 Quick Start

### 1. Installation

```bash
# Install dependencies
npm install

# Initialize database
npm run db:push
```

### 2. Create Initial User

Create the first user using command line arguments:

```bash
# Basic user creation
npm run create-initial-user admin@example.com securepassword123

# With name
npm run create-initial-user admin@example.com securepassword123 "Administrator"
```

### 3. Start Application

```bash
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000) and login with your credentials.

## 📋 CLI Commands

The CLI is only used for initial setup. All user management afterwards happens through the web interface.

```bash
# Create the first user (required before web access)
npm run create-initial-user <email> <password> [name]

# Show system status
npm run status

# Reset ALL data (DANGER! - Deletes everything)
npm run reset
```

### Examples:

```bash
# Create initial user
npm run create-initial-user admin@company.com mySecurePass123 "Admin User"

# Check status
npm run status

# Complete reset (with confirmation prompt)
npm run reset
```

**Note:** The CLI only allows creating one initial user. All subsequent user management and IMAP account setup must be done through the web interface after logging in.

## Email Provider Setup

### Gmail
1. Enable 2-factor authentication in your Google account
2. Generate an App Password (Security → App passwords)
3. In the web interface, use:
   - Server: `imap.gmail.com`
   - Port: `993`
   - Username: Your Gmail address
   - Password: The generated app password (not your regular password)

### Outlook/Hotmail
1. Enable IMAP in your Outlook settings
2. In the web interface, use:
   - Server: `outlook.office365.com`
   - Port: `993`
   - Username: Your email address
   - Password: Your regular email password

### Other Providers
Check your email provider's IMAP settings documentation and configure through the web interface.

## Architecture

### Database Design
- **Main Database**: User accounts and IMAP configuration
- **Account Databases**: Separate SQLite files for each email account's messages
- **Benefits**: Better performance, easier backup, account isolation

### Security Features
- Password hashing with bcrypt
- Session-based authentication
- Account-level data isolation
- Local data storage (no cloud dependencies)

## Development

### Project Structure
```
src/
├── app/                    # Next.js app router
│   ├── api/               # API routes
│   ├── dashboard/         # Main application interface
│   └── login/             # Authentication
├── components/            # React components
├── lib/                   # Utilities and configurations
│   ├── auth.ts           # NextAuth configuration
│   ├── prisma.ts         # Database client
│   └── imap-sync.ts      # Email synchronization
└── types/                # TypeScript definitions

scripts/
├── cli.ts                # Command line interface
└── sync-scheduler.ts     # Background sync process

prisma/
└── schema.prisma         # Database schema
```

### Key Components

1. **IMAP Sync Service** (`src/lib/imap-sync.ts`)
   - Handles email fetching and parsing
   - Manages individual account databases
   - Implements incremental synchronization

2. **CLI Interface** (`scripts/cli.ts`)
   - User and account management
   - Database initialization
   - Administrative tasks

3. **Search API** (`src/app/api/emails/search/route.ts`)
   - Cross-account email search
   - Advanced filtering and pagination
   - Performance optimized queries

### Development Commands
```bash
# Development server
npm run dev

# Database operations
npm run db:push          # Push schema changes
npm run db:generate      # Generate Prisma client

# CLI operations
npm run cli <command>    # Run CLI commands

# Background sync
npm run sync:start       # Start sync scheduler
```

## Deployment

### Production Setup
1. Set production environment variables
2. Use a production database (PostgreSQL recommended for main DB)
3. Configure proper backup strategies for account databases
4. Set up monitoring for sync processes
5. Use a process manager (PM2) for the sync scheduler

### Environment Variables
```bash
DATABASE_URL="postgresql://user:pass@localhost:5432/mailvault"
NEXTAUTH_URL="https://your-domain.com"
NEXTAUTH_SECRET="production-secret-key"
SYNC_INTERVAL_MINUTES=15
MAX_SYNC_ERRORS=3
DATA_DIR="/var/data/mailvault"
```

## Troubleshooting

### Common Issues

1. **IMAP Connection Failed**
   - Verify server settings
   - Check firewall/network access
   - Ensure app passwords for Gmail/Outlook

2. **Database Errors**
   - Run `npm run db:push` to sync schema
   - Check file permissions for SQLite files

3. **Sync Stopped**
   - Check error logs in the sync scheduler
   - Verify IMAP account credentials
   - Check disk space for database files

### Logs
- Application logs: Console output from `npm run dev`
- Sync logs: Console output from `npm run sync:start`
- Database logs: Check SQLite file integrity

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

This project is licensed under the MIT License.

## Support

For issues and questions:
1. Check the troubleshooting section
2. Review the CLI help output
3. Open an issue on GitHub
