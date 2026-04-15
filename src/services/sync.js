#!/usr/bin/env node

const { createMainPrismaClient } = require('../lib/prisma-factory');
const { ImapSyncService } = require('./imap-sync');
const { classifyImapError } = require('./imap-errors');

const prisma = createMainPrismaClient();
const SOFT_ERROR_LIMIT = parseInt(process.env.MAX_SYNC_ERRORS || '5', 10);
const HARD_ERROR_COUNT_SENTINEL = 9999;

async function applySyncOutcome(account, result, fatal) {
  if (fatal) {
    const classification = classifyImapError(fatal);
    if (classification.kind === 'auth') {
      await prisma.imapAccount.update({
        where: { id: account.id },
        data: {
          lastSyncAt: new Date(),
          errorMessage: classification.message,
          errorCount: HARD_ERROR_COUNT_SENTINEL,
          syncEnabled: false,
        },
      });
      console.error(`[sync] ${account.email}: disabled due to auth failure — ${classification.message}`);
      return { auth: true };
    }
    const nextErrorCount = (account.errorCount || 0) + 1;
    const exhausted = nextErrorCount >= SOFT_ERROR_LIMIT;
    await prisma.imapAccount.update({
      where: { id: account.id },
      data: {
        lastSyncAt: new Date(),
        errorMessage: classification.message,
        errorCount: nextErrorCount,
        syncEnabled: !exhausted,
      },
    });
    if (exhausted) {
      console.warn(`[sync] ${account.email}: disabled after ${nextErrorCount} consecutive failures`);
    }
    return { auth: false };
  }

  const transportErrors = (result && result.errors) || [];
  const authErrors = transportErrors
    .map((message) => classifyImapError({ message }))
    .filter((c) => c.kind === 'auth');

  if (authErrors.length > 0) {
    await prisma.imapAccount.update({
      where: { id: account.id },
      data: {
        lastSyncAt: new Date(),
        errorMessage: authErrors[0].message,
        errorCount: HARD_ERROR_COUNT_SENTINEL,
        syncEnabled: false,
      },
    });
    console.error(`[sync] ${account.email}: disabled due to auth failure — ${authErrors[0].message}`);
    return { auth: true };
  }

  if (transportErrors.length > 0) {
    const message = transportErrors.join('; ').slice(0, 1000);
    const nextErrorCount = (account.errorCount || 0) + 1;
    const exhausted = nextErrorCount >= SOFT_ERROR_LIMIT;
    await prisma.imapAccount.update({
      where: { id: account.id },
      data: {
        lastSyncAt: new Date(),
        errorMessage: message,
        errorCount: nextErrorCount,
        syncEnabled: !exhausted,
      },
    });
    return { auth: false };
  }

  await prisma.imapAccount.update({
    where: { id: account.id },
    data: {
      lastSyncAt: new Date(),
      errorMessage: null,
      errorCount: 0,
    },
  });
  return { auth: false };
}

async function syncImapAccount(accountId, useIncrementalSync = true) {
  const account = await prisma.imapAccount.findUnique({
    where: { id: accountId },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          name: true
        }
      }
    }
  });

  if (!account) {
    throw new Error(`IMAP account with ID ${accountId} not found`);
  }

  const syncService = new ImapSyncService({
    host: account.imapServer,
    port: account.imapPort,
    user: account.imapUsername,
    password: account.imapPassword,
    tls: account.useTls,
    accountId: account.id,
    dbPath: account.dbPath,
  });

  let result;
  let fatal;
  try {
    result = useIncrementalSync
      ? await syncService.incrementalSync()
      : await syncService.fullSync();
  } catch (error) {
    fatal = error;
  }

  await applySyncOutcome(account, result, fatal);

  if (fatal) {
    throw fatal;
  }

  return {
    newEmails: result.totalMessages,
    totalEmails: result.totalMessages,
    errors: result.errors,
    timeElapsed: result.timeElapsed,
    processedMessages: result.processedMessages
  };
}

