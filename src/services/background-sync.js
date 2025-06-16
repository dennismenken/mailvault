#!/usr/bin/env node

const { PrismaClient } = require('../generated/prisma');
const { ImapSyncService } = require('./imap-sync');

class BackgroundSyncService {
  constructor() {
    this.prisma = new PrismaClient();
    this.syncInterval = (parseInt(process.env.SYNC_INTERVAL_MINUTES) || 30) * 60 * 1000; // Convert to milliseconds
    this.isRunning = false;
    this.syncTimeouts = new Map();
  }

  async start() {
    if (this.isRunning) {
      console.log('🔄 Background sync service is already running');
      return;
    }

    this.isRunning = true;
    console.log('🚀 Starting background sync service...');
    console.log(`⏰ Sync interval: ${this.syncInterval / 1000 / 60} minutes`);

    // Initial sync
    await this.syncAllAccounts();

    // Schedule periodic syncs
    this.scheduleNextSync();

    console.log('✅ Background sync service started successfully');
  }

  async stop() {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    
    // Clear all timeouts
    for (const timeout of this.syncTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.syncTimeouts.clear();

    await this.prisma.$disconnect();
    console.log('🛑 Background sync service stopped');
  }

  scheduleNextSync() {
    if (!this.isRunning) return;

    const timeout = setTimeout(async () => {
      if (this.isRunning) {
        await this.syncAllAccounts();
        this.scheduleNextSync();
      }
    }, this.syncInterval);

    this.syncTimeouts.set('main', timeout);
  }

  async syncAllAccounts() {
    try {
      console.log('\n🔄 Starting scheduled sync for all accounts...');
      
      const accounts = await this.prisma.imapAccount.findMany({
        where: {
          isActive: true,
          syncEnabled: true,
        },
        include: {
          user: {
            select: {
              email: true,
              name: true,
            },
          },
        },
      });

      if (accounts.length === 0) {
        console.log('📭 No active IMAP accounts found for sync');
        return;
      }

      console.log(`📧 Found ${accounts.length} active IMAP account(s) to sync`);

      for (const account of accounts) {
        try {
          console.log(`\n🔄 Syncing account: ${account.email} (${account.user.email})`);
          
          const syncService = new ImapSyncService({
            accountId: account.id,
            host: account.imapServer,
            port: account.imapPort,
            user: account.imapUsername,
            password: account.imapPassword,
            tls: account.useTls,
            dbPath: account.dbPath,
          });

          // Use incremental sync for regular scheduled syncs
          const result = await syncService.incrementalSync();

          // Update sync status
          await this.prisma.imapAccount.update({
            where: { id: account.id },
            data: {
              lastSyncAt: new Date(),
              errorMessage: null,
              errorCount: 0,
            },
          });

          console.log(`✅ Incremental sync completed for ${account.email}: ${result.totalMessages} new messages`);

        } catch (error) {
          console.error(`❌ Sync failed for account ${account.email}:`, error.message);
          
          // Update error status
          await this.prisma.imapAccount.update({
            where: { id: account.id },
            data: {
              errorMessage: error.message,
              errorCount: {
                increment: 1,
              },
              // Disable sync if too many errors
              syncEnabled: account.errorCount < 5,
            },
          });
        }
      }

      console.log('\n✅ Scheduled sync completed for all accounts');
      
    } catch (error) {
      console.error('❌ Error during scheduled sync:', error.message);
    }
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
      syncInterval: this.syncInterval,
      accounts: accounts.map(account => ({
        ...account,
        nextSyncAt: account.lastSyncAt ? 
          new Date(account.lastSyncAt.getTime() + this.syncInterval) : 
          new Date(),
      })),
    };
  }
}

module.exports = { BackgroundSyncService };

// Handle graceful shutdown
const syncService = new BackgroundSyncService();

process.on('SIGINT', async () => {
  await syncService.stop();
});

process.on('SIGTERM', async () => {
  await syncService.stop();
});

// Only run if this script is executed directly
if (require.main === module) {
  syncService.start().catch(error => {
    console.error('❌ Failed to start background sync service:', error);
    process.exit(1);
  });
} 