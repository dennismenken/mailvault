# Mail Vault Docker Deployment

This guide explains how to deploy Mail Vault using Docker Compose with separate web and sync services.

## Architecture

The Docker Compose setup includes:
- **Web Service**: Next.js application (port 3000)
- **Sync Service**: IMAP background synchronization
- **Shared Volumes**: Data persistence and attachments storage
- **Network**: Internal communication between services

## Quick Start

### 1. Prerequisites

- Docker & Docker Compose installed
- At least 2GB RAM available
- 10GB+ storage for email data

### 2. Configuration

Copy the environment template:
```bash
cp docker.env.example .env
```

Edit `.env` and set your configuration:
```bash
# Required: Change the secret key
NEXTAUTH_SECRET=your-super-secret-key-here-use-openssl-rand-base64-32

# Optional: Change the URL if using a domain
NEXTAUTH_URL=http://localhost:3000
```

### 3. Build and Start

```bash
# Build and start all services
docker-compose up -d

# View logs
docker-compose logs -f

# View only web service logs
docker-compose logs -f web

# View only sync service logs
docker-compose logs -f sync
```

### 4. Initial Setup

Create your first user:
```bash
docker-compose exec web node scripts/cli.js create-initial-user
```

### 5. Access the Application

Open your browser: http://localhost:3000

## Data Persistence

### Volumes

- `./data`: SQLite databases and configuration
- `./logs`: Application logs
- `attachments`: Docker volume for email attachments

### Backup

```bash
# Backup databases and attachments
docker-compose down
tar -czf mail-vault-backup-$(date +%Y%m%d).tar.gz data/
docker-compose up -d
```

### Restore

```bash
docker-compose down
tar -xzf mail-vault-backup-YYYYMMDD.tar.gz
docker-compose up -d
```

## Service Management

### Start/Stop Services

```bash
# Start all services
docker-compose up -d

# Stop all services
docker-compose down

# Restart specific service
docker-compose restart web
docker-compose restart sync
```

### Scaling

The sync service is designed to run as a single instance. Do not scale it:
```bash
# This is fine
docker-compose up -d --scale web=2

# DON'T do this (will cause conflicts)
# docker-compose up -d --scale sync=2
```

### Health Checks

```bash
# Check service status
docker-compose ps

# Check logs for errors
docker-compose logs --tail=50 web
docker-compose logs --tail=50 sync

# Get service status
docker-compose exec web node scripts/cli.js status
```

## Monitoring

### Logs

```bash
# Real-time logs for all services
docker-compose logs -f

# Logs for specific service
docker-compose logs -f web
docker-compose logs -f sync

# Last 100 lines
docker-compose logs --tail=100
```

### Resource Usage

```bash
# Monitor resource usage
docker stats $(docker-compose ps -q)
```

## Configuration

### Environment Variables

Key variables in `.env`:

| Variable | Description | Default |
|----------|-------------|---------|
| `NEXTAUTH_SECRET` | Secret key for authentication | **Required** |
| `NEXTAUTH_URL` | Public URL of your application | `http://localhost:3000` |
| `SYNC_INTERVAL_MINUTES` | How often to sync emails | `30` |
| `MAX_SYNC_ERRORS` | Max errors before disabling account | `5` |
| `DATA_DIR` | Data directory inside containers | `/app/data` |

### Reverse Proxy

To run behind nginx/traefik:

```yaml
# In compose.yaml, change:
ports:
  - "3000:3000"
# To:
expose:
  - "3000"
```

Update `.env`:
```bash
NEXTAUTH_URL=https://yourdomain.com
TRUST_PROXY=true
```

## Troubleshooting

### Common Issues

**1. Permission Errors**
```bash
# Fix permissions
sudo chown -R 1001:1001 ./data ./logs
```

**2. Database Locked**
```bash
# Stop services and restart
docker-compose down
docker-compose up -d
```

**3. Sync Not Working**
```bash
# Check sync service logs
docker-compose logs sync

# Restart sync service
docker-compose restart sync
```

**4. Port Already in Use**
```bash
# Change port in compose.yaml
ports:
  - "3001:3000"  # Use port 3001 instead
```

### Debugging

```bash
# Enter web container
docker-compose exec web sh

# Enter sync container
docker-compose exec sync sh

# Check database
docker-compose exec web node scripts/cli.js status

# Manual sync
docker-compose exec sync node src/services/sync.js
```

## Updates

### Update Application

```bash
# Pull latest code
git pull

# Rebuild and deploy
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

### Database Migrations

```bash
# Run migrations if needed
docker-compose exec web npx prisma migrate deploy
docker-compose exec web node scripts/migrate-account-databases.js
```

## Security

### Production Deployment

1. **Change default secret**:
   ```bash
   NEXTAUTH_SECRET=$(openssl rand -base64 32)
   ```

2. **Use HTTPS**:
   ```bash
   NEXTAUTH_URL=https://your-domain.com
   ```

3. **Secure file permissions**:
   ```bash
   chmod 600 .env
   chown -R 1001:1001 data/
   ```

4. **Regular backups**:
   ```bash
   # Add to crontab
   0 2 * * * /path/to/backup-script.sh
   ```

## Advanced Configuration

### Custom Build

```bash
# Build with custom options
docker-compose build --build-arg NODE_VERSION=20 web
```

### Resource Limits

Add to `compose.yaml`:
```yaml
services:
  web:
    deploy:
      resources:
        limits:
          cpus: '1.0'
          memory: 1G
        reservations:
          memory: 512M
```

### Health Checks

Add to `compose.yaml`:
```yaml
services:
  web:
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
``` 