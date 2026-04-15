#!/usr/bin/env node

const { createMainPrismaClient, createAccountPrismaClient } = require('../src/lib/prisma-factory');
const path = require('path');

const prisma = createMainPrismaClient();

// Simulate the API call directly
async function testAPIEndpoint() {
  console.log('🌐 Testing /api/emails/search endpoint logic...');
  console.log('═'.repeat(50));
  
  try {
    // Simulate a session user
    const sessionUserId = 'cmbwtkdb60000soe2vkz23ns0'; // From our test above
    
    console.log(`👤 Testing with session user ID: ${sessionUserId}`);
    
    // Get user's IMAP accounts (same logic as API)
    const userAccounts = await prisma.imapAccount.findMany({
      where: {
        userId: sessionUserId,
        isActive: true,
      },
    });

    console.log(`📧 Found ${userAccounts.length} active IMAP account(s)`);

    if (userAccounts.length === 0) {
      console.log('❌ No active email accounts found');
      return;
    }

    const allEmails = [];

    // Search in each account's database (same logic as API)
    for (const account of userAccounts) {
      try {
        console.log(`\n🔍 Searching account: ${account.email}`);
        
        // Ensure we have the correct absolute path (same logic as API)
        const absoluteDbPath = account.dbPath.startsWith('/')
          ? account.dbPath
          : path.resolve(process.cwd(), account.dbPath);

        const accountPrisma = createAccountPrismaClient(absoluteDbPath);

        // Same query as in the actual API
        const query = `
          SELECT 
            id, messageId, subject, fromAddress, fromName, toAddresses, 
            date, folder, bodyText, bodyHtml, contentType, hasAttachments, 
            attachmentsPath, size
          FROM emails 
          WHERE 1=1
          ORDER BY date DESC
          LIMIT 1000
        `;

        const rawEmails = await accountPrisma.$queryRawUnsafe(query);
        console.log(`📨 Retrieved ${rawEmails.length} emails from account`);
        
        // Same mapping logic as API
        const emails = rawEmails.map((email) => ({
          id: email.id,
          messageId: email.messageId,
          subject: email.subject,
          fromAddress: email.fromAddress,
          fromName: email.fromName,
          toAddresses: email.toAddresses ? JSON.parse(email.toAddresses) : [],
          date: email.date,
          folder: email.folder,
          bodyText: email.bodyText?.substring(0, 500), // Truncate for performance
          bodyHtml: email.bodyHtml?.substring(0, 1000), // Truncate HTML for performance
          contentType: email.contentType || 'PLAIN',
          hasAttachments: email.hasAttachments || false,
          attachmentsPath: email.attachmentsPath,
          accountEmail: account.email,
          size: email.size,
        }));

        allEmails.push(...emails);

        await accountPrisma.$disconnect();
        
        console.log(`✅ Account search successful: ${emails.length} emails`);
        
        // Show first few emails
        if (emails.length > 0) {
          console.log('\n📧 First 3 emails:');
          emails.slice(0, 3).forEach((email, index) => {
            console.log(`   ${index + 1}. "${email.subject}" from ${email.fromAddress}`);
            console.log(`      📅 ${email.date} | 📁 ${email.folder} | 🎯 ${email.contentType}`);
            if (email.hasAttachments) console.log(`      📎 Has attachments`);
          });
        }

      } catch (error) {
        console.error(`❌ Error searching in account ${account.email}:`, error.message);
      }
    }

    // Sort by date (most recent first) - same as API
    allEmails.sort((a, b) => {
      const dateA = new Date(a.date || 0).getTime();
      const dateB = new Date(b.date || 0).getTime();
      return dateB - dateA;
    });

    // Pagination logic - same as API
    const page = 1;
    const limit = 50;
    const startIndex = ((page) - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedEmails = allEmails.slice(startIndex, endIndex);

    const response = {
      emails: paginatedEmails,
      totalCount: allEmails.length,
      page: page,
      limit: limit,
      totalPages: Math.ceil(allEmails.length / limit),
    };

    console.log('\n🎯 API Response simulation:');
    console.log(`📊 Total emails: ${response.totalCount}`);
    console.log(`📄 Page: ${response.page}/${response.totalPages}`);
    console.log(`📝 Returned: ${response.emails.length} emails`);
    
    console.log('\n🎉 API endpoint test completed successfully!');
    
    return response;
    
  } catch (error) {
    console.error('💥 API test failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Only run if this script is executed directly
if (require.main === module) {
  testAPIEndpoint()
    .then((response) => {
      console.log('\n✅ API simulation completed successfully!');
      console.log(`📈 Summary: ${response.emails.length} emails ready for display`);
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 API simulation failed:', error);
      process.exit(1);
    });
}

module.exports = { testAPIEndpoint }; 