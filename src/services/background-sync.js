'use strict';

const http = require('http');
const cron = require('node-cron');
const { createMainPrismaClient } = require('../lib/prisma-factory');
const { ImapSyncService } = require('./imap-sync');
const { classifyImapError } = require('./imap-errors');

const SOFT_ERROR_LIMIT = parseInt(process.env.MAX_SYNC_ERRORS || '5', 10);
const HARD_ERROR_COUNT_SENTINEL = 9999; // marker for permanent failures like auth errors

function buildCronExpression(intervalMinutes) {
  const minutes = Math.max(1, Math.min(59, intervalMinutes));
  return `*/${minutes} * * * *`;
}

class BackgroundSyncService {
  constructor() {
    this.prisma = createMainPrismaClient();
    this.intervalMinutes = parseInt(process.env.SYNC_INTERVAL_MINUTES || '30', 10);
    this.cronTask = null;
    this.httpServer = null;
    this.isRunning = false;
    this.cycleInFlight = false;
    this.manualQueue = new Set();
    this.manualInFlight = false;
  }

  async start() {
    if (this.isRunning) {
      console.log('[sync] already running');
      return;
    }

    this.isRunning = true;
    console.log(`[sync] starting background sync service (interval: ${this.intervalMinutes} min)`);

    this.startHttpEndpoint();

    // Kick off an initial sync right away, but do not block startup.
    this.runCycle('startup').catch((error) => {
      console.error('[sync] startup cycle failed:', error.message);
    });

    this.cronTask = cron.schedule(buildCronExpression(this.intervalMinutes), () => {
      this.runCycle('cron').catch((error) => {
        console.error('[sync] cron cycle failed:', error.message);
      });
    });

    console.log('[sync] background sync service ready');
  }

  async stop() {
    if (!this.isRunning) return;

    this.isRunning = false;
    if (this.cronTask) {
      this.cronTask.stop();
      this.cronTask = null;
    }

    if (this.httpServer) {
      await new Promise((resolve) => this.httpServer.close(() => resolve()));
      this.httpServer = null;
    }

    await this.prisma.$disconnect();
    console.log('[sync] stopped');
  }

