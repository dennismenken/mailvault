import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { promises as fs } from 'fs';
import path from 'path';

// GET /api/imap-accounts - List user's IMAP accounts
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const accounts = await prisma.imapAccount.findMany({
      where: {
        userId: session.user.id,
      },
      select: {
        id: true,
        email: true,
        imapServer: true,
        imapPort: true,
        useTls: true,
        isActive: true,
        syncEnabled: true,
        lastSyncAt: true,
        errorMessage: true,
        errorCount: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return NextResponse.json({ accounts });
  } catch (error) {
    console.error('Error fetching IMAP accounts:', error);
    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST /api/imap-accounts - Create new IMAP account
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const { 
      email, 
      imapServer, 
      imapPort = 993, 
      imapUsername, 
      imapPassword, 
      useTls = true 
    } = await request.json();

    if (!email || !imapServer || !imapUsername || !imapPassword) {
      return NextResponse.json(
        { message: 'Email, IMAP server, username, and password are required' },
        { status: 400 }
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { message: 'Invalid email format' },
        { status: 400 }
      );
    }

    // Check if account already exists for this user
    const existingAccount = await prisma.imapAccount.findFirst({
      where: {
        userId: session.user.id,
        email: email,
      },
    });

    if (existingAccount) {
      return NextResponse.json(
        { message: 'IMAP account with this email already exists for your user' },
        { status: 409 }
      );
    }

    // Create data directory if it doesn't exist
    const dataDir = process.env.DATA_DIR || './data';
    await fs.mkdir(dataDir, { recursive: true });
    
    // Create unique database path for this account
    const sanitizedEmail = email.replace(/[^a-zA-Z0-9@.-]/g, '_');
    const timestamp = Date.now();
    const dbPath = path.join(dataDir, `${sanitizedEmail}_${timestamp}.db`);

    // Create IMAP account
    const account = await prisma.imapAccount.create({
      data: {
        userId: session.user.id,
        email,
        imapServer,
        imapPort: parseInt(imapPort.toString()),
        imapUsername,
        imapPassword,
        useTls,
        dbPath,
      },
      select: {
        id: true,
        email: true,
        imapServer: true,
        imapPort: true,
        useTls: true,
        isActive: true,
        syncEnabled: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ 
      message: 'IMAP account created successfully',
      account 
    }, { status: 201 });

  } catch (error) {
    console.error('Error creating IMAP account:', error);
    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 }
    );
  }
} 