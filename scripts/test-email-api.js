#!/usr/bin/env node

const { PrismaClient } = require('../src/generated/prisma');
const path = require('path');

const prisma = new PrismaClient();

async function testEmailAPI() {
  console.log('🧪 Testing Email API directly...');
  console.log('═'.repeat(50));
  
  try {
    // Get the user (should be admin@example.com)
    const user = await prisma.user.findFirst({
      where: { email: 'admin@example.com' }
    });
    
    if (!user) {
      console.log('❌ No user found with email admin@example.com');
      return;
    }
    
    console.log(`👤 Found user: ${user.email} (ID: ${user.id})`);
    
    // Get user's IMAP accounts
    const userAccounts = await prisma.imapAccount.findMany({
      where: {
        userId: user.id,
        isActive: true,
      },
    });
    
    console.log(`📧 Found ${userAccounts.length} active IMAP account(s)`);
    
    if (userAccounts.length === 0) {
      console.log('❌ No active IMAP accounts found for user');
      return;
    }
    
    // Test each account database
    for (const account of userAccounts) {
      console.log(`\n🔍 Testing account: ${account.email}`);
      console.log(`📁 Database path: ${account.dbPath}`);
      
      try {
        // Test direct database access
        const { PrismaClient: AccountPrismaClient } = require('../src/generated/prisma');
        const absoluteDbPath = account.dbPath.startsWith('/') 
          ? account.dbPath 
          : path.resolve(process.cwd(), account.dbPath);
        
        console.log(`🔗 Absolute path: ${absoluteDbPath}`);
        
        const accountPrisma = new AccountPrismaClient({
          datasources: {
            db: {
              url: `file:${absoluteDbPath}`,
            },
          },
        });
        
        // Try a simple query
        const emailCount = await accountPrisma.$queryRaw`SELECT COUNT(*) as count FROM emails`;
        console.log(`📊 Total emails in DB: ${emailCount[0].count}`);
        
        // Try the same query as the API
        const query = `
          SELECT 
            id, messageId, subject, fromAddress, fromName, toAddresses, 
            date, folder, bodyText, bodyHtml, contentType, hasAttachments, 
            attachmentsPath, size
          FROM emails 
          WHERE 1=1
          ORDER BY date DESC
          LIMIT 10
        `;
        
        const rawEmails = await accountPrisma.$queryRawUnsafe(query);
        console.log(`📨 Retrieved ${rawEmails.length} emails from API query`);
        
        if (rawEmails.length > 0) {
          const firstEmail = rawEmails[0];
          console.log(`📧 First email: "${firstEmail.subject}" from ${firstEmail.fromAddress}`);
          console.log(`📅 Date: ${firstEmail.date}`);
          console.log(`📁 Folder: ${firstEmail.folder}`);
          console.log(`🎯 Content Type: ${firstEmail.contentType || 'PLAIN'}`);
          console.log(`📎 Has Attachments: ${firstEmail.hasAttachments || false}`);
        }
        
        await accountPrisma.$disconnect();
        
        console.log(`✅ Account database test successful`);
        
      } catch (error) {
        console.error(`❌ Account database test failed:`, error.message);
      }
    }
    
    console.log('\n🎉 Email API test completed!');
    
  } catch (error) {
    console.error('💥 Test failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Only run if this script is executed directly
if (require.main === module) {
  testEmailAPI()
    .then(() => {
      console.log('\n✅ Test completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Test failed:', error);
      process.exit(1);
    });
}

module.exports = { testEmailAPI }; 