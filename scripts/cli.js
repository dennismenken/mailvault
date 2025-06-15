#!/usr/bin/env node

const { PrismaClient } = require('../src/generated/prisma');
const bcrypt = require('bcryptjs');
const fs = require('fs').promises;
const path = require('path');
const readline = require('readline');

const prisma = new PrismaClient();

// Create readline interface for prompts
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function prompt(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}

async function createInitialUser(email, password, name) {
  try {
    // Validate inputs
    if (!email || !password) {
      console.error('❌ Email and password are required');
      process.exit(1);
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      console.error('❌ Invalid email format');
      process.exit(1);
    }

    // Check if any users already exist
    const existingUsers = await prisma.user.count();
    
    if (existingUsers > 0) {
      console.error('❌ Initial user already exists. Use the web interface to manage users.');
      console.log('💡 To reset all data, use: npm run cli reset');
      process.exit(1);
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    
    const user = await prisma.user.create({
      data: {
        email: email,
        passwordHash: hashedPassword,
        name: name || null,
      },
    });

    console.log('🎉 Initial user created successfully!');
    console.log(`📧 Email: ${user.email}`);
    console.log(`👤 Name: ${user.name || 'Not specified'}`);
    console.log(`🆔 ID: ${user.id}`);
    console.log('');
    console.log('✅ You can now start the application and login:');
    console.log('   npm run dev');
    console.log('');
    console.log('🔗 Then visit: http://localhost:3000');
    
    return user;
  } catch (error) {
    if (error.code === 'P2002') {
      console.error(`❌ A user with email ${email} already exists`);
    } else {
      console.error('❌ Error creating initial user:', error.message);
    }
    throw error;
  }
}

async function showStatus() {
  try {
    const userCount = await prisma.user.count();
    const accountCount = await prisma.imapAccount.count();
    
    console.log('📊 Mail Vault Status:');
    console.log('═'.repeat(30));
    console.log(`👥 Total Users: ${userCount}`);
    console.log(`📧 Total IMAP Accounts: ${accountCount}`);
    
    if (userCount === 0) {
      console.log('');
      console.log('💡 No users found. Create an initial user with:');
      console.log('   npm run create-initial-user <email> <password> [name]');
    } else {
      console.log('');
      console.log('✅ Application is ready. Start with:');
      console.log('   npm run dev');
    }

    // Show individual account database files
    const dataDir = process.env.DATA_DIR || './data';
    try {
      const files = await fs.readdir(dataDir);
      const dbFiles = files.filter(file => file.endsWith('.db'));
      if (dbFiles.length > 0) {
        console.log('');
        console.log('📁 Account Databases:');
        dbFiles.forEach(file => {
          console.log(`   • ${file}`);
        });
      }
    } catch (error) {
      // Data directory doesn't exist yet, that's fine
    }
  } catch (error) {
    console.error('❌ Error getting status:', error.message);
    throw error;
  }
}

async function resetAllData() {
  try {
    console.log('🚨 DANGER: This will delete ALL data!');
    console.log('');
    console.log('This will remove:');
    console.log('• All users');
    console.log('• All IMAP accounts');
    console.log('• All email databases');
    console.log('• All synced emails');
    console.log('');
    
    const answer = await prompt('Are you sure you want to continue? (y/N): ');
    
    if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
      console.log('❌ Reset cancelled');
      return;
    }

    console.log('');
    console.log('🔄 Starting reset process...');

    // Get all IMAP accounts to delete their database files
    const accounts = await prisma.imapAccount.findMany();
    
    // Delete all IMAP accounts (this will cascade delete due to foreign key)
    console.log('🗑️  Deleting IMAP accounts...');
    await prisma.imapAccount.deleteMany();
    
    // Delete all users
    console.log('🗑️  Deleting users...');
    await prisma.user.deleteMany();

    // Delete account database files
    console.log('🗑️  Deleting account databases...');
    for (const account of accounts) {
      try {
        await fs.unlink(account.dbPath);
        console.log(`   ✅ Deleted: ${path.basename(account.dbPath)}`);
      } catch (error) {
        console.log(`   ⚠️ Could not delete: ${path.basename(account.dbPath)} (${error.message})`);
      }
    }

    // Clean up data directory if it's empty
    const dataDir = process.env.DATA_DIR || './data';
    try {
      const files = await fs.readdir(dataDir);
      if (files.length === 0) {
        await fs.rmdir(dataDir);
        console.log('🗑️  Removed empty data directory');
      }
    } catch (error) {
      // Directory doesn't exist or not empty, that's fine
    }

    console.log('');
    console.log('✅ Reset completed successfully!');
    console.log('');
    console.log('💡 You can now create a new initial user:');
    console.log('   npm run create-initial-user <email> <password> [name]');

  } catch (error) {
    console.error('❌ Error during reset:', error.message);
    throw error;
  }
}

async function main() {
  try {
    const args = process.argv.slice(2);
    const command = args[0];

    switch (command) {
      case 'create-initial-user': {
        const email = args[1];
        const password = args[2];
        const name = args[3];
        
        if (!email || !password) {
          console.error('❌ Email and password are required');
          console.log('');
          console.log('Usage: npm run create-initial-user <email> <password> [name]');
          console.log('');
          console.log('Examples:');
          console.log('  npm run create-initial-user admin@example.com securepass123');
          console.log('  npm run create-initial-user admin@example.com securepass123 "Admin User"');
          process.exit(1);
        }

        await createInitialUser(email, password, name);
        break;
      }

      case 'status':
        await showStatus();
        break;

      case 'reset': {
        await resetAllData();
        break;
      }

      default:
        console.log('🏗️  Mail Vault CLI - Initial Setup');
        console.log('═'.repeat(40));
        console.log('');
        console.log('📋 Available commands:');
        console.log('  create-initial-user <email> <password> [name]   Create the first user');
        console.log('  status                                           Show application status');
        console.log('  reset                                            Reset all data (DANGER!)');
        console.log('');
        console.log('💡 After creating the initial user, use the web interface for:');
        console.log('   • Managing users');
        console.log('   • Adding IMAP accounts');
        console.log('   • Searching emails');
        console.log('');
        console.log('📝 Examples:');
        console.log('   npm run create-initial-user admin@example.com securepass123');
        console.log('   npm run create-initial-user admin@example.com securepass123 "Admin User"');
        console.log('');
        console.log('🚀 Quick start:');
        console.log('   1. npm run create-initial-user admin@example.com mypassword "Admin"');
        console.log('   2. npm run dev');
        console.log('   3. Visit http://localhost:3000');
    }
  } catch (error) {
    console.error('❌ Command failed:', error.message);
    process.exit(1);
  } finally {
    rl.close();
    await prisma.$disconnect();
  }
}

// Only run main if this script is executed directly
if (require.main === module) {
  main().catch((error) => {
    console.error('❌ Unexpected error:', error);
    rl.close();
    process.exit(1);
  });
} 