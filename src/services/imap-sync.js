const Imap = require('imap');
const { simpleParser } = require('mailparser');
const { PrismaClient } = require('../generated/prisma');
const path = require('path');
const fs = require('fs').promises;
const sqlite3 = require('sqlite3').verbose();

class ImapSyncService {
  constructor(config) {
    this.accountId = config.accountId;
    this.dbPath = config.dbPath;
    this.maxErrors = parseInt(process.env.MAX_SYNC_ERRORS || '10');
    this.batchSize = parseInt(process.env.SYNC_BATCH_SIZE || '5'); // Kleinere Batches für Gmail
    this.batchDelay = parseInt(process.env.SYNC_BATCH_DELAY || '1000'); // 1 Sekunde zwischen Batches
    this.reconnectDelay = parseInt(process.env.SYNC_RECONNECT_DELAY || '5000'); // 5 Sekunden für Reconnect
    this.maxReconnectAttempts = 3;
    this.errors = [];
    this.processedMessages = 0;
    this.totalNewMessages = 0;
    this.db = null;
    this.connectionConfig = config;
    
    this.setupImap();
  }

  setupImap() {
    this.imap = new Imap({
      host: this.connectionConfig.host,
      port: this.connectionConfig.port,
      user: this.connectionConfig.user,
      password: this.connectionConfig.password,
      tls: this.connectionConfig.tls,
      tlsOptions: { rejectUnauthorized: false },
      keepalive: {
        interval: 10000, // Send keepalive every 10 seconds
        idleInterval: 300000, // 5 minutes
        forceNoop: true
      },
      connTimeout: 30000, // Shorter timeout for faster recovery
      authTimeout: 10000,
    });

    this.setupEventHandlers();
  }

  setupEventHandlers() {
    this.imap.once('ready', () => {
      console.log(`📧 IMAP connection ready for account ${this.accountId}`);
    });

    this.imap.once('error', (err) => {
      console.error(`❌ IMAP connection error for account ${this.accountId}:`, err.message);
    });

    this.imap.once('end', () => {
      console.log(`📧 Connection ended for account ${this.accountId}`);
    });

    this.imap.once('close', (hadError) => {
      if (hadError) {
        console.log(`📧 Connection closed with error for account ${this.accountId}`);
      } else {
        console.log(`📧 Connection closed normally for account ${this.accountId}`);
      }
    });
  }

