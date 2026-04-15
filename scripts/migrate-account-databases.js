#!/usr/bin/env node

const { createMainPrismaClient } = require('../src/lib/prisma-factory');
const Database = require('better-sqlite3');
const fs = require('fs').promises;
const path = require('path');

const prisma = createMainPrismaClient();

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
  },
  {
    id: '003_add_cc_bcc_flags',
    description: 'Ensure ccAddresses, bccAddresses and flags columns exist (required by UPSERT in imap-sync)',
    statements: [
      `ALTER TABLE emails ADD COLUMN ccAddresses TEXT`,
      `ALTER TABLE emails ADD COLUMN bccAddresses TEXT`,
      `ALTER TABLE emails ADD COLUMN flags TEXT`
    ]
  }
];

function setupMigrationTracking(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations_applied (
      id TEXT PRIMARY KEY,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

function getMigrationsApplied(db) {
  try {
    const rows = db.prepare('SELECT id FROM migrations_applied').all();
    return rows.map(r => r.id);
  } catch (err) {
    if (err && err.message && err.message.includes('no such table')) {
      return [];
    }
    throw err;
  }
}

function markMigrationApplied(db, migrationId) {
  db.prepare('INSERT INTO migrations_applied (id) VALUES (?)').run(migrationId);
}

function runMigration(db, migration) {
  console.log(`\n[migrate] Running migration: ${migration.id} - ${migration.description}`);

  for (let i = 0; i < migration.statements.length; i++) {
    const statement = migration.statements[i];
    try {
      db.exec(statement);
      console.log(`[migrate] Statement ${i + 1}/${migration.statements.length} completed`);
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      if (msg.includes('duplicate column name') || msg.includes('already exists')) {
        console.log(`[migrate] Statement ${i + 1}/${migration.statements.length} skipped (already applied): ${msg}`);
        continue;
      }
      console.error(`[migrate] Statement ${i + 1}/${migration.statements.length} failed:`, msg);
      throw err;
    }
  }

  markMigrationApplied(db, migration.id);
  console.log(`[migrate] Migration ${migration.id} completed successfully`);
}

async function migrateAccountDatabase(dbPath) {
  console.log(`\n[migrate] Migrating account database: ${dbPath}`);

  let db;
  try {
    db = new Database(dbPath);
  } catch (err) {
    throw err;
  }

  try {
    setupMigrationTracking(db);

    const appliedMigrations = getMigrationsApplied(db);
    const migrationsToApply = MIGRATIONS.filter(m => !appliedMigrations.includes(m.id));

    const result = { migrationsApplied: 0 };

    if (migrationsToApply.length === 0) {
      console.log(`[migrate] Database is up to date (${appliedMigrations.length} migrations already applied)`);
    } else {
      console.log(`[migrate] Found ${migrationsToApply.length} migrations to apply`);

      for (const migration of migrationsToApply) {
        runMigration(db, migration);
        result.migrationsApplied++;
      }
    }

    return result;
  } finally {
    try {
      db.close();
    } catch (closeErr) {
      console.error('[migrate] Error closing database:', closeErr.message);
    }
  }
}

async function migrateAllAccountDatabases() {
  console.log('[migrate] Checking for account database migrations...');
  console.log('='.repeat(50));

  try {
    // Get all IMAP accounts
    const accounts = await prisma.imapAccount.findMany();

    if (accounts.length === 0) {
      console.log('[migrate] No IMAP accounts found');
      console.log('[migrate] New account databases will be created with the latest schema');
      return;
    }

    console.log(`[migrate] Found ${accounts.length} account database(s):`);
    accounts.forEach((account, index) => {
      console.log(`   ${index + 1}. ${account.email} -> ${account.dbPath}`);
    });

    console.log('');
    console.log('[migrate] Checking each database for pending migrations...');

    let migratedCount = 0;
    let upToDateCount = 0;

    for (const account of accounts) {
      try {
        const absolutePath = path.resolve(process.cwd(), account.dbPath);

        try {
          await fs.access(absolutePath);
        } catch {
          console.log(`[migrate] Database file not found: ${absolutePath}, skipping...`);
          continue;
        }

        const result = await migrateAccountDatabase(absolutePath);
        if (result && result.migrationsApplied > 0) {
          migratedCount++;
        } else {
          upToDateCount++;
        }

      } catch (error) {
        console.error(`[migrate] Migration failed for ${account.email}:`, error.message);
      }
    }

    console.log('');
    console.log('[migrate] Migration Summary:');
    console.log(`   - Databases migrated: ${migratedCount}`);
    console.log(`   - Already up to date: ${upToDateCount}`);
    console.log('');
    console.log('[migrate] Account database migration check completed!');

  } catch (error) {
    console.error('[migrate] Migration process failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Only run if this script is executed directly
if (require.main === module) {
  migrateAllAccountDatabases()
    .then(() => {
      console.log('\n[migrate] Migration check completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n[migrate] Migration failed:', error);
      process.exit(1);
    });
}

module.exports = { migrateAllAccountDatabases, migrateAccountDatabase };
