#!/usr/bin/env node

const { PrismaClient } = require('../src/generated/prisma');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs').promises;
const path = require('path');

const prisma = new PrismaClient();

// Define all migrations in order
const MIGRATIONS = [
  {
    id: '001_add_content_type',
    description: 'Add contentType and attachment fields',
    statements: [
      `ALTER TABLE emails ADD COLUMN contentType TEXT DEFAULT 'PLAIN'`,
      `ALTER TABLE emails ADD COLUMN attachmentsPath TEXT`,
      `ALTER TABLE emails ADD COLUMN hasAttachments BOOLEAN DEFAULT FALSE`,
      `CREATE INDEX IF NOT EXISTS idx_emails_has_attachments ON emails(hasAttachments)`,
      `CREATE INDEX IF NOT EXISTS idx_emails_content_type ON emails(contentType)`,
      // Update content types based on existing data
      `UPDATE emails 
       SET contentType = CASE 
         WHEN bodyHtml IS NOT NULL AND trim(bodyHtml) != '' THEN 'HTML'
         ELSE 'PLAIN'
       END
       WHERE contentType = 'PLAIN'`
    ]
  },
  {
    id: '002_add_uid_sync_state',
    description: 'Add UID column and sync_state table for efficient IMAP sync',
    statements: [
      `ALTER TABLE emails ADD COLUMN uid INTEGER`,
      `CREATE INDEX IF NOT EXISTS idx_emails_folder_uid ON emails(folder, uid)`,
      `CREATE TABLE IF NOT EXISTS sync_state (
        id TEXT PRIMARY KEY,
        folder TEXT UNIQUE NOT NULL,
        uidValidity INTEGER,
        highestUid INTEGER NOT NULL DEFAULT 0,
        lastSyncAt DATETIME,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )`
    ]
  }
];

async function setupMigrationTracking(db) {
  return new Promise((resolve, reject) => {
    db.run(`
      CREATE TABLE IF NOT EXISTS migrations_applied (
        id TEXT PRIMARY KEY,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function getMigrationsApplied(db) {
  return new Promise((resolve, reject) => {
    db.all('SELECT id FROM migrations_applied', (err, rows) => {
      if (err) {
        if (err.message.includes('no such table')) {
          resolve([]);
        } else {
          reject(err);
        }
      } else {
        resolve(rows.map(r => r.id));
      }
    });
  });
}

async function markMigrationApplied(db, migrationId) {
  return new Promise((resolve, reject) => {
    db.run('INSERT INTO migrations_applied (id) VALUES (?)', [migrationId], (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function runMigration(db, migration) {
  console.log(`\n📋 Running migration: ${migration.id} - ${migration.description}`);
  
  for (let i = 0; i < migration.statements.length; i++) {
    const statement = migration.statements[i];
    await new Promise((resolve, reject) => {
      db.run(statement, (err) => {
        if (err && !err.message.includes('duplicate column name') && !err.message.includes('already exists')) {
          console.error(`❌ Statement ${i + 1}/${migration.statements.length} failed:`, err.message);
          reject(err);
        } else {
          console.log(`✅ Statement ${i + 1}/${migration.statements.length} completed`);
          resolve();
        }
      });
    });
  }
  
  await markMigrationApplied(db, migration.id);
  console.log(`✅ Migration ${migration.id} completed successfully`);
}

async function migrateAccountDatabase(dbPath) {
  console.log(`\n🔧 Migrating account database: ${dbPath}`);
  
  return new Promise(async (resolve, reject) => {
    const db = new sqlite3.Database(dbPath, async (err) => {
      if (err) {
        reject(err);
        return;
      }
      
      try {
        // Setup migration tracking
        await setupMigrationTracking(db);
        
        // Get list of applied migrations
        const appliedMigrations = await getMigrationsApplied(db);
        
        // Find migrations to apply
        const migrationsToApply = MIGRATIONS.filter(m => !appliedMigrations.includes(m.id));
        
        let result = { migrationsApplied: 0 };
        
        if (migrationsToApply.length === 0) {
          console.log(`✅ Database is up to date (${appliedMigrations.length} migrations already applied)`);
        } else {
          console.log(`📊 Found ${migrationsToApply.length} migrations to apply`);
          
          // Apply each migration in order
          for (const migration of migrationsToApply) {
            await runMigration(db, migration);
            result.migrationsApplied++;
          }
        }
        
        db.close((err) => {
          if (err) reject(err);
          else resolve(result);
        });
      } catch (error) {
        db.close();
        reject(error);
      }
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
    
    console.log('');
    console.log('🔍 Checking each database for pending migrations...');
    
    // Migrate each account database
    let migratedCount = 0;
    let upToDateCount = 0;
    
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
        
        const result = await migrateAccountDatabase(absolutePath);
        if (result && result.migrationsApplied > 0) {
          migratedCount++;
        } else {
          upToDateCount++;
        }
        
      } catch (error) {
        console.error(`❌ Migration failed for ${account.email}:`, error.message);
      }
    }
    
    console.log('');
    console.log('📊 Migration Summary:');
    console.log(`   • Databases migrated: ${migratedCount}`);
    console.log(`   • Already up to date: ${upToDateCount}`);
    console.log('');
    console.log('🎉 Account database migration check completed!');
    
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