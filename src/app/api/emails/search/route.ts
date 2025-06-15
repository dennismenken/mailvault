import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { PrismaClient } from '../../../../generated/prisma';
import path from 'path';

interface SearchParams {
  query?: string;
  folder?: string;
  fromAddress?: string;
  dateFrom?: string;
  dateTo?: string;
  accountId?: string;
  page?: number;
  limit?: number;
}

interface EmailResult {
  id: string;
  messageId: string;
  subject?: string;
  fromAddress?: string;
  fromName?: string;
  toAddresses?: string[];
  date?: string;
  folder: string;
  bodyText?: string;
  bodyHtml?: string;
  contentType?: string;
  hasAttachments?: boolean;
  attachmentsPath?: string;
  accountEmail: string;
  size?: number;
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const params: SearchParams = {
      query: searchParams.get('query') || undefined,
      folder: searchParams.get('folder') || undefined,
      fromAddress: searchParams.get('fromAddress') || undefined,
      dateFrom: searchParams.get('dateFrom') || undefined,
      dateTo: searchParams.get('dateTo') || undefined,
      accountId: searchParams.get('accountId') || undefined,
      page: parseInt(searchParams.get('page') || '1'),
      limit: Math.min(parseInt(searchParams.get('limit') || '50'), 100),
    };

    // Check if this is a request for full content of a specific email
    const fullContentId = searchParams.get('fullContentId');

    // Get user's IMAP accounts
    const userAccounts = await prisma.imapAccount.findMany({
      where: {
        userId: session.user.id,
        isActive: true,
        ...(params.accountId && { id: params.accountId }),
      },
    });

    if (userAccounts.length === 0) {
      return NextResponse.json({ 
        emails: [], 
        totalCount: 0, 
        message: 'No active email accounts found' 
      });
    }

    const allEmails: EmailResult[] = [];
    let totalCount = 0;

    // If requesting full content for a specific email, handle separately
    if (fullContentId) {
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

          const results = await searchInAccountDatabase(accountPrisma, params, account.email, fullContentId);
          if (results.emails.length > 0) {
            await accountPrisma.$disconnect();
            return NextResponse.json({
              emails: results.emails,
              totalCount: 1,
              page: 1,
              limit: 1,
              totalPages: 1,
            });
          }
          await accountPrisma.$disconnect();
        } catch (error) {
          console.error(`Error searching in account ${account.email}:`, error);
        }
      }
      
      return NextResponse.json({
        emails: [],
        totalCount: 0,
        page: 1,
        limit: 1,
        totalPages: 0,
      });
    }

    // For regular search, first get total count across all accounts
    let globalTotalCount = 0;
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

        const count = await getEmailCount(accountPrisma, params);
        globalTotalCount += count;
        await accountPrisma.$disconnect();
      } catch (error) {
        console.error(`Error counting emails in account ${account.email}:`, error);
      }
    }

    // Now get paginated results across all accounts
    // We need to fetch emails from all accounts, sort globally, then paginate
    const allEmailsForSort: EmailResult[] = [];
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

        // Get ALL matching emails for proper sorting (without pagination at DB level)
        const results = await searchInAccountDatabase(accountPrisma, params, account.email, undefined, true);
        allEmailsForSort.push(...results.emails);
        await accountPrisma.$disconnect();
      } catch (error) {
        console.error(`Error searching in account ${account.email}:`, error);
      }
    }

    // Sort by date (most recent first) globally across all accounts
    allEmailsForSort.sort((a, b) => {
      const dateA = new Date(a.date || 0).getTime();
      const dateB = new Date(b.date || 0).getTime();
      return dateB - dateA;
    });

    // Apply pagination after global sorting
    const startIndex = ((params.page || 1) - 1) * (params.limit || 50);
    const endIndex = startIndex + (params.limit || 50);
    const paginatedEmails = allEmailsForSort.slice(startIndex, endIndex);

    return NextResponse.json({
      emails: paginatedEmails,
      totalCount: globalTotalCount,
      page: params.page || 1,
      limit: params.limit || 50,
      totalPages: Math.ceil(globalTotalCount / (params.limit || 50)),
    });

  } catch (error) {
    console.error('Search API error:', error);
    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 }
    );
  }
}

