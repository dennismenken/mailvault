import Imap from 'imap';
import { simpleParser } from 'mailparser';
import { PrismaClient } from '../generated/prisma';
import path from 'path';
import { promises as fs } from 'fs';

interface EmailData {
  messageId: string;
  subject?: string;
  fromAddress?: string;
  fromName?: string;
  toAddresses?: string[];
  ccAddresses?: string[];
  bccAddresses?: string[];
  bodyText?: string;
  bodyHtml?: string;
  contentType: 'HTML' | 'PLAIN';
  date?: Date;
  folder: string;
  flags?: string[];
  size?: number;
  attachments?: any[];
  attachmentsPath?: string;
  hasAttachments: boolean;
}

export class ImapSyncService {
  private imap: Imap;
  private accountPrisma: PrismaClient;
  private accountId: string;
  private maxErrors = parseInt(process.env.MAX_SYNC_ERRORS || '5');

  constructor(config: {
    host: string;
    port: number;
    user: string;
    password: string;
    tls: boolean;
    accountId: string;
    dbPath: string;
  }) {
    this.accountId = config.accountId;
    
    this.imap = new Imap({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      tls: config.tls,
      tlsOptions: { rejectUnauthorized: false },
      keepalive: true,
      connTimeout: 30000,
      authTimeout: 5000,
    });

    // Create separate Prisma instance for this account's database
    this.accountPrisma = new PrismaClient({
      datasources: {
        db: {
          url: `file:${config.dbPath}`,
        },
      },
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers() {
    this.imap.once('ready', () => {
      console.log(`📧 IMAP connection ready for account ${this.accountId}`);
    });

    this.imap.once('error', (err: Error) => {
      console.error(`❌ IMAP connection error for account ${this.accountId}:`, err.message);
    });

    this.imap.once('end', () => {
      console.log(`📧 Connection ended for account ${this.accountId}`);
    });
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.imap.once('ready', resolve);
      this.imap.once('error', reject);
      this.imap.connect();
    });
  }

  async disconnect(): Promise<void> {
    if (this.imap.state === 'authenticated') {
      this.imap.end();
    }
    await this.accountPrisma.$disconnect();
  }

  async initializeAccountDatabase(): Promise<void> {
    try {
      // Initialize database schema for this account
      await this.accountPrisma.$executeRaw`
        CREATE TABLE IF NOT EXISTS emails (
          id TEXT PRIMARY KEY,
          messageId TEXT UNIQUE NOT NULL,
          subject TEXT,
          fromAddress TEXT,
          fromName TEXT,
          toAddresses TEXT,
          ccAddresses TEXT,
          bccAddresses TEXT,
          bodyText TEXT,
          bodyHtml TEXT,
          contentType TEXT DEFAULT 'PLAIN',
          folder TEXT NOT NULL,
          flags TEXT,
          date DATETIME,
          size INTEGER,
          attachments TEXT,
          attachmentsPath TEXT,
          hasAttachments BOOLEAN DEFAULT FALSE,
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
          updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `;

      await this.accountPrisma.$executeRaw`
        CREATE INDEX IF NOT EXISTS idx_emails_folder ON emails(folder)
      `;
      
      await this.accountPrisma.$executeRaw`
        CREATE INDEX IF NOT EXISTS idx_emails_date ON emails(date)
      `;
      
      await this.accountPrisma.$executeRaw`
        CREATE INDEX IF NOT EXISTS idx_emails_from ON emails(fromAddress)
      `;
      
      await this.accountPrisma.$executeRaw`
        CREATE INDEX IF NOT EXISTS idx_emails_subject ON emails(subject)
      `;
      
      await this.accountPrisma.$executeRaw`
        CREATE INDEX IF NOT EXISTS idx_emails_has_attachments ON emails(hasAttachments)
      `;
      
      await this.accountPrisma.$executeRaw`
        CREATE INDEX IF NOT EXISTS idx_emails_content_type ON emails(contentType)
      `;

      console.log(`✅ Account database initialized for ${this.accountId}`);
    } catch (error) {
      console.error(`❌ Failed to initialize account database for ${this.accountId}:`, error);
      throw error;
    }
  }

  async getFolders(): Promise<string[]> {
    return new Promise((resolve, reject) => {
      this.imap.getBoxes((err, boxes) => {
        if (err) reject(err);
        else {
          const folders = this.extractFolderNames(boxes);
          resolve(folders);
        }
      });
    });
  }

  private extractFolderNames(boxes: any, prefix = ''): string[] {
    let folders: string[] = [];
    
    for (const [name, box] of Object.entries(boxes)) {
      const boxData = box as any; // Type assertion to handle unknown type
      const fullName = prefix ? `${prefix}${boxData.delimiter || '/'}${name}` : name;
      folders.push(fullName);
      
      if (boxData.children) {
        folders = folders.concat(this.extractFolderNames(boxData.children, fullName));
      }
    }
    
    return folders;
  }

  async syncFolder(folderName: string): Promise<number> {
    return new Promise((resolve, reject) => {
      this.imap.openBox(folderName, true, async (err, box) => {
        if (err) {
          reject(err);
          return;
        }

        try {
          const totalMessages = box.messages.total;
          if (totalMessages === 0) {
            console.log(`📁 Folder ${folderName} is empty`);
            resolve(0);
            return;
          }

          console.log(`📁 Syncing folder ${folderName} with ${totalMessages} messages`);

          // Get existing message IDs to avoid duplicates
          const existingMessages = await this.getExistingMessageIds(folderName);
          let newMessageCount = 0;

          const fetch = this.imap.seq.fetch('1:*', {
            bodies: 'HEADER.FIELDS (MESSAGE-ID)',
            struct: true,
          });

          const messagesToFetch: number[] = [];
          
          fetch.on('message', (msg, seqno) => {
            msg.on('body', (stream, info) => {
              let buffer = '';
              stream.on('data', (chunk) => {
                buffer += chunk.toString('ascii');
              });
              
              stream.once('end', () => {
                const messageId = this.extractMessageId(buffer);
                if (messageId && !existingMessages.has(messageId)) {
                  messagesToFetch.push(seqno);
                }
              });
            });
          });

          fetch.once('end', async () => {
            if (messagesToFetch.length === 0) {
              console.log(`📁 No new messages in folder ${folderName}`);
              resolve(0);
              return;
            }

            console.log(`📥 Fetching ${messagesToFetch.length} new messages from ${folderName}`);

            // Fetch full messages in batches
            const batchSize = 50;
            for (let i = 0; i < messagesToFetch.length; i += batchSize) {
              const batch = messagesToFetch.slice(i, i + batchSize);
              const count = await this.fetchMessageBatch(batch, folderName);
              newMessageCount += count;
              
              // Small delay to prevent overwhelming the server
              await new Promise(resolve => setTimeout(resolve, 100));
            }

            resolve(newMessageCount);
          });

          fetch.once('error', reject);
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  private async getExistingMessageIds(folder: string): Promise<Set<string>> {
    try {
      const emails = await this.accountPrisma.$queryRaw<Array<{ messageId: string }>>`
        SELECT messageId FROM emails WHERE folder = ${folder}
      `;
      return new Set(emails.map(e => e.messageId));
    } catch (error) {
      console.warn(`⚠️ Could not get existing message IDs for folder ${folder}:`, error);
      return new Set();
    }
  }

  private extractMessageId(header: string): string | null {
    const match = header.match(/Message-ID:\s*<([^>]+)>/i);
    return match ? match[1] : null;
  }

  private async fetchMessageBatch(seqnos: number[], folderName: string): Promise<number> {
    return new Promise((resolve, reject) => {
      let processedCount = 0;
      const seqnoRange = seqnos.join(',');
      
      const fetch = this.imap.seq.fetch(seqnoRange, {
        bodies: '',
        struct: true,
      });

      fetch.on('message', (msg, seqno) => {
        let buffer = Buffer.alloc(0);
        let attrs: any;

        msg.on('body', (stream) => {
          stream.on('data', (chunk) => {
            buffer = Buffer.concat([buffer, chunk]);
          });
        });

        msg.once('attributes', (attributes) => {
          attrs = attributes;
        });

        msg.once('end', async () => {
          try {
            const parsed = await simpleParser(buffer);
            const emailData = this.parseEmailData(parsed, folderName, attrs);
            
            await this.saveEmail(emailData);
            processedCount++;
            
            if (processedCount === seqnos.length) {
              resolve(processedCount);
            }
          } catch (error) {
            console.error(`❌ Error processing message ${seqno}:`, error);
            processedCount++;
            
            if (processedCount === seqnos.length) {
              resolve(processedCount);
            }
          }
        });
      });

      fetch.once('error', reject);
    });
  }

  private parseEmailData(parsed: any, folder: string, attrs: any): EmailData {
    const messageId = parsed.messageId || `${Date.now()}-${Math.random()}`;
    const hasAttachments = (parsed.attachments || []).length > 0;
    
    // Determine content type: prefer HTML if available, otherwise PLAIN
    const contentType: 'HTML' | 'PLAIN' = parsed.html && parsed.html.trim() ? 'HTML' : 'PLAIN';
    
    return {
      messageId,
      subject: parsed.subject || '',
      fromAddress: parsed.from?.value?.[0]?.address || '',
      fromName: parsed.from?.value?.[0]?.name || '',
      toAddresses: parsed.to?.value?.map((addr: any) => addr.address) || [],
      ccAddresses: parsed.cc?.value?.map((addr: any) => addr.address) || [],
      bccAddresses: parsed.bcc?.value?.map((addr: any) => addr.address) || [],
      bodyText: parsed.text || '',
      bodyHtml: parsed.html || '',
      contentType,
      date: parsed.date || new Date(),
      folder,
      flags: attrs?.flags || [],
      size: attrs?.size || 0,
      attachments: parsed.attachments?.map((att: any) => ({
        filename: att.filename,
        contentType: att.contentType,
        size: att.size,
      })) || [],
      hasAttachments,
    };
  }

  private async saveEmail(emailData: EmailData): Promise<void> {
    try {
      const cuid = this.generateCuid();
      
             // Save attachments to mountable directory if present
       let attachmentsPath: string | undefined = undefined;
       if (emailData.hasAttachments && emailData.attachments && emailData.attachments.length > 0) {
         attachmentsPath = await this.saveAttachments(emailData.messageId, emailData.attachments);
         emailData.attachmentsPath = attachmentsPath;
       }
      
      await this.accountPrisma.$executeRaw`
        INSERT OR REPLACE INTO emails (
          id, messageId, subject, fromAddress, fromName, toAddresses, ccAddresses, 
          bccAddresses, bodyText, bodyHtml, contentType, folder, flags, date, size, 
          attachments, attachmentsPath, hasAttachments, createdAt, updatedAt
        ) VALUES (
          ${cuid}, ${emailData.messageId}, ${emailData.subject}, ${emailData.fromAddress},
          ${emailData.fromName}, ${JSON.stringify(emailData.toAddresses)}, 
          ${JSON.stringify(emailData.ccAddresses)}, ${JSON.stringify(emailData.bccAddresses)},
          ${emailData.bodyText}, ${emailData.bodyHtml}, ${emailData.contentType}, ${emailData.folder},
          ${JSON.stringify(emailData.flags)}, ${emailData.date}, ${emailData.size},
          ${JSON.stringify(emailData.attachments)}, ${attachmentsPath}, ${emailData.hasAttachments},
          datetime('now'), datetime('now')
        )
      `;
    } catch (error) {
      console.error(`❌ Error saving email ${emailData.messageId}:`, error);
      throw error;
    }
  }

  private async saveAttachments(messageId: string, attachments: any[]): Promise<string> {
    const fs = await import('fs').then(m => m.promises);
    const path = await import('path');
    
    // Create unique directory for this email's attachments
    const attachmentsBaseDir = process.env.ATTACHMENTS_DIR || './data/attachments';
    const attachmentsDir = path.join(process.cwd(), attachmentsBaseDir, this.accountId, messageId);
    await fs.mkdir(attachmentsDir, { recursive: true });
    
    // Save each attachment
    for (const attachment of attachments) {
      if (attachment.content && attachment.filename) {
        const sanitizedFilename = attachment.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
        const filePath = path.join(attachmentsDir, sanitizedFilename);
        await fs.writeFile(filePath, attachment.content);
        console.log(`💾 Saved attachment: ${sanitizedFilename}`);
      }
    }
    
    return attachmentsDir;
  }

  private generateCuid(): string {
    // Simple CUID-like generator
    const timestamp = Date.now().toString(36);
    const randomPart = Math.random().toString(36).substr(2, 9);
    return `c${timestamp}${randomPart}`;
  }

  async fullSync(): Promise<{ totalMessages: number; errors: string[] }> {
    const errors: string[] = [];
    let totalMessages = 0;

    try {
      await this.connect();
      await this.initializeAccountDatabase();
      
      const folders = await this.getFolders();
      console.log(`📁 Found ${folders.length} folders for account ${this.accountId}`);

      for (const folder of folders) {
        try {
          const messageCount = await this.syncFolder(folder);
          totalMessages += messageCount;
          console.log(`✅ Synced ${messageCount} messages from folder ${folder}`);
        } catch (error: any) {
          const errorMsg = `Failed to sync folder ${folder}: ${error.message}`;
          errors.push(errorMsg);
          console.error(`❌ ${errorMsg}`);
        }
      }

    } catch (error: any) {
      errors.push(`Connection error: ${error.message}`);
      console.error(`❌ IMAP sync failed for account ${this.accountId}:`, error.message);
    } finally {
      await this.disconnect();
    }

    return { totalMessages, errors };
  }
} 