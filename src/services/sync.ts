#!/usr/bin/env ts-node

import { PrismaClient } from '../generated/prisma';
import { ImapSyncService } from '../lib/imap-sync';

const prisma = new PrismaClient();

async function syncImapAccount(accountId: string): Promise<{ newEmails: number; totalEmails: number; errors: string[] }> {
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
    totalEmails: result.totalMessages, // For now, this is the same as new emails
    errors: result.errors
  };
}

async function syncAllAccounts() {
  console.log('🔄 Starting email synchronization...');
  console.log('═'.repeat(50));

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
    });
    console.log('');

    // Sync each account
    const results = [];
    for (const account of accounts) {
      console.log(`🔄 Syncing: ${account.email} (User: ${account.user.email})`);
      console.log(`   Server: ${account.imapServer}:${account.imapPort} (${account.useTls ? 'TLS' : 'No TLS'})`);
      
      try {
        const result = await syncImapAccount(account.id);
        results.push({
          account: account.email,
          user: account.user.email,
          success: true,
          ...result
        });
        
        console.log(`   ✅ Success: ${result.newEmails} new emails, ${result.totalEmails} total`);
        if (result.errors && result.errors.length > 0) {
          console.log(`   ⚠️  ${result.errors.length} errors occurred`);
          result.errors.forEach((error: string) => {
            console.log(`      • ${error}`);
          });
        }
      } catch (error) {
        console.log(`   ❌ Failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        results.push({
          account: account.email,
          user: account.user.email,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
      console.log('');
    }

    // Summary
    console.log('📊 Synchronization Summary:');
    console.log('═'.repeat(30));
    
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);
    
    console.log(`✅ Successful: ${successful.length}`);
    console.log(`❌ Failed: ${failed.length}`);
    
    if (successful.length > 0) {
      const totalNewEmails = successful.reduce((sum, r) => sum + ('newEmails' in r ? r.newEmails : 0), 0);
      const totalEmails = successful.reduce((sum, r) => sum + ('totalEmails' in r ? r.totalEmails : 0), 0);
      console.log(`📧 Total new emails: ${totalNewEmails}`);
      console.log(`📧 Total emails in system: ${totalEmails}`);
    }

    if (failed.length > 0) {
      console.log('');
      console.log('❌ Failed accounts:');
      failed.forEach(result => {
        console.log(`   • ${result.account} (${result.user}): ${result.error}`);
      });
    }

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
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Sync terminated');
  await prisma.$disconnect();
  process.exit(0);
});

// Only run if this script is executed directly
if (require.main === module) {
  syncAllAccounts()
    .then(() => {
      console.log('✅ Sync completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Sync failed:', error);
      process.exit(1);
    });
} 