#!/usr/bin/env ts-node

import cron from 'node-cron';
import { PrismaClient } from '../src/generated/prisma';
import { ImapSyncService } from '../src/lib/imap-sync';

const prisma = new PrismaClient();

class SyncScheduler {
  private isRunning = false;
  private activeSyncs = new Set<string>();

  constructor() {
    console.log('🚀 Sync Scheduler initialized');
  }

  async start() {
    const syncInterval = process.env.SYNC_INTERVAL_MINUTES || '30';
    const cronExpression = `*/${syncInterval} * * * *`; // Every N minutes

    console.log(`⏰ Starting sync scheduler with interval: ${syncInterval} minutes`);

    cron.schedule(cronExpression, async () => {
      if (this.isRunning) {
        console.log('⏸️ Sync already running, skipping this cycle');
        return;
      }

      await this.runSyncCycle();
    });

    // Run initial sync
    await this.runSyncCycle();

    console.log('✅ Sync scheduler started successfully');
  }

  async runSyncCycle() {
    this.isRunning = true;
    console.log('\n🔄 Starting sync cycle...');

    try {
      const accounts = await this.getActiveSyncAccounts();
      
      if (accounts.length === 0) {
        console.log('📪 No active accounts to sync');
        return;
      }

      console.log(`📧 Found ${accounts.length} accounts to sync`);

      // Process accounts in parallel (but limit concurrency)
      const maxConcurrent = 3;
      const chunks = this.chunkArray(accounts, maxConcurrent);

      for (const chunk of chunks) {
        const promises = chunk.map(account => this.syncAccount(account));
        await Promise.allSettled(promises);
      }

      console.log('✅ Sync cycle completed');
    } catch (error) {
      console.error('❌ Error in sync cycle:', error);
    } finally {
      this.isRunning = false;
    }
  }

  private async getActiveSyncAccounts() {
    return await prisma.imapAccount.findMany({
      where: {
        isActive: true,
        syncEnabled: true,
        errorCount: {
          lt: parseInt(process.env.MAX_SYNC_ERRORS || '5'),
        },
      },
      include: {
        user: true,
      },
    });
  }

  private async syncAccount(account: any) {
    if (this.activeSyncs.has(account.id)) {
      console.log(`⏸️ Account ${account.email} is already syncing, skipping`);
      return;
    }

    this.activeSyncs.add(account.id);
    console.log(`🔄 Starting sync for account: ${account.email}`);

    try {
      const syncService = new ImapSyncService({
        host: account.imapServer,
        port: account.imapPort,
        user: account.imapUsername,
        password: account.imapPassword,
        tls: account.useTls,
        accountId: account.id,
        dbPath: account.dbPath,
      });

      // Use incremental sync for scheduled syncs
      const result = await syncService.incrementalSync();

      // Update account with sync results
      await prisma.imapAccount.update({
        where: { id: account.id },
        data: {
          lastSyncAt: new Date(),
          errorMessage: result.errors.length > 0 ? result.errors.join('; ') : null,
          errorCount: result.errors.length > 0 ? account.errorCount + 1 : 0,
          syncEnabled: result.errors.length > 0 && account.errorCount + 1 >= parseInt(process.env.MAX_SYNC_ERRORS || '5') ? false : account.syncEnabled,
        },
      });

      if (result.errors.length === 0) {
        console.log(`✅ Successfully synced ${result.totalMessages} messages for ${account.email}`);
      } else {
        console.error(`⚠️ Sync completed with errors for ${account.email}:`, result.errors);
        
        if (account.errorCount + 1 >= parseInt(process.env.MAX_SYNC_ERRORS || '5')) {
          console.error(`❌ Account ${account.email} disabled due to too many errors`);
        }
      }

    } catch (error: any) {
      console.error(`❌ Critical error syncing account ${account.email}:`, error.message);
      
      // Update error count and potentially disable account
      const newErrorCount = account.errorCount + 1;
      const maxErrors = parseInt(process.env.MAX_SYNC_ERRORS || '5');
      
      await prisma.imapAccount.update({
        where: { id: account.id },
        data: {
          errorMessage: error.message,
          errorCount: newErrorCount,
          syncEnabled: newErrorCount >= maxErrors ? false : account.syncEnabled,
        },
      });

      if (newErrorCount >= maxErrors) {
        console.error(`❌ Account ${account.email} disabled due to critical errors`);
      }
    } finally {
      this.activeSyncs.delete(account.id);
    }
  }

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  async stop() {
    console.log('🛑 Stopping sync scheduler...');
    await prisma.$disconnect();
    process.exit(0);
  }
}

async function main() {
  const scheduler = new SyncScheduler();

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n📡 Received SIGINT, shutting down gracefully...');
    await scheduler.stop();
  });

  process.on('SIGTERM', async () => {
    console.log('\n📡 Received SIGTERM, shutting down gracefully...');
    await scheduler.stop();
  });

  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
  });

  await scheduler.start();
}

if (require.main === module) {
  main().catch((error) => {
    console.error('❌ Failed to start sync scheduler:', error);
    process.exit(1);
  });
} 