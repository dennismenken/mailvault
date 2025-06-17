-- Add UID column to emails table
ALTER TABLE emails ADD COLUMN uid INTEGER;

-- Create index for folder + uid
CREATE INDEX emails_folder_uid_idx ON emails(folder, uid);

-- Create sync_state table
CREATE TABLE IF NOT EXISTS sync_state (
    id TEXT PRIMARY KEY,
    folder TEXT UNIQUE NOT NULL,
    uidValidity INTEGER,
    highestUid INTEGER NOT NULL DEFAULT 0,
    lastSyncAt DATETIME,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
);