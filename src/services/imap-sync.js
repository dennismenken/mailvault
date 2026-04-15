const Imap = require('imap');
const { simpleParser } = require('mailparser');
const path = require('path');
const fs = require('fs').promises;
const Database = require('better-sqlite3');

class ImapSyncService {
  constructor(config) {
    this.accountId = config.accountId;
    this.dbPath = config.dbPath;
    this.maxErrors = parseInt(process.env.MAX_SYNC_ERRORS || '10');
    this.batchSize = parseInt(process.env.SYNC_BATCH_SIZE || '5'); // Smaller batches for Gmail
    this.batchDelay = parseInt(process.env.SYNC_BATCH_DELAY || '1000'); // 1 second between batches
    this.reconnectDelay = parseInt(process.env.SYNC_RECONNECT_DELAY || '5000'); // 5 seconds for reconnect
    this.maxReconnectAttempts = 3;
    this.errors = [];
    this.processedMessages = 0;
    this.totalNewMessages = 0;
    this.db = null;
    // Prepared statement cache; populated in initializeAccountDatabase().
    this.stmts = null;
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
      console.log(`[imap] connection ready for account ${this.accountId}`);
    });

    this.imap.once('error', (err) => {
      console.error(`[imap] connection error for account ${this.accountId}:`, err.message);
    });

    this.imap.once('end', () => {
      console.log(`[imap] connection ended for account ${this.accountId}`);
    });

    this.imap.once('close', (hadError) => {
      if (hadError) {
        console.log(`[imap] connection closed with error for account ${this.accountId}`);
      } else {
        console.log(`[imap] connection closed normally for account ${this.accountId}`);
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
        console.log(`[imap] connected (attempt ${attempt})`);
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
    console.log(`[imap] attempting to reconnect...`);

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

        console.log(`[imap] successfully reconnected on attempt ${attempt}`);
        return true;

      } catch (error) {
        console.error(`[imap] reconnect attempt ${attempt} failed:`, error.message);

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
      try {
        this.db.close();
      } catch (err) {
        console.error('Error closing database:', err);
      }
      this.db = null;
      this.stmts = null;
    }
  }

  async initializeAccountDatabase() {
    try {
      // Create data directory if it doesn't exist
      const dataDir = path.dirname(this.dbPath);
      await fs.mkdir(dataDir, { recursive: true });

      // Initialize SQLite database directly via better-sqlite3 (synchronous, throws on error).
      this.db = new Database(this.dbPath);

      // Enable WAL mode to improve concurrency between the web app and the sync service.
      // better-sqlite3 pragmas are executed synchronously; failures are logged but not fatal.
      try {
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('synchronous = NORMAL');
      } catch (pragmaErr) {
        console.warn('[db] Failed to set WAL pragmas:', pragmaErr.message);
      }

      // Initialize database schema with current schema (latest version)
      const createTableSQL = `
        CREATE TABLE IF NOT EXISTS emails (
          id TEXT PRIMARY KEY,
          messageId TEXT UNIQUE NOT NULL,
          uid INTEGER,
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

      // Create sync_state table
      const createSyncStateSQL = `
        CREATE TABLE IF NOT EXISTS sync_state (
          id TEXT PRIMARY KEY,
          folder TEXT UNIQUE NOT NULL,
          uidValidity INTEGER,
          highestUid INTEGER NOT NULL DEFAULT 0,
          lastSyncAt DATETIME,
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
        'CREATE INDEX IF NOT EXISTS idx_emails_content_type ON emails(contentType)',
        'CREATE INDEX IF NOT EXISTS idx_emails_folder_uid ON emails(folder, uid)'
      ];

      // Execute schema creation synchronously (better-sqlite3 throws on failure).
      this.db.exec(createTableSQL);
      this.db.exec(createSyncStateSQL);

      // Create migrations_applied table for tracking
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS migrations_applied (
          id TEXT PRIMARY KEY,
          applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Execute index creation
      for (const indexSql of indexes) {
        this.db.exec(indexSql);
      }

      // Mark initial schema as applied (both migrations)
      const markInitialStmt = this.db.prepare(
        'INSERT OR IGNORE INTO migrations_applied (id) VALUES (?)'
      );
      markInitialStmt.run('001_add_content_type');
      markInitialStmt.run('002_add_uid_sync_state');

      // Pre-prepare hot-path statements used during sync to avoid re-preparing
      // inside tight loops.
      this.stmts = {
        insertEmail: this.db.prepare(`
          INSERT INTO emails (
            id, messageId, uid, subject, fromAddress, fromName, toAddresses,
            ccAddresses, bccAddresses, bodyText, bodyHtml, contentType,
            hasAttachments, attachmentsPath, attachments, folder, flags,
            date, size, createdAt, updatedAt
          ) VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
            datetime('now'), datetime('now')
          )
          ON CONFLICT(messageId) DO UPDATE SET
            uid = excluded.uid,
            subject = excluded.subject,
            fromAddress = excluded.fromAddress,
            fromName = excluded.fromName,
            toAddresses = excluded.toAddresses,
            ccAddresses = excluded.ccAddresses,
            bccAddresses = excluded.bccAddresses,
            bodyText = excluded.bodyText,
            bodyHtml = excluded.bodyHtml,
            contentType = excluded.contentType,
            hasAttachments = excluded.hasAttachments,
            attachmentsPath = excluded.attachmentsPath,
            attachments = excluded.attachments,
            folder = excluded.folder,
            flags = excluded.flags,
            date = excluded.date,
            size = excluded.size,
            updatedAt = datetime('now')
        `),
        selectSyncState: this.db.prepare('SELECT * FROM sync_state WHERE folder = ?'),
        selectLastDate: this.db.prepare('SELECT MAX(date) as lastDate FROM emails WHERE folder = ?'),
        selectMessageIds: this.db.prepare('SELECT messageId FROM emails WHERE folder = ?'),
        selectMaxUid: this.db.prepare('SELECT MAX(uid) as maxUid FROM emails WHERE folder = ? AND uid IS NOT NULL'),
        upsertSyncState: this.db.prepare(`
          INSERT INTO sync_state (id, folder, uidValidity, highestUid, lastSyncAt, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(folder) DO UPDATE SET
            uidValidity = excluded.uidValidity,
            highestUid = excluded.highestUid,
            lastSyncAt = excluded.lastSyncAt,
            updatedAt = excluded.updatedAt
        `)
      };

      console.log(`[db] account database initialized for ${this.accountId}`);
    } catch (error) {
      console.error(`[db] failed to initialize account database for ${this.accountId}:`, error);
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
        console.error(`[sync] attempt ${attempt} failed for folder ${folderName}:`, error.message);

        if (attempt < maxRetries) {
          console.log(`[sync] retrying folder ${folderName} (attempt ${attempt + 1}/${maxRetries})...`);
          await this.reconnect();
          await new Promise(resolve => setTimeout(resolve, this.reconnectDelay));
        } else {
          console.error(`[sync] max retries reached for folder ${folderName}`);
          throw error;
        }
      }
    }
  }

  getLastSyncDate(folderName) {
    try {
      const row = this.stmts.selectLastDate.get(folderName);
      return row && row.lastDate ? new Date(row.lastDate) : null;
    } catch (error) {
      console.warn(`[db] could not get last sync date for folder ${folderName}:`, error.message);
      return null;
    }
  }

  getSyncState(folderName) {
    try {
      return this.stmts.selectSyncState.get(folderName) || null;
    } catch (error) {
      console.warn(`[db] could not get sync state for folder ${folderName}:`, error.message);
      return null;
    }
  }

  updateSyncState(folderName, uidValidity, highestUid) {
    const id = require('crypto').randomBytes(16).toString('hex');
    const now = new Date().toISOString();

    this.stmts.upsertSyncState.run(
      id,
      folderName,
      uidValidity,
      highestUid,
      now,
      now,
      now
    );
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
          const uidValidity = box.uidvalidity;

          if (totalMessages === 0) {
            console.log(`[sync] folder ${folderName} is empty`);
            resolve(0);
            return;
          }

          console.log(`[sync] syncing folder ${folderName} with ${totalMessages} messages (UIDVALIDITY: ${uidValidity})`);

          // Get the sync state for this folder
          const syncState = this.getSyncState(folderName);
          let messagesToFetch = [];
          let newMessageCount = 0;
          let needFullSync = false;

          // Check if we need a full sync due to UIDVALIDITY change
          if (syncState && syncState.uidValidity && syncState.uidValidity !== uidValidity) {
            console.log(`[sync] UIDVALIDITY changed from ${syncState.uidValidity} to ${uidValidity}. Full sync required.`);
            needFullSync = true;
          }

          if (!needFullSync && syncState && syncState.highestUid > 0) {
            console.log(`[sync] incremental: looking for messages with UID > ${syncState.highestUid}`);

            // Use UID FETCH to get only new messages
            try {
              const fetchRange = `${syncState.highestUid + 1}:*`;
              console.log(`[sync] fetching UID range: ${fetchRange}`);

              messagesToFetch = await new Promise((resolveFetch, rejectFetch) => {
                const messages = [];
                const fetch = this.imap.fetch(fetchRange, {
                  bodies: 'HEADER.FIELDS (MESSAGE-ID)',
                  struct: true
                });

                fetch.on('message', (msg, _seqno) => {
                  msg.on('attributes', (attrs) => {
                    messages.push(attrs.uid);
                  });
                });

                fetch.on('error', (fetchErr) => {
                  // If the range is empty, it's not an error
                  if (fetchErr.message.includes('Nothing to fetch')) {
                    resolveFetch([]);
                  } else {
                    rejectFetch(fetchErr);
                  }
                });

                fetch.on('end', () => {
                  resolveFetch(messages);
                });
              });

              console.log(`[sync] found ${messagesToFetch.length} new messages with UIDs > ${syncState.highestUid}`);
            } catch (uidError) {
              console.warn(`[sync] UID FETCH failed, falling back to date-based sync:`, uidError.message);
              // Fall back to date-based sync
              const lastSyncDate = this.getLastSyncDate(folderName);
              if (lastSyncDate) {
                const searchCriteria = ['SINCE', lastSyncDate];
                try {
                  messagesToFetch = await new Promise((resolveSearch, rejectSearch) => {
                    this.imap.search(searchCriteria, (searchErr, results) => {
                      if (searchErr) rejectSearch(searchErr);
                      else resolveSearch(results || []);
                    });
                  });
                } catch (searchError) {
                  console.warn(`[sync] SEARCH also failed, falling back to full check:`, searchError.message);
                  messagesToFetch = await this.getNewMessagesFullCheck(folderName, totalMessages);
                }
              } else {
                messagesToFetch = await this.getNewMessagesFullCheck(folderName, totalMessages);
              }
            }
          } else {
            console.log(`[sync] first or full sync required for folder ${folderName}, checking all messages`);
            messagesToFetch = await this.getNewMessagesFullCheck(folderName, totalMessages);
          }

          if (messagesToFetch.length === 0) {
            console.log(`[sync] no new messages to sync in folder ${folderName}`);
            resolve(0);
            return;
          }

          console.log(`[sync] fetching ${messagesToFetch.length} new messages from ${folderName}`);

          // Fetch full messages in small batches with delays
          for (let i = 0; i < messagesToFetch.length; i += this.batchSize) {
            const batch = messagesToFetch.slice(i, i + this.batchSize);
            const batchNum = Math.floor(i / this.batchSize) + 1;
            const totalBatches = Math.ceil(messagesToFetch.length / this.batchSize);

            console.log(`[sync] processing batch ${batchNum}/${totalBatches} (${batch.length} messages)`);

            try {
              const count = await this.fetchMessageBatch(batch, folderName);
              newMessageCount += count;

              // Progress update
              const progress = Math.round(((i + batch.length) / messagesToFetch.length) * 100);
              console.log(`[sync] batch completed: ${i + batch.length}/${messagesToFetch.length} messages (${progress}%)`);

              // Gmail-friendly delay between batches
              if (i + this.batchSize < messagesToFetch.length) {
                console.log(`[sync] waiting ${this.batchDelay}ms before next batch...`);
                await new Promise(resolve => setTimeout(resolve, this.batchDelay));
              }

            } catch (error) {
              this.errors.push(`Batch processing error in ${folderName}: ${error.message}`);
              console.error(`[sync] batch ${batchNum} error: ${error.message}`);

              // If it's a connection error, let the outer function handle reconnection
              if (error.message.includes('socket') || error.message.includes('connection')) {
                throw error;
              }

              if (this.errors.length >= this.maxErrors) {
                console.error(`[sync] maximum errors reached (${this.maxErrors}). Stopping sync.`);
                break;
              }
            }
          }

          // Update sync state with highest UID if we processed messages
          if (newMessageCount > 0 && uidValidity) {
            try {
              // Get the highest UID from the database for this folder
              const row = this.stmts.selectMaxUid.get(folderName);
              const highestUid = (row && row.maxUid) || 0;

              if (highestUid > 0) {
                this.updateSyncState(folderName, uidValidity, highestUid);
                console.log(`[sync] updated sync state: folder=${folderName}, uidValidity=${uidValidity}, highestUid=${highestUid}`);
              }
            } catch (error) {
              console.warn(`[sync] could not update sync state:`, error.message);
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
    console.log(`[sync] using batch size: ${this.batchSize}, delay: ${this.batchDelay}ms`);

    // Get existing message IDs to avoid duplicates
    const existingMessages = this.getExistingMessageIds(folderName);

    // For large mailboxes, warn about processing time
    if (totalMessages > 1000) {
      console.log(`[sync] large mailbox detected (${totalMessages} messages). This will take time...`);
      const estimatedTime = Math.round((totalMessages / this.batchSize) * (this.batchDelay / 1000) / 60);
      console.log(`[sync] estimated time: ~${estimatedTime} minutes`);
    }

    return new Promise((resolve, reject) => {
      const fetch = this.imap.seq.fetch('1:*', {
        bodies: 'HEADER.FIELDS (MESSAGE-ID)',
        struct: true,
      });

      const messagesToFetch = [];
      let processedHeaders = 0;

      fetch.on('message', (msg, seqno) => {
        msg.on('body', (stream, _info) => {
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
              console.log(`[sync] processed ${processedHeaders}/${totalMessages} headers...`);
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

  getExistingMessageIds(folder) {
    try {
      const rows = this.stmts.selectMessageIds.all(folder);
      return new Set(rows.map(row => row.messageId));
    } catch (error) {
      console.warn(`[db] could not get existing message IDs for folder ${folder}:`, error.message);
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
        console.error(`[sync] batch timeout after 60 seconds for messages ${seqnoRange}`);
        reject(new Error(`Batch processing timeout for messages ${seqnoRange}`));
      }, 60000); // 60 second timeout

      console.log(`[sync] fetching message range: ${seqnoRange}`);

      const fetch = this.imap.seq.fetch(seqnoRange, {
        bodies: '',
        struct: true,
      });

      fetch.on('message', (msg, seqno) => {
        let buffer = Buffer.alloc(0);
        let attrs;
        const messageStartTime = Date.now();

        console.log(`[sync] processing message ${seqno}...`);

        msg.on('body', (stream) => {
          stream.on('data', (chunk) => {
            buffer = Buffer.concat([buffer, chunk]);

            // Check for extremely large emails (> 50MB)
            if (buffer.length > 50 * 1024 * 1024) {
              console.warn(`[sync] very large message ${seqno}: ${Math.round(buffer.length / (1024 * 1024))}MB`);
            }
          });
        });

        msg.once('attributes', (attributes) => {
          attrs = attributes;
        });

        msg.once('end', async () => {
          try {
            const messageTime = Date.now() - messageStartTime;
            console.log(`[sync] downloaded message ${seqno} (${Math.round(buffer.length / 1024)}KB in ${messageTime}ms)`);

            const parsed = await simpleParser(buffer);
            console.log(`[sync] parsed message ${seqno}: ${parsed.subject || 'No subject'}`);

            const emailData = this.parseEmailData(parsed, folderName, attrs);

            await this.saveEmail(emailData);
            console.log(`[sync] saved message ${seqno} to database`);

            processedCount++;
            this.processedMessages++;
            this.totalNewMessages++;

            if (processedCount === seqnos.length) {
              clearTimeout(batchTimeout);
              console.log(`[sync] batch completed: ${processedCount}/${seqnos.length} messages`);
              resolve(processedCount);
            }
          } catch (error) {
            this.errors.push(`Error processing message ${seqno}: ${error.message}`);
            console.error(`[sync] error processing message ${seqno}:`, error.message);
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
        console.error(`[sync] fetch error for range ${seqnoRange}:`, err.message);
        reject(err);
      });

      fetch.once('end', () => {
        console.log(`[sync] fetch completed for range ${seqnoRange}`);
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
      uid: attrs?.uid || null,
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

      // Serialize attachments without the raw Buffer content to keep rows small.
      // The original code stored the full JSON (including base64-like Buffer JSON);
      // we preserve that behavior for compatibility.
      const attachmentsJson = JSON.stringify(emailData.attachments || []);

      try {
        this.stmts.insertEmail.run(
          cuid,
          emailData.messageId,
          emailData.uid,
          emailData.subject,
          emailData.fromAddress,
          emailData.fromName,
          JSON.stringify(emailData.toAddresses || []),
          JSON.stringify(emailData.ccAddresses || []),
          JSON.stringify(emailData.bccAddresses || []),
          emailData.bodyText,
          emailData.bodyHtml,
          emailData.contentType,
          emailData.hasAttachments ? 1 : 0,
          attachmentsPath,
          attachmentsJson,
          emailData.folder,
          JSON.stringify(emailData.flags || []),
          emailData.date.toISOString(),
          emailData.size
        );
      } catch (err) {
        console.error(`[db] error saving email ${emailData.messageId}:`, err.message);
        throw err;
      }
    } catch (error) {
      console.error(`[db] error saving email ${emailData.messageId}:`, error.message);
      throw error;
    }
  }

  async saveAttachments(emailId, attachments) {
    const fsp = require('fs').promises;
    const p = require('path');

    try {
      // Create attachments directory structure: {ATTACHMENTS_DIR}/{accountId}/{messageId}/
      const attachmentsBaseDir = process.env.ATTACHMENTS_DIR || './data/attachments';
      const attachmentsDir = p.join(process.cwd(), attachmentsBaseDir, this.accountId, emailId);

      // Ensure directory exists
      await fsp.mkdir(attachmentsDir, { recursive: true });

      const savedFiles = [];
      for (const attachment of attachments) {
        if (!attachment.content || !attachment.filename) {
          console.warn(`[attach] skipping attachment without content or filename`);
          continue;
        }

        // Sanitize filename
        const sanitizedFilename = attachment.filename
          .replace(/[^a-zA-Z0-9.\-_]/g, '_')
          .replace(/_{2,}/g, '_')
          .substring(0, 100); // Limit length

        const filePath = p.join(attachmentsDir, sanitizedFilename);

        // Skip very large attachments (> 50MB)
        if (attachment.size > 50 * 1024 * 1024) {
          console.warn(`[attach] skipping large attachment: ${sanitizedFilename} (${Math.round(attachment.size / (1024 * 1024))}MB)`);
          continue;
        }

        // Save attachment to file
        await fsp.writeFile(filePath, attachment.content);
        console.log(`[attach] saved attachment: ${sanitizedFilename} (${Math.round(attachment.size / 1024)}KB)`);

        savedFiles.push({
          originalName: attachment.filename,
          savedName: sanitizedFilename,
          size: attachment.size,
          contentType: attachment.contentType
        });
      }

      return savedFiles.length > 0 ? attachmentsDir : null;
    } catch (error) {
      console.error(`[attach] error saving attachments for email ${emailId}:`, error.message);
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
      console.log(`[sync] found ${folders.length} folders for incremental sync of account ${this.accountId}`);

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
          console.log(`\n[sync] starting incremental sync for folder: ${folder}`);
          const messageCount = await this.syncFolder(folder);
          console.log(`[sync] synced ${messageCount} new messages from folder ${folder}`);

          // Progress summary after each folder
          const elapsed = Math.round((Date.now() - startTime) / 1000);
          console.log(`[sync] progress: ${this.totalNewMessages} total new messages, ${Math.floor(elapsed / 60)}m ${elapsed % 60}s elapsed`);

          // Short delay between folders for incremental sync
          if (sortedFolders.indexOf(folder) < sortedFolders.length - 1) {
            console.log(`[sync] waiting 1 second before next folder...`);
            await new Promise(resolve => setTimeout(resolve, 1000));
          }

        } catch (error) {
          const errorMsg = `Failed to sync folder ${folder}: ${error.message}`;
          this.errors.push(errorMsg);
          console.error(`[sync] ${errorMsg}`);

          if (this.errors.length >= this.maxErrors) {
            console.error(`[sync] maximum errors reached (${this.maxErrors}). Stopping sync.`);
            break;
          }
        }
      }

    } catch (error) {
      this.errors.push(`Connection error: ${error.message}`);
      console.error(`[sync] IMAP incremental sync failed for account ${this.accountId}:`, error.message);
    } finally {
      await this.disconnect();
    }

    const totalTime = Math.round((Date.now() - startTime) / 1000);
    console.log(`\n[sync] incremental sync completed in ${Math.floor(totalTime / 60)}m ${totalTime % 60}s`);

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
      console.log(`[sync] found ${folders.length} folders for full sync of account ${this.accountId}`);

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
          console.log(`\n[sync] starting full sync for folder: ${folder}`);
          const messageCount = await this.syncFolder(folder);
          console.log(`[sync] synced ${messageCount} messages from folder ${folder}`);

          // Progress summary after each folder
          const elapsed = Math.round((Date.now() - startTime) / 1000);
          console.log(`[sync] progress: ${this.totalNewMessages} total new messages, ${Math.floor(elapsed / 60)}m ${elapsed % 60}s elapsed`);

          // Longer delay between folders for Gmail
          if (sortedFolders.indexOf(folder) < sortedFolders.length - 1) {
            console.log(`[sync] waiting 3 seconds before next folder...`);
            await new Promise(resolve => setTimeout(resolve, 3000));
          }

        } catch (error) {
          const errorMsg = `Failed to sync folder ${folder}: ${error.message}`;
          this.errors.push(errorMsg);
          console.error(`[sync] ${errorMsg}`);

          if (this.errors.length >= this.maxErrors) {
            console.error(`[sync] maximum errors reached (${this.maxErrors}). Stopping sync.`);
            break;
          }
        }
      }

    } catch (error) {
      this.errors.push(`Connection error: ${error.message}`);
      console.error(`[sync] IMAP full sync failed for account ${this.accountId}:`, error.message);
    } finally {
      await this.disconnect();
    }

    const totalTime = Math.round((Date.now() - startTime) / 1000);
    console.log(`\n[sync] full sync completed in ${Math.floor(totalTime / 60)}m ${totalTime % 60}s`);

    return {
      totalMessages: this.totalNewMessages,
      errors: this.errors,
      timeElapsed: totalTime,
      processedMessages: this.processedMessages
    };
  }
}

module.exports = { ImapSyncService };
