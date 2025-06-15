import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { PrismaClient } from '@/generated/prisma';
import { promises as fs } from 'fs';
import path from 'path';

interface AttachmentInfo {
  filename: string;
  originalName: string;
  size: number;
  contentType: string;
  downloadUrl: string;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ emailId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const { emailId } = await params;

    // Get user's IMAP accounts
    const userAccounts = await prisma.imapAccount.findMany({
      where: {
        userId: session.user.id,
        isActive: true,
      },
    });

    if (userAccounts.length === 0) {
      return NextResponse.json({ message: 'No active email accounts found' }, { status: 404 });
    }

    // Search for the email in all account databases
    let emailFound = false;
    let attachmentPath: string | null = null;
    let attachmentsMetadata: any[] = [];

    for (const account of userAccounts) {
      try {
        const absoluteDbPath = account.dbPath.startsWith('/') 
          ? account.dbPath 
          : path.resolve(process.cwd(), account.dbPath);

        const accountPrisma = new PrismaClient({
          datasources: {
            db: {
              url: `file:${absoluteDbPath}`,
            },
          },
        });

        // Find the email with attachments
        const emailQuery = `
          SELECT attachmentsPath, hasAttachments, attachments 
          FROM emails 
          WHERE id = ? AND hasAttachments = 1
        `;

        const emailResult = await accountPrisma.$queryRawUnsafe<any[]>(emailQuery, emailId);
        
        if (emailResult.length > 0 && emailResult[0].attachmentsPath) {
          emailFound = true;
          attachmentPath = emailResult[0].attachmentsPath;
          
          // Parse attachments metadata from database
          try {
            attachmentsMetadata = JSON.parse(emailResult[0].attachments || '[]');
          } catch (error) {
            console.error('Error parsing attachments metadata:', error);
            attachmentsMetadata = [];
          }
          
          await accountPrisma.$disconnect();
          break;
        }

        await accountPrisma.$disconnect();
      } catch (error) {
        console.error(`Error searching in account ${account.email}:`, error);
        continue;
      }
    }

    if (!emailFound || !attachmentPath) {
      return NextResponse.json({ message: 'Email or attachments not found' }, { status: 404 });
    }

    // Read actual files from filesystem and combine with metadata
    const attachments: AttachmentInfo[] = [];

    try {
      const files = await fs.readdir(attachmentPath);
      
      for (const file of files) {
        const filePath = path.join(attachmentPath, file);
        const stats = await fs.stat(filePath);
        
        if (stats.isFile()) {
          // Find metadata for this file
          const metadata = attachmentsMetadata.find(att => 
            att.filename === file || att.savedName === file
          );
          
          const attachment: AttachmentInfo = {
            filename: file,
            originalName: metadata?.originalName || metadata?.filename || file,
            size: metadata?.size || stats.size,
            contentType: metadata?.contentType || 'application/octet-stream',
            downloadUrl: `/api/attachments/${emailId}/${encodeURIComponent(file)}`
          };
          
          attachments.push(attachment);
        }
      }
    } catch (error) {
      console.error('Error reading attachments directory:', error);
      return NextResponse.json({ message: 'Error reading attachments' }, { status: 500 });
    }

    return NextResponse.json({ 
      emailId,
      attachments,
      totalCount: attachments.length 
    });

  } catch (error) {
    console.error('Error fetching attachments:', error);
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
} 