async function syncAllAccounts(forceFullSync = false) {
  const syncType = forceFullSync ? 'full' : 'incremental';
  console.log(`[sync] Starting ${syncType} email synchronization...`);
  console.log('═'.repeat(60));
  const startTime = Date.now();

  try {
    // Get all IMAP accounts
    const accounts = await prisma.imapAccount.findMany({
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true
          }
        }
      }
    });

    if (accounts.length === 0) {
      console.log('[sync] No IMAP accounts found to sync');
      return;
    }

    console.log(`[sync] Found ${accounts.length} IMAP account(s) to sync:`);
    accounts.forEach((account, index) => {
      console.log(`   ${index + 1}. ${account.email} (${account.user.email})`);
      console.log(`      Server: ${account.imapServer}:${account.imapPort} (${account.useTls ? 'TLS' : 'No TLS'})`);
      console.log(`      Database: ${account.dbPath}`);
    });
    console.log(`\n[sync] Sync mode: ${syncType.toUpperCase()}`);
    if (!forceFullSync) {
      console.log('[sync] Tip: Use --full flag for complete synchronization of all messages');
    }
    console.log('');

    // Sync each account
    const results = [];
    let totalProcessedMessages = 0;
    let totalNewMessages = 0;

    for (let i = 0; i < accounts.length; i++) {
      const account = accounts[i];
      console.log(`\n${'='.repeat(80)}`);
      console.log(`[sync] ${syncType.toUpperCase()} SYNC ${i + 1}/${accounts.length}: ${account.email}`);
      console.log(`   User: ${account.user.email}`);
      console.log(`   Server: ${account.imapServer}:${account.imapPort} (${account.useTls ? 'TLS' : 'No TLS'})`);
      console.log(`${'='.repeat(80)}`);
      
      try {
        const result = await syncImapAccount(account.id, !forceFullSync);
        results.push({
          account: account.email,
          user: account.user.email,
          success: true,
          ...result
        });
        
        totalProcessedMessages += result.processedMessages || 0;
        totalNewMessages += result.newEmails || 0;
        
        console.log(`\n[ok] ACCOUNT SYNC COMPLETED: ${account.email}`);
        console.log(`   [sync] New emails: ${result.newEmails}`);
        console.log(`   [sync] Processed messages: ${result.processedMessages}`);
        console.log(`   [sync] Time elapsed: ${result.timeElapsed}s`);
        
        if (result.errors && result.errors.length > 0) {
          console.log(`   [warn] ${result.errors.length} errors occurred:`);
          result.errors.slice(0, 5).forEach((error, idx) => {
            console.log(`      ${idx + 1}. ${error}`);
          });
          if (result.errors.length > 5) {
            console.log(`      ... and ${result.errors.length - 5} more errors`);
          }
        }
        
      } catch (error) {
        console.log(`\n[err] ACCOUNT SYNC FAILED: ${account.email}`);
        console.log(`   Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        
        results.push({
          account: account.email,
          user: account.user.email,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
      
      // Small delay between accounts to prevent server overload
      if (i < accounts.length - 1) {
        console.log(`\n[sync] Waiting 5 seconds before next account...`);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }

    // Final Summary
    const totalTime = Math.round((Date.now() - startTime) / 1000);
    console.log(`\n${'█'.repeat(80)}`);
    console.log(`[sync] FINAL ${syncType.toUpperCase()} SYNCHRONIZATION SUMMARY`);
    console.log(`${'█'.repeat(80)}`);
    
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);
    
    console.log(`[ok] Successful accounts: ${successful.length}`);
    console.log(`[err] Failed accounts: ${failed.length}`);
    console.log(`[sync] Total new emails synced: ${totalNewMessages}`);
    console.log(`[sync] Total messages processed: ${totalProcessedMessages}`);
    console.log(`[sync] Total time elapsed: ${Math.floor(totalTime / 60)}m ${totalTime % 60}s`);
    
    if (totalNewMessages > 0) {
      const avgSpeed = Math.round(totalProcessedMessages / totalTime);
      console.log(`[sync] Average processing speed: ${avgSpeed} messages/second`);
    }

    if (successful.length > 0) {
      console.log(`\n[ok] Successfully synced accounts:`);
      successful.forEach((result, idx) => {
        const timeStr = result.timeElapsed ? `${result.timeElapsed}s` : 'N/A';
        console.log(`   ${idx + 1}. ${result.account} - ${result.newEmails} new emails (${timeStr})`);
      });
    }

    if (failed.length > 0) {
      console.log(`\n[err] Failed accounts:`);
      failed.forEach((result, idx) => {
        console.log(`   ${idx + 1}. ${result.account} (${result.user}): ${result.error}`);
      });
    }

    console.log(`\n[sync] All emails are stored in separate SQLite databases per account`);
    console.log(`[sync] Use the web interface to search and browse synced emails`);
    console.log(`[sync] Background service uses incremental sync every ${process.env.SYNC_INTERVAL_MINUTES || 30} minutes`);
    console.log(`${'█'.repeat(80)}`);

  } catch (error) {
    console.error('[err] Sync process failed:', error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const forceFullSync = args.includes('--full') || args.includes('-f');

// Only run if this script is executed directly
if (require.main === module) {
  syncAllAccounts(forceFullSync)
    .then(() => {
      const syncType = forceFullSync ? 'full' : 'incremental';
      console.log(`\n[sync] All ${syncType} synchronization tasks completed successfully!`);
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n[err] Sync failed:', error);
      process.exit(1);
    });
} 