  startHttpEndpoint() {
    const port = parseInt(process.env.SYNC_HTTP_PORT || '3001', 10);
    const host = process.env.SYNC_HTTP_HOST || '0.0.0.0';
    const token = process.env.SYNC_TRIGGER_TOKEN || '';

    this.httpServer = http.createServer(async (req, res) => {
      if (req.method === 'POST' && req.url === '/trigger') {
        if (token && req.headers['x-sync-token'] !== token) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'unauthorized' }));
          return;
        }

        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
          if (body.length > 4096) {
            req.destroy();
          }
        });
        req.on('end', () => {
          let accountId;
          try {
            const parsed = body ? JSON.parse(body) : {};
            if (parsed.accountId && typeof parsed.accountId === 'string') {
              accountId = parsed.accountId;
            }
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'invalid json' }));
            return;
          }

          this.enqueueManualSync(accountId);

          res.writeHead(202, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ queued: accountId || 'all' }));
        });
        return;
      }

      if (req.method === 'GET' && req.url === '/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          isRunning: this.isRunning,
          cycleInFlight: this.cycleInFlight,
          manualInFlight: this.manualInFlight,
          queued: Array.from(this.manualQueue),
          intervalMinutes: this.intervalMinutes,
        }));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    });

    this.httpServer.listen(port, host, () => {
      console.log(`[sync] http endpoint listening on ${host}:${port}`);
    });

    this.httpServer.on('error', (error) => {
      console.error('[sync] http endpoint error:', error.message);
    });
  }

  enqueueManualSync(accountId) {
    this.manualQueue.add(accountId || '__all__');
    console.log(`[sync] manual trigger queued: ${accountId || 'all accounts'}`);
    this.drainManualQueue().catch((error) => {
      console.error('[sync] manual drain failed:', error.message);
    });
  }

  async drainManualQueue() {
    if (this.manualInFlight) return;
    this.manualInFlight = true;

    try {
      while (this.manualQueue.size > 0) {
        const entry = this.manualQueue.values().next().value;
        this.manualQueue.delete(entry);
        const accountId = entry === '__all__' ? undefined : entry;
        await this.runCycle('manual', accountId);
      }
    } finally {
      this.manualInFlight = false;
    }
  }

  async runCycle(reason, accountId) {
    if (this.cycleInFlight) {
      console.log(`[sync] skipping ${reason} cycle, previous cycle still in flight`);
      return;
    }

    this.cycleInFlight = true;
    const startedAt = Date.now();

    try {
      const where = {
        isActive: true,
        syncEnabled: true,
      };
      if (accountId) {
        where.id = accountId;
      }

      const accounts = await this.prisma.imapAccount.findMany({
        where,
        include: {
          user: {
            select: { email: true, name: true },
          },
        },
      });

      if (accounts.length === 0) {
        console.log(`[sync] ${reason} cycle: no eligible accounts`);
        return;
      }

      console.log(`[sync] ${reason} cycle: processing ${accounts.length} account(s)`);

      for (const account of accounts) {
        await this.syncAccount(account);
      }

      const durationMs = Date.now() - startedAt;
      console.log(`[sync] ${reason} cycle complete in ${durationMs}ms`);
    } catch (error) {
      console.error(`[sync] ${reason} cycle error:`, error.message);
    } finally {
      this.cycleInFlight = false;
    }
  }

  async syncAccount(account) {
    console.log(`[sync] syncing ${account.email}`);

    const syncService = new ImapSyncService({
      accountId: account.id,
      host: account.imapServer,
      port: account.imapPort,
      user: account.imapUsername,
      password: account.imapPassword,
      tls: account.useTls,
      dbPath: account.dbPath,
    });

    let result;
    try {
      result = await syncService.incrementalSync();
    } catch (error) {
      await this.recordFailure(account, error);
      return;
    }

    const transportErrors = result.errors || [];
    const authErrors = transportErrors
      .map((message) => classifyImapError({ message }))
      .filter((c) => c.kind === 'auth');

    if (authErrors.length > 0) {
      await this.disableForAuthFailure(account, authErrors[0].message);
      return;
    }

    if (transportErrors.length > 0) {
      await this.recordSoftErrors(account, transportErrors);
      return;
    }

    await this.recordSuccess(account, result.totalMessages || 0);
  }

  async recordSuccess(account, totalMessages) {
    await this.prisma.imapAccount.update({
      where: { id: account.id },
      data: {
        lastSyncAt: new Date(),
        errorMessage: null,
        errorCount: 0,
      },
    });
    console.log(`[sync] ${account.email}: ${totalMessages} new message(s)`);
  }

  async recordSoftErrors(account, errors) {
    const message = errors.join('; ').slice(0, 1000);
    const nextErrorCount = (account.errorCount || 0) + 1;
    const exhaustedRetries = nextErrorCount >= SOFT_ERROR_LIMIT;

    await this.prisma.imapAccount.update({
      where: { id: account.id },
      data: {
        lastSyncAt: new Date(),
        errorMessage: message,
        errorCount: nextErrorCount,
        syncEnabled: !exhaustedRetries,
      },
    });

    if (exhaustedRetries) {
      console.warn(`[sync] ${account.email}: disabled after ${nextErrorCount} consecutive failures`);
    } else {
      console.warn(`[sync] ${account.email}: soft error ${nextErrorCount}/${SOFT_ERROR_LIMIT} — ${message}`);
    }
  }

  async recordFailure(account, error) {
    const classification = classifyImapError(error);

    if (classification.kind === 'auth') {
      await this.disableForAuthFailure(account, classification.message);
      return;
    }

    await this.recordSoftErrors(account, [classification.message]);
  }

  async disableForAuthFailure(account, message) {
    await this.prisma.imapAccount.update({
      where: { id: account.id },
      data: {
        lastSyncAt: new Date(),
        errorMessage: message,
        errorCount: HARD_ERROR_COUNT_SENTINEL,
        syncEnabled: false,
      },
    });
    console.error(`[sync] ${account.email}: disabled due to auth failure — ${message}`);
  }

  async getStatus() {
    const accounts = await this.prisma.imapAccount.findMany({
      select: {
        id: true,
        email: true,
        isActive: true,
        syncEnabled: true,
        lastSyncAt: true,
        errorMessage: true,
        errorCount: true,
      },
    });

    return {
      isRunning: this.isRunning,
      cycleInFlight: this.cycleInFlight,
      intervalMinutes: this.intervalMinutes,
      accounts,
    };
  }
}

module.exports = { BackgroundSyncService };

if (require.main === module) {
  const service = new BackgroundSyncService();

  const shutdown = async () => {
    console.log('[sync] received shutdown signal');
    await service.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  service.start().catch((error) => {
    console.error('[sync] failed to start:', error);
    process.exit(1);
  });
}
