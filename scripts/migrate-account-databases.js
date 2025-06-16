#!/usr/bin/env node

const { PrismaClient } = require('../src/generated/prisma');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs').promises;
const path = require('path');

const prisma = new PrismaClient();

// Migration function kept for future use if needed
async function migrateAccountDatabase(dbPath) {
  console.log(`🔧 Migrating account database: ${dbPath}`);
  
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        reject(err);
        return;
      }
      
      // Add new columns if they don't exist
      const migrations = [
        `ALTER TABLE emails ADD COLUMN contentType TEXT DEFAULT 'PLAIN'`,
        `ALTER TABLE emails ADD COLUMN attachmentsPath TEXT`,
        `ALTER TABLE emails ADD COLUMN hasAttachments BOOLEAN DEFAULT FALSE`,
        `CREATE INDEX IF NOT EXISTS idx_emails_has_attachments ON emails(hasAttachments)`,
        `CREATE INDEX IF NOT EXISTS idx_emails_content_type ON emails(contentType)`
      ];
      
      let completed = 0;
      const total = migrations.length;
      
      migrations.forEach((sql, index) => {
        db.run(sql, (err) => {
          if (err && !err.message.includes('duplicate column name')) {
            console.warn(`⚠️ Migration ${index + 1} warning: ${err.message}`);
          } else {
            console.log(`✅ Migration ${index + 1}/${total} completed`);
          }
          
          completed++;
          if (completed === total) {
            // Update content types based on existing data
            db.run(`
              UPDATE emails 
              SET contentType = CASE 
                WHEN bodyHtml IS NOT NULL AND trim(bodyHtml) != '' THEN 'HTML'
                ELSE 'PLAIN'
              END
              WHERE contentType = 'PLAIN'
            `, (err) => {
              if (err) {
                console.warn(`⚠️ Content type update warning: ${err.message}`);
              } else {
                console.log(`✅ Updated content types based on existing data`);
              }
              
              db.close((err) => {
                if (err) reject(err);
                else resolve();
              });
            });
          }
        });
      });
    });
  });
}

async function migrateAllAccountDatabases() {
  console.log('🚀 Checking for account database migrations...');
  console.log('═'.repeat(50));
  
  try {
    // Get all IMAP accounts
    const accounts = await prisma.imapAccount.findMany();
    
    if (accounts.length === 0) {
      console.log('📭 No IMAP accounts found');
      console.log('ℹ️  New account databases will be created with the latest schema');
      return;
    }
    
    console.log(`📧 Found ${accounts.length} account database(s):`);
    accounts.forEach((account, index) => {
      console.log(`   ${index + 1}. ${account.email} -> ${account.dbPath}`);
    });
    
    // Since the application is not live yet, new account databases 
    // are created with the final schema structure directly.
    // Migration is only needed for existing databases from pre-release versions.
    console.log('');
    console.log('ℹ️  Account databases are created with the latest schema.');
    console.log('ℹ️  Migration is only needed for pre-existing databases from development.');
    console.log('ℹ️  To force migration of existing databases, run:');
    console.log('   node scripts/migrate-account-databases.js --force');
    
    // Check if --force flag is provided
    const forceFlag = process.argv.includes('--force');
    if (!forceFlag) {
      console.log('✅ Skipping migration - new databases use latest schema');
      return;
    }
    
    console.log('🔧 Force migration requested...');
    console.log('');
    
    // Migrate each account database
    for (const account of accounts) {
      try {
        const absolutePath = path.resolve(process.cwd(), account.dbPath);
        
        // Check if database file exists
        try {
          await fs.access(absolutePath);
        } catch (error) {
          console.log(`⚠️ Database file not found: ${absolutePath}, skipping...`);
          continue;
        }
        
        await migrateAccountDatabase(absolutePath);
        console.log(`✅ Migration completed for ${account.email}\n`);
        
      } catch (error) {
        console.error(`❌ Migration failed for ${account.email}:`, error.message);
      }
    }
    
    console.log('🎉 Account database migration completed!');
    
  } catch (error) {
    console.error('💥 Migration process failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Only run if this script is executed directly
if (require.main === module) {
  migrateAllAccountDatabases()
    .then(() => {
      console.log('\n✅ Migration check completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Migration failed:', error);
      process.exit(1);
    });
}

module.exports = { migrateAllAccountDatabases, migrateAccountDatabase }; 