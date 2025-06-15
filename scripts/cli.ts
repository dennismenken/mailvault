#!/usr/bin/env ts-node

const { PrismaClient } = require('../src/generated/prisma');
const bcrypt = require('bcryptjs');
const fs = require('fs').promises;

const prisma = new PrismaClient();

interface UserData {
  email: string;
  password: string;
  name?: string;
}

async function createInitialUser(userData: UserData) {
  try {
    // Check if any users already exist
    const existingUsers = await prisma.user.count();
    
    if (existingUsers > 0) {
      console.error('❌ Initial user already exists. Use the web interface to manage users.');
      process.exit(1);
    }

    const hashedPassword = await bcrypt.hash(userData.password, 12);
    
    const user = await prisma.user.create({
      data: {
        email: userData.email,
        passwordHash: hashedPassword,
        name: userData.name,
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
  } catch (error: any) {
    if (error.code === 'P2002') {
      console.error(`❌ A user with email ${userData.email} already exists`);
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
      console.log('   npm run create-initial-user <path-to-user-data.json>');
    } else {
      console.log('');
      console.log('✅ Application is ready. Start with:');
      console.log('   npm run dev');
    }
  } catch (error: any) {
    console.error('❌ Error getting status:', error.message);
    throw error;
  }
}

async function main() {
  try {
    const args = process.argv.slice(2);
    const command = args[0];

    switch (command) {
      case 'create-initial-user': {
        const userDataPath = args[1];
        if (!userDataPath) {
          console.error('❌ Please provide path to user data JSON file');
          console.log('');
          console.log('Usage: npm run create-initial-user <path-to-user-data.json>');
          console.log('');
          console.log('Example user-data.json:');
          console.log('  {"email": "admin@example.com", "password": "securepassword", "name": "Admin User"}');
          process.exit(1);
        }

        const userData: UserData = JSON.parse(await fs.readFile(userDataPath, 'utf-8'));
        await createInitialUser(userData);
        break;
      }

      case 'status':
        await showStatus();
        break;

      default:
        console.log('🏗️  Mail Vault CLI - Initial Setup');
        console.log('═'.repeat(40));
        console.log('');
        console.log('📋 Available commands:');
        console.log('  create-initial-user <path-to-user-data.json>   Create the first user');
        console.log('  status                                         Show application status');
        console.log('');
        console.log('💡 After creating the initial user, use the web interface for:');
        console.log('   • Managing users');
        console.log('   • Adding IMAP accounts');
        console.log('   • Searching emails');
        console.log('');
        console.log('📝 Example user-data.json:');
        console.log('   {"email": "admin@example.com", "password": "securepassword", "name": "Admin User"}');
        console.log('');
        console.log('🚀 Quick start:');
        console.log('   1. npm run create-initial-user user-data.json');
        console.log('   2. npm run dev');
        console.log('   3. Visit http://localhost:3000');
    }
  } catch (error: any) {
    console.error('❌ Command failed:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Only run main if this script is executed directly
if (require.main === module) {
  console.log('CLI starting...');
  main().catch((error) => {
    console.error('❌ Unexpected error:', error);
    process.exit(1);
  });
} 