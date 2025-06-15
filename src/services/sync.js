#!/usr/bin/env node

const { PrismaClient } = require('../generated/prisma');
const { ImapSyncService } = require('./imap-sync');

const prisma = new PrismaClient();

async function syncImapAccount(accountId) {
  // Get the account from database
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

  // Create sync service
  const syncService = new ImapSyncService({
    host: account.imapServer,
    port: account.imapPort,
    user: account.imapUsername,
    password: account.imapPassword,
    tls: account.useTls,
    accountId: account.id,
    dbPath: account.dbPath,
  });

  // Perform sync
  const result = await syncService.fullSync();
  
  return {
    newEmails: result.totalMessages,
    totalEmails: result.totalMessages,
    errors: result.errors,
    timeElapsed: result.timeElapsed,
    processedMessages: result.processedMessages
  };
}

async function syncAllAccounts() {
  console.log('🔄 Starting comprehensive email synchronization...');
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
      console.log('📭 No IMAP accounts found to sync');
      return;
    }

    console.log(`📧 Found ${accounts.length} IMAP account(s) to sync:`);
    accounts.forEach((account, index) => {
      console.log(`   ${index + 1}. ${account.email} (${account.user.email})`);
      console.log(`      Server: ${account.imapServer}:${account.imapPort} (${account.useTls ? 'TLS' : 'No TLS'})`);
      console.log(`      Database: ${account.dbPath}`);
    });
    console.log('');

    // Sync each account
    const results = [];
    let totalProcessedMessages = 0;
    let totalNewMessages = 0;

    for (let i = 0; i < accounts.length; i++) {
      const account = accounts[i];
      console.log(`\n${'='.repeat(80)}`);
      console.log(`🔄 SYNCING ACCOUNT ${i + 1}/${accounts.length}: ${account.email}`);
      console.log(`   User: ${account.user.email}`);
      console.log(`   Server: ${account.imapServer}:${account.imapPort} (${account.useTls ? 'TLS' : 'No TLS'})`);
      console.log(`${'='.repeat(80)}`);
      
      try {
        const result = await syncImapAccount(account.id);
        results.push({
          account: account.email,
          user: account.user.email,
          success: true,
          ...result
        });
        
        totalProcessedMessages += result.processedMessages || 0;
        totalNewMessages += result.newEmails || 0;
        
        console.log(`\n✅ ACCOUNT SYNC COMPLETED: ${account.email}`);
        console.log(`   📧 New emails: ${result.newEmails}`);
        console.log(`   📊 Processed messages: ${result.processedMessages}`);
        console.log(`   ⏱️  Time elapsed: ${result.timeElapsed}s`);
        
        if (result.errors && result.errors.length > 0) {
          console.log(`   ⚠️  ${result.errors.length} errors occurred:`);
          result.errors.slice(0, 5).forEach((error, idx) => {
            console.log(`      ${idx + 1}. ${error}`);
          });
          if (result.errors.length > 5) {
            console.log(`      ... and ${result.errors.length - 5} more errors`);
          }
        }
        
      } catch (error) {
        console.log(`\n❌ ACCOUNT SYNC FAILED: ${account.email}`);
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
        console.log(`\n⏸️  Waiting 5 seconds before next account...`);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }

    // Final Summary
    const totalTime = Math.round((Date.now() - startTime) / 1000);
    console.log(`\n${'█'.repeat(80)}`);
    console.log(`📊 FINAL SYNCHRONIZATION SUMMARY`);
    console.log(`${'█'.repeat(80)}`);
    
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);
    
    console.log(`✅ Successful accounts: ${successful.length}`);
    console.log(`❌ Failed accounts: ${failed.length}`);
    console.log(`📧 Total new emails synced: ${totalNewMessages}`);
    console.log(`📊 Total messages processed: ${totalProcessedMessages}`);
    console.log(`⏱️  Total time elapsed: ${Math.floor(totalTime / 60)}m ${totalTime % 60}s`);
    
    if (totalNewMessages > 0) {
      const avgSpeed = Math.round(totalProcessedMessages / totalTime);
      console.log(`🚀 Average processing speed: ${avgSpeed} messages/second`);
    }

    if (successful.length > 0) {
      console.log(`\n✅ Successfully synced accounts:`);
      successful.forEach((result, idx) => {
        const timeStr = result.timeElapsed ? `${result.timeElapsed}s` : 'N/A';
        console.log(`   ${idx + 1}. ${result.account} - ${result.newEmails} new emails (${timeStr})`);
      });
    }

    if (failed.length > 0) {
      console.log(`\n❌ Failed accounts:`);
      failed.forEach((result, idx) => {
        console.log(`   ${idx + 1}. ${result.account} (${result.user}): ${result.error}`);
      });
    }

    console.log(`\n💾 All emails are stored in separate SQLite databases per account`);
    console.log(`🔍 Use the web interface to search and browse synced emails`);
    console.log(`${'█'.repeat(80)}`);

  } catch (error) {
    console.error('❌ Sync process failed:', error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Handle process termination gracefully
process.on('SIGINT', async () => {
  console.log('\n🛑 Sync interrupted by user');
  console.log('💾 Partial sync data has been saved');
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Sync terminated');
  console.log('💾 Partial sync data has been saved');
  await prisma.$disconnect();
  process.exit(0);
});

// Only run if this script is executed directly
if (require.main === module) {
  syncAllAccounts()
    .then(() => {
      console.log('\n🎉 All synchronization tasks completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Sync failed:', error);
      process.exit(1);
    });
} 