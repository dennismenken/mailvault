-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "imap_accounts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "imapServer" TEXT NOT NULL,
    "imapPort" INTEGER NOT NULL DEFAULT 993,
    "imapUsername" TEXT NOT NULL,
    "imapPassword" TEXT NOT NULL,
    "useTls" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "syncEnabled" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncAt" DATETIME,
    "dbPath" TEXT NOT NULL,
    "errorMessage" TEXT,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "imap_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "emails" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "messageId" TEXT NOT NULL,
    "subject" TEXT,
    "fromAddress" TEXT,
    "fromName" TEXT,
    "toAddresses" TEXT,
    "ccAddresses" TEXT,
    "bccAddresses" TEXT,
    "bodyText" TEXT,
    "bodyHtml" TEXT,
    "contentType" TEXT NOT NULL DEFAULT 'PLAIN',
    "folder" TEXT NOT NULL,
    "flags" TEXT,
    "date" DATETIME,
    "size" INTEGER,
    "attachments" TEXT,
    "attachmentsPath" TEXT,
    "hasAttachments" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "emails_messageId_key" ON "emails"("messageId");

-- CreateIndex
CREATE INDEX "emails_folder_idx" ON "emails"("folder");

-- CreateIndex
CREATE INDEX "emails_date_idx" ON "emails"("date");

-- CreateIndex
CREATE INDEX "emails_fromAddress_idx" ON "emails"("fromAddress");

-- CreateIndex
CREATE INDEX "emails_subject_idx" ON "emails"("subject");

-- CreateIndex
CREATE INDEX "emails_hasAttachments_idx" ON "emails"("hasAttachments");

-- CreateIndex
CREATE INDEX "emails_contentType_idx" ON "emails"("contentType");
