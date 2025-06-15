import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { PrismaClient } from '@/generated/prisma';
import { promises as fs } from 'fs';
import path from 'path';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ emailId: string; filename: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const { emailId, filename } = await params;

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
          SELECT attachmentsPath, hasAttachments 
          FROM emails 
          WHERE id = ? AND hasAttachments = 1
        `;

        const emailResult = await accountPrisma.$queryRawUnsafe<any[]>(emailQuery, emailId);
        
        if (emailResult.length > 0 && emailResult[0].attachmentsPath) {
          emailFound = true;
          attachmentPath = emailResult[0].attachmentsPath;
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
      return NextResponse.json({ message: 'Email or attachment not found' }, { status: 404 });
    }

    // Sanitize filename to prevent path traversal
    const sanitizedFilename = filename.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    const filePath = path.join(attachmentPath, sanitizedFilename);

    // Verify file exists and is within the attachments directory
    try {
      await fs.access(filePath);
      
      // Security check: ensure file is within attachments directory
      const attachmentsBaseDir = process.env.ATTACHMENTS_DIR || './data/attachments';
      const attachmentsDir = path.join(process.cwd(), attachmentsBaseDir);
      const resolvedFilePath = path.resolve(filePath);
      const resolvedAttachmentsDir = path.resolve(attachmentsDir);
      
      if (!resolvedFilePath.startsWith(resolvedAttachmentsDir)) {
        return NextResponse.json({ message: 'Access denied' }, { status: 403 });
      }

      // Read file
      const fileBuffer = await fs.readFile(filePath);
      
      // Determine content type
      const ext = path.extname(sanitizedFilename).toLowerCase();
      const contentTypeMap: { [key: string]: string } = {
        '.pdf': 'application/pdf',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.txt': 'text/plain',
        '.doc': 'application/msword',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.xls': 'application/vnd.ms-excel',
        '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        '.zip': 'application/zip',
      };
      
      const contentType = contentTypeMap[ext] || 'application/octet-stream';

      // Return file with appropriate headers
      return new NextResponse(fileBuffer, {
        headers: {
          'Content-Type': contentType,
          'Content-Disposition': `attachment; filename="${sanitizedFilename}"`,
          'Content-Length': fileBuffer.length.toString(),
        },
      });

    } catch (error) {
      console.error('Error reading attachment file:', error);
      return NextResponse.json({ message: 'File not found' }, { status: 404 });
    }

  } catch (error) {
    console.error('Error downloading attachment:', error);
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
} 