  async connect(attempt = 1) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`IMAP connection timeout (attempt ${attempt})`));
      }, 30000);

      this.imap.once('ready', () => {
        clearTimeout(timeout);
        console.log(`✅ Connected to IMAP server (attempt ${attempt})`);
        resolve();
      });
      
      this.imap.once('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
      
      try {
        this.imap.connect();
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
      }
    });
  }

  async reconnect() {
    console.log(`🔄 Attempting to reconnect to IMAP server...`);
    
    for (let attempt = 1; attempt <= this.maxReconnectAttempts; attempt++) {
      try {
        // Clean up old connection
        if (this.imap.state !== 'disconnected') {
          this.imap.end();
        }
        
        // Wait before reconnecting
        await new Promise(resolve => setTimeout(resolve, this.reconnectDelay));
        
        // Create new IMAP instance
        this.setupImap();
        
        // Try to connect
        await this.connect(attempt);
        
        console.log(`✅ Successfully reconnected on attempt ${attempt}`);
        return true;
        
      } catch (error) {
        console.error(`❌ Reconnect attempt ${attempt} failed:`, error.message);
        
        if (attempt === this.maxReconnectAttempts) {
          throw new Error(`Failed to reconnect after ${this.maxReconnectAttempts} attempts`);
        }
      }
    }
    
    return false;
  }

  async disconnect() {
    if (this.imap && this.imap.state === 'authenticated') {
      this.imap.end();
    }
    if (this.db) {
      await new Promise((resolve) => {
        this.db.close((err) => {
          if (err) console.error('Error closing database:', err);
          resolve();
        });
      });
    }
  }

  async initializeAccountDatabase() {
    try {
      // Create data directory if it doesn't exist
      const dataDir = path.dirname(this.dbPath);
      await fs.mkdir(dataDir, { recursive: true });

      // Initialize SQLite database directly
      this.db = new sqlite3.Database(this.dbPath);

      // Initialize database schema with current schema (latest version)
      const createTableSQL = `
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

      // Create indexes for better performance
      const indexes = [
        'CREATE INDEX IF NOT EXISTS idx_emails_folder ON emails(folder)',
        'CREATE INDEX IF NOT EXISTS idx_emails_date ON emails(date)',
        'CREATE INDEX IF NOT EXISTS idx_emails_from ON emails(fromAddress)',
        'CREATE INDEX IF NOT EXISTS idx_emails_subject ON emails(subject)',
        'CREATE INDEX IF NOT EXISTS idx_emails_messageid ON emails(messageId)',
        'CREATE INDEX IF NOT EXISTS idx_emails_has_attachments ON emails(hasAttachments)',
        'CREATE INDEX IF NOT EXISTS idx_emails_content_type ON emails(contentType)'
      ];

      // Execute schema creation
      await new Promise((resolve, reject) => {
        this.db.run(createTableSQL, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // Execute index creation
      for (const indexSql of indexes) {
        await new Promise((resolve, reject) => {
          this.db.run(indexSql, (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      }

      console.log(`✅ Account database initialized for ${this.accountId}`);
    } catch (error) {
      console.error(`❌ Failed to initialize account database for ${this.accountId}:`, error);
      throw error;
    }
  }

  async getFolders() {
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

  extractFolderNames(boxes, prefix = '') {
    let folders = [];
    
    for (const [name, box] of Object.entries(boxes)) {
      const fullName = prefix ? `${prefix}${box.delimiter || '/'}${name}` : name;
      folders.push(fullName);
      
      if (box.children) {
        folders = folders.concat(this.extractFolderNames(box.children, fullName));
      }
    }
    
    return folders;
  }

  async syncFolder(folderName) {
    const maxRetries = this.maxReconnectAttempts;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.syncFolderAttempt(folderName);
      } catch (error) {
        console.error(`❌ Sync attempt ${attempt} failed for folder ${folderName}:`, error.message);
        
        if (attempt < maxRetries) {
          console.log(`🔄 Retrying sync for folder ${folderName} (attempt ${attempt + 1}/${maxRetries})...`);
          await this.reconnect();
          await new Promise(resolve => setTimeout(resolve, this.reconnectDelay));
        } else {
          console.error(`❌ Max retries reached for folder ${folderName}`);
          throw error;
        }
      }
    }
  }

  async getLastSyncDate(folderName) {
    try {
      return new Promise((resolve, reject) => {
        this.db.get(
          'SELECT MAX(date) as lastDate FROM emails WHERE folder = ?',
          [folderName],
          (err, row) => {
            if (err) {
              console.warn(`⚠️ Could not get last sync date for folder ${folderName}:`, err);
              resolve(null);
            } else {
              resolve(row?.lastDate ? new Date(row.lastDate) : null);
            }
          }
        );
      });
    } catch (error) {
      console.warn(`⚠️ Could not get last sync date for folder ${folderName}:`, error);
      return null;
    }
  }

  async syncFolderAttempt(folderName) {
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

          // Get the last sync date for incremental sync
          const lastSyncDate = await this.getLastSyncDate(folderName);
          let messagesToFetch = [];
          let newMessageCount = 0;

          if (lastSyncDate) {
            console.log(`🔄 Incremental sync: looking for messages since ${lastSyncDate.toISOString()}`);
            
            // Use IMAP SEARCH to find messages since last sync
            const searchCriteria = ['SINCE', lastSyncDate];
            
            try {
              const searchResults = await new Promise((resolve, reject) => {
                this.imap.search(searchCriteria, (err, results) => {
                  if (err) reject(err);
                  else resolve(results || []);
                });
              });

              console.log(`📬 Found ${searchResults.length} messages since last sync`);

              if (searchResults.length === 0) {
                console.log(`📁 No new messages in folder ${folderName} since last sync`);
                resolve(0);
                return;
              }

              messagesToFetch = searchResults;
            } catch (searchError) {
              console.warn(`⚠️ SEARCH failed, falling back to full header check:`, searchError.message);
              // Fall back to the original method
              messagesToFetch = await this.getNewMessagesFullCheck(folderName, totalMessages);
            }
          } else {
            console.log(`🆕 First sync for folder ${folderName}, checking all messages`);
            messagesToFetch = await this.getNewMessagesFullCheck(folderName, totalMessages);
          }

          if (messagesToFetch.length === 0) {
            console.log(`📁 No new messages to sync in folder ${folderName}`);
            resolve(0);
            return;
          }

          console.log(`📥 Fetching ${messagesToFetch.length} new messages from ${folderName}`);

          // Fetch full messages in small batches with delays
          for (let i = 0; i < messagesToFetch.length; i += this.batchSize) {
            const batch = messagesToFetch.slice(i, i + this.batchSize);
            const batchNum = Math.floor(i / this.batchSize) + 1;
            const totalBatches = Math.ceil(messagesToFetch.length / this.batchSize);
            
            console.log(`📦 Processing batch ${batchNum}/${totalBatches} (${batch.length} messages)`);
            
            try {
              const count = await this.fetchMessageBatch(batch, folderName);
              newMessageCount += count;
              
              // Progress update
              const progress = Math.round(((i + batch.length) / messagesToFetch.length) * 100);
              console.log(`✅ Batch completed: ${i + batch.length}/${messagesToFetch.length} messages (${progress}%)`);
              
              // Gmail-friendly delay between batches
              if (i + this.batchSize < messagesToFetch.length) {
                console.log(`⏸️  Waiting ${this.batchDelay}ms before next batch...`);
                await new Promise(resolve => setTimeout(resolve, this.batchDelay));
              }
              
            } catch (error) {
              this.errors.push(`Batch processing error in ${folderName}: ${error.message}`);
              console.error(`❌ Batch ${batchNum} error: ${error.message}`);
              
              // If it's a connection error, let the outer function handle reconnection
              if (error.message.includes('socket') || error.message.includes('connection')) {
                throw error;
              }
              
              if (this.errors.length >= this.maxErrors) {
                console.error(`❌ Maximum errors reached (${this.maxErrors}). Stopping sync.`);
                break;
              }
            }
          }

          resolve(newMessageCount);
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  async getNewMessagesFullCheck(folderName, totalMessages) {
    console.log(`⚙️  Using batch size: ${this.batchSize}, delay: ${this.batchDelay}ms`);

    // Get existing message IDs to avoid duplicates
    const existingMessages = await this.getExistingMessageIds(folderName);

    // For large mailboxes, warn about processing time
    if (totalMessages > 1000) {
      console.log(`📊 Large mailbox detected (${totalMessages} messages). This will take time...`);
      const estimatedTime = Math.round((totalMessages / this.batchSize) * (this.batchDelay / 1000) / 60);
      console.log(`⏱️  Estimated time: ~${estimatedTime} minutes`);
    }

    return new Promise((resolve, reject) => {
      const fetch = this.imap.seq.fetch('1:*', {
        bodies: 'HEADER.FIELDS (MESSAGE-ID)',
        struct: true,
      });

      const messagesToFetch = [];
      let processedHeaders = 0;
      
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
            
            processedHeaders++;
            if (processedHeaders % 500 === 0) {
              console.log(`📋 Processed ${processedHeaders}/${totalMessages} headers...`);
            }
          });
        });
      });

      fetch.once('end', () => {
        resolve(messagesToFetch);
      });

      fetch.once('error', reject);
    });
  }

  async getExistingMessageIds(folder) {
    try {
      return new Promise((resolve, reject) => {
        this.db.all(
          'SELECT messageId FROM emails WHERE folder = ?',
          [folder],
          (err, rows) => {
            if (err) {
              console.warn(`⚠️ Could not get existing message IDs for folder ${folder}:`, err);
              resolve(new Set());
            } else {
              resolve(new Set(rows.map(row => row.messageId)));
            }
          }
        );
      });
    } catch (error) {
      console.warn(`⚠️ Could not get existing message IDs for folder ${folder}:`, error);
      return new Set();
    }
  }

  extractMessageId(header) {
    const match = header.match(/Message-ID:\s*<([^>]+)>/i);
    return match ? match[1] : null;
  }

  async fetchMessageBatch(seqnos, folderName) {
    return new Promise((resolve, reject) => {
      let processedCount = 0;
      const seqnoRange = seqnos.join(',');
      
      // Add timeout for batch processing
      const batchTimeout = setTimeout(() => {
        console.error(`⏰ Batch timeout after 60 seconds for messages ${seqnoRange}`);
        reject(new Error(`Batch processing timeout for messages ${seqnoRange}`));
      }, 60000); // 60 second timeout
      
      console.log(`🔍 Fetching message range: ${seqnoRange}`);
      
      const fetch = this.imap.seq.fetch(seqnoRange, {
        bodies: '',
        struct: true,
      });

      fetch.on('message', (msg, seqno) => {
        let buffer = Buffer.alloc(0);
        let attrs;
        let messageStartTime = Date.now();

        console.log(`📩 Processing message ${seqno}...`);

        msg.on('body', (stream) => {
          stream.on('data', (chunk) => {
            buffer = Buffer.concat([buffer, chunk]);
            
            // Check for extremely large emails (> 50MB)
            if (buffer.length > 50 * 1024 * 1024) {
              console.warn(`⚠️ Very large message ${seqno}: ${Math.round(buffer.length / (1024 * 1024))}MB`);
            }
          });
        });

        msg.once('attributes', (attributes) => {
          attrs = attributes;
        });

        msg.once('end', async () => {
          try {
            const messageTime = Date.now() - messageStartTime;
            console.log(`📧 Downloaded message ${seqno} (${Math.round(buffer.length / 1024)}KB in ${messageTime}ms)`);
            
            const parsed = await simpleParser(buffer);
            console.log(`🔍 Parsed message ${seqno}: ${parsed.subject || 'No subject'}`);
            
            const emailData = this.parseEmailData(parsed, folderName, attrs);
            
            await this.saveEmail(emailData);
            console.log(`💾 Saved message ${seqno} to database`);
            
            processedCount++;
            this.processedMessages++;
            this.totalNewMessages++;
            
            if (processedCount === seqnos.length) {
              clearTimeout(batchTimeout);
              console.log(`✅ Batch completed: ${processedCount}/${seqnos.length} messages`);
              resolve(processedCount);
            }
          } catch (error) {
            this.errors.push(`Error processing message ${seqno}: ${error.message}`);
            console.error(`❌ Error processing message ${seqno}:`, error.message);
            processedCount++;
            
            if (processedCount === seqnos.length) {
              clearTimeout(batchTimeout);
              resolve(processedCount);
            }
          }
        });
      });

      fetch.once('error', (err) => {
        clearTimeout(batchTimeout);
        this.errors.push(`Fetch error: ${err.message}`);
        console.error(`❌ Fetch error for range ${seqnoRange}:`, err.message);
        reject(err);
      });

      fetch.once('end', () => {
        console.log(`📥 Fetch completed for range ${seqnoRange}`);
      });
    });
  }

  parseEmailData(parsed, folder, attrs) {
    const messageId = parsed.messageId || `${Date.now()}-${Math.random()}`;
    
    // Detect content type
    const hasHtml = parsed.html && parsed.html.trim().length > 0;
    const contentType = hasHtml ? 'HTML' : 'PLAIN';
    
    // Process attachments
    const attachments = parsed.attachments?.map(att => ({
      filename: att.filename,
      contentType: att.contentType,
      size: att.size,
      content: att.content, // For saving to filesystem
    })) || [];
    
    const hasAttachments = attachments.length > 0;
    
    return {
      messageId,
      subject: parsed.subject || '',
      fromAddress: parsed.from?.value?.[0]?.address || '',
      fromName: parsed.from?.value?.[0]?.name || '',
      toAddresses: parsed.to?.value?.map(addr => addr.address) || [],
      ccAddresses: parsed.cc?.value?.map(addr => addr.address) || [],
      bccAddresses: parsed.bcc?.value?.map(addr => addr.address) || [],
      bodyText: parsed.text || '',
      bodyHtml: parsed.html || '',
      contentType,
      hasAttachments,
      attachments,
      date: parsed.date || new Date(),
      folder,
      flags: attrs?.flags || [],
      size: attrs?.size || 0,
    };
  }

  async saveEmail(emailData) {
    try {
      const cuid = this.generateCuid();
      let attachmentsPath = null;
      
      // Save attachments to filesystem if they exist
      if (emailData.hasAttachments && emailData.attachments.length > 0) {
        attachmentsPath = await this.saveAttachments(cuid, emailData.attachments);
      }
      
      return new Promise((resolve, reject) => {
        const sql = `
          INSERT OR REPLACE INTO emails (
            id, messageId, subject, fromAddress, fromName, toAddresses, 
            bodyText, bodyHtml, contentType, hasAttachments, attachmentsPath,
            attachments, folder, date, size, createdAt
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `;
        
        const params = [
          cuid,
          emailData.messageId,
          emailData.subject,
          emailData.fromAddress,
          emailData.fromName,
          JSON.stringify(emailData.toAddresses),
          emailData.bodyText,
          emailData.bodyHtml,
          emailData.contentType,
          emailData.hasAttachments ? 1 : 0,
          attachmentsPath,
          JSON.stringify(emailData.attachments || []),
          emailData.folder,
          emailData.date.toISOString(),
          emailData.size
        ];
        
        this.db.run(sql, params, (err) => {
          if (err) {
            console.error(`❌ Error saving email ${emailData.messageId}:`, err);
            reject(err);
          } else {
            resolve();
          }
        });
      });
    } catch (error) {
      console.error(`❌ Error saving email ${emailData.messageId}:`, error);
      throw error;
    }
  }

  async saveAttachments(emailId, attachments) {
    const fs = require('fs').promises;
    const path = require('path');
    
    try {
      // Create attachments directory structure: {ATTACHMENTS_DIR}/{accountId}/{messageId}/
      const attachmentsBaseDir = process.env.ATTACHMENTS_DIR || './data/attachments';
      const attachmentsDir = path.join(process.cwd(), attachmentsBaseDir, this.accountId, emailId);
      
      // Ensure directory exists
      await fs.mkdir(attachmentsDir, { recursive: true });
      
      const savedFiles = [];
      for (const attachment of attachments) {
        if (!attachment.content || !attachment.filename) {
          console.warn(`⚠️ Skipping attachment without content or filename`);
          continue;
        }
        
        // Sanitize filename
        const sanitizedFilename = attachment.filename
          .replace(/[^a-zA-Z0-9.\-_]/g, '_')
          .replace(/_{2,}/g, '_')
          .substring(0, 100); // Limit length
        
        const filePath = path.join(attachmentsDir, sanitizedFilename);
        
        // Skip very large attachments (> 50MB)
        if (attachment.size > 50 * 1024 * 1024) {
          console.warn(`⚠️ Skipping large attachment: ${sanitizedFilename} (${Math.round(attachment.size / (1024 * 1024))}MB)`);
          continue;
        }
        
        // Save attachment to file
        await fs.writeFile(filePath, attachment.content);
        console.log(`💾 Saved attachment: ${sanitizedFilename} (${Math.round(attachment.size / 1024)}KB)`);
        
        savedFiles.push({
          originalName: attachment.filename,
          savedName: sanitizedFilename,
          size: attachment.size,
          contentType: attachment.contentType
        });
      }
      
      return savedFiles.length > 0 ? attachmentsDir : null;
    } catch (error) {
      console.error(`❌ Error saving attachments for email ${emailId}:`, error);
      return null;
    }
  }

  generateCuid() {
    // Simple CUID-like generator
    const timestamp = Date.now().toString(36);
    const randomPart = Math.random().toString(36).substr(2, 9);
    return `c${timestamp}${randomPart}`;
  }

  async incrementalSync() {
    const startTime = Date.now();
    this.errors = [];
    this.processedMessages = 0;
    this.totalNewMessages = 0;

    try {
      await this.connect();
      await this.initializeAccountDatabase();
      
      const folders = await this.getFolders();
      console.log(`📁 Found ${folders.length} folders for incremental sync of account ${this.accountId}`);

      // Prioritize INBOX first for incremental sync
      const priorityFolders = ['INBOX'];
      const secondaryFolders = ['Sent', 'Drafts', 'Important', '[Gmail]/Sent Mail', '[Gmail]/Drafts'];
      
      const sortedFolders = [
        ...folders.filter(f => priorityFolders.some(pf => f.toLowerCase() === pf.toLowerCase())),
        ...folders.filter(f => secondaryFolders.some(pf => f.toLowerCase().includes(pf.toLowerCase()))),
        ...folders.filter(f => 
          !priorityFolders.some(pf => f.toLowerCase() === pf.toLowerCase()) &&
          !secondaryFolders.some(pf => f.toLowerCase().includes(pf.toLowerCase()))
        )
      ];

      for (const folder of sortedFolders) {
        try {
          console.log(`\n🔄 Starting incremental sync for folder: ${folder}`);
          const messageCount = await this.syncFolder(folder);
          console.log(`✅ Synced ${messageCount} new messages from folder ${folder}`);
          
          // Progress summary after each folder
          const elapsed = Math.round((Date.now() - startTime) / 1000);
          console.log(`📊 Progress: ${this.totalNewMessages} total new messages, ${Math.floor(elapsed / 60)}m ${elapsed % 60}s elapsed`);
          
          // Short delay between folders for incremental sync
          if (sortedFolders.indexOf(folder) < sortedFolders.length - 1) {
            console.log(`⏸️  Waiting 1 second before next folder...`);
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
          
        } catch (error) {
          const errorMsg = `Failed to sync folder ${folder}: ${error.message}`;
          this.errors.push(errorMsg);
          console.error(`❌ ${errorMsg}`);
          
          if (this.errors.length >= this.maxErrors) {
            console.error(`❌ Maximum errors reached (${this.maxErrors}). Stopping sync.`);
            break;
          }
        }
      }

    } catch (error) {
      this.errors.push(`Connection error: ${error.message}`);
      console.error(`❌ IMAP incremental sync failed for account ${this.accountId}:`, error.message);
    } finally {
      await this.disconnect();
    }

    const totalTime = Math.round((Date.now() - startTime) / 1000);
    console.log(`\n📊 Incremental sync completed in ${Math.floor(totalTime / 60)}m ${totalTime % 60}s`);
    
    return { 
      totalMessages: this.totalNewMessages, 
      errors: this.errors,
      timeElapsed: totalTime,
      processedMessages: this.processedMessages
    };
  }

  async fullSync() {
    const startTime = Date.now();
    this.errors = [];
    this.processedMessages = 0;
    this.totalNewMessages = 0;

    try {
      await this.connect();
      await this.initializeAccountDatabase();
      
      const folders = await this.getFolders();
      console.log(`📁 Found ${folders.length} folders for full sync of account ${this.accountId}`);

      // Prioritize INBOX first for large mailboxes  
      const priorityFolders = ['INBOX'];
      const secondaryFolders = ['Sent', 'Drafts', 'Important', '[Gmail]/Sent Mail', '[Gmail]/Drafts'];
      
      const sortedFolders = [
        ...folders.filter(f => priorityFolders.some(pf => f.toLowerCase() === pf.toLowerCase())),
        ...folders.filter(f => secondaryFolders.some(pf => f.toLowerCase().includes(pf.toLowerCase()))),
        ...folders.filter(f => 
          !priorityFolders.some(pf => f.toLowerCase() === pf.toLowerCase()) &&
          !secondaryFolders.some(pf => f.toLowerCase().includes(pf.toLowerCase()))
        )
      ];

      for (const folder of sortedFolders) {
        try {
          console.log(`\n🔄 Starting full sync for folder: ${folder}`);
          const messageCount = await this.syncFolder(folder);
          console.log(`✅ Synced ${messageCount} messages from folder ${folder}`);
          
          // Progress summary after each folder
          const elapsed = Math.round((Date.now() - startTime) / 1000);
          console.log(`📊 Progress: ${this.totalNewMessages} total new messages, ${Math.floor(elapsed / 60)}m ${elapsed % 60}s elapsed`);
          
          // Longer delay between folders for Gmail
          if (sortedFolders.indexOf(folder) < sortedFolders.length - 1) {
            console.log(`⏸️  Waiting 3 seconds before next folder...`);
            await new Promise(resolve => setTimeout(resolve, 3000));
          }
          
        } catch (error) {
          const errorMsg = `Failed to sync folder ${folder}: ${error.message}`;
          this.errors.push(errorMsg);
          console.error(`❌ ${errorMsg}`);
          
          if (this.errors.length >= this.maxErrors) {
            console.error(`❌ Maximum errors reached (${this.maxErrors}). Stopping sync.`);
            break;
          }
        }
      }

    } catch (error) {
      this.errors.push(`Connection error: ${error.message}`);
      console.error(`❌ IMAP full sync failed for account ${this.accountId}:`, error.message);
    } finally {
      await this.disconnect();
    }

    const totalTime = Math.round((Date.now() - startTime) / 1000);
    console.log(`\n📊 Full sync completed in ${Math.floor(totalTime / 60)}m ${totalTime % 60}s`);
    
    return { 
      totalMessages: this.totalNewMessages, 
      errors: this.errors,
      timeElapsed: totalTime,
      processedMessages: this.processedMessages
    };
  }
}

module.exports = { ImapSyncService }; 