async function getEmailCount(
  accountPrisma: PrismaClient,
  params: SearchParams
): Promise<number> {
  let whereClause = '';
  const whereParams: any[] = [];

  if (params.query) {
    whereClause += ' AND (subject LIKE ? OR bodyText LIKE ? OR fromAddress LIKE ?)';
    const searchTerm = `%${params.query}%`;
    whereParams.push(searchTerm, searchTerm, searchTerm);
  }

  if (params.folder) {
    whereClause += ' AND folder = ?';
    whereParams.push(params.folder);
  }

  if (params.fromAddress) {
    whereClause += ' AND fromAddress LIKE ?';
    whereParams.push(`%${params.fromAddress}%`);
  }

  if (params.dateFrom) {
    whereClause += ' AND date >= ?';
    whereParams.push(new Date(params.dateFrom).toISOString());
  }

  if (params.dateTo) {
    whereClause += ' AND date <= ?';
    whereParams.push(new Date(params.dateTo).toISOString());
  }

  try {
    const countQuery = `
      SELECT COUNT(*) as count
      FROM emails 
      WHERE 1=1 ${whereClause}
    `;

    const result = await accountPrisma.$queryRawUnsafe<{ count: bigint }[]>(countQuery, ...whereParams);
    // Convert BigInt to Number for JavaScript compatibility
    return Number(result[0]?.count || BigInt(0));
  } catch (error) {
    console.error('Database count error:', error);
    return 0;
  }
}

async function searchInAccountDatabase(
  accountPrisma: PrismaClient,
  params: SearchParams,
  accountEmail: string,
  fullContentId?: string,
  getAll?: boolean
): Promise<{ emails: EmailResult[]; count: number }> {
  let whereClause = '';
  const whereParams: any[] = [];

  if (params.query) {
    whereClause += ' AND (subject LIKE ? OR bodyText LIKE ? OR fromAddress LIKE ?)';
    const searchTerm = `%${params.query}%`;
    whereParams.push(searchTerm, searchTerm, searchTerm);
  }

  if (params.folder) {
    whereClause += ' AND folder = ?';
    whereParams.push(params.folder);
  }

  if (params.fromAddress) {
    whereClause += ' AND fromAddress LIKE ?';
    whereParams.push(`%${params.fromAddress}%`);
  }

  if (params.dateFrom) {
    whereClause += ' AND date >= ?';
    whereParams.push(new Date(params.dateFrom).toISOString());
  }

  if (params.dateTo) {
    whereClause += ' AND date <= ?';
    whereParams.push(new Date(params.dateTo).toISOString());
  }

  try {
    // If requesting full content of a specific email, modify the query
    if (fullContentId) {
      whereClause += ' AND id = ?';
      whereParams.push(fullContentId);
    }

    const query = `
      SELECT 
        id, messageId, subject, fromAddress, fromName, toAddresses, 
        date, folder, bodyText, bodyHtml, contentType, hasAttachments, 
        attachmentsPath, size
      FROM emails 
      WHERE 1=1 ${whereClause}
      ORDER BY date DESC
      ${fullContentId ? 'LIMIT 1' : (getAll ? '' : 'LIMIT 1000')}
    `;

    const rawEmails = await accountPrisma.$queryRawUnsafe<any[]>(query, ...whereParams);
    
    const emails: EmailResult[] = rawEmails.map((email: any) => ({
      id: email.id,
      messageId: email.messageId,
      subject: email.subject,
      fromAddress: email.fromAddress,
      fromName: email.fromName,
      toAddresses: email.toAddresses ? JSON.parse(email.toAddresses) : [],
      date: email.date,
      folder: email.folder,
      // Return full content if requesting specific email, otherwise truncate
      bodyText: fullContentId ? email.bodyText : email.bodyText?.substring(0, 500),
      bodyHtml: fullContentId ? email.bodyHtml : email.bodyHtml?.substring(0, 1000),
      contentType: email.contentType || 'PLAIN',
      hasAttachments: email.hasAttachments || false,
      attachmentsPath: email.attachmentsPath,
      accountEmail,
      size: email.size,
    }));

    return { emails, count: emails.length };
  } catch (error) {
    console.error(`Database query error for account ${accountEmail}:`, error);
    return { emails: [], count: 0 };
  }
} 