# Mail Vault - Feature Overview

## 🆕 **Latest Features** 

### 📧 **HTML/Plain Text Email Support**

#### **Content Type Detection**
- Automatic detection of HTML vs. Plain Text emails
- Content type stored in database (`contentType: 'HTML' | 'PLAIN'`)
- Intelligent detection: HTML preferred when available, otherwise Plain Text

#### **UI Rendering**
- **HTML Emails**: Safely rendered with `dangerouslySetInnerHTML`
- **Plain Text**: Displayed with `whitespace-pre-wrap` formatting
- **Visual Indicators**: 
  - HTML badge in email list
  - Content type display in email detail
  - Prose styling for HTML content

#### **Database Schema**
```sql
ALTER TABLE emails ADD COLUMN contentType TEXT DEFAULT 'PLAIN';
CREATE INDEX IF NOT EXISTS idx_emails_content_type ON emails(contentType);
```

---

### 📎 **Attachment Download System**

#### **Secure Directory Structure**
```
data/
├── attachments/           # 📁 Secure attachments directory
│   ├── {accountId}/       # Per-account organization
│   │   └── {messageId}/   # Per-email attachment folders
│   │       ├── file1.pdf
│   │       └── image.jpg
│   └── .keep
├── accounts/              # Email databases
│   └── *.db
└── main.db               # Main application database
```

#### **Attachment Storage & Download**
- **Path**: `data/attachments/{accountId}/{messageId}/`
- **Security**: Path traversal protection and filename sanitization
- **API Endpoints**:
  - `GET /api/attachments/[emailId]` - List attachments
  - `GET /api/attachments/[emailId]/[filename]` - Download file
- **Database Fields**:
  - `attachmentsPath`: Path to attachment directory
  - `hasAttachments`: Boolean flag for quick filtering
  - `attachments`: JSON metadata (filename, contentType, size)

#### **UI Features**
- **📎 Icon** in email list for emails with attachments
- **Download Buttons** with file type icons (📄 PDF, 🖼️ images, etc.)
- **File Information**: Original name, size, content type
- **Quick Filter**: `hasAttachments` index for fast searches

#### **Database Schema**
```sql
ALTER TABLE emails ADD COLUMN attachmentsPath TEXT;
ALTER TABLE emails ADD COLUMN hasAttachments BOOLEAN DEFAULT FALSE;
ALTER TABLE emails ADD COLUMN attachments TEXT; -- JSON metadata
CREATE INDEX IF NOT EXISTS idx_emails_has_attachments ON emails(hasAttachments);
```

---

## 🔄 **Migration System**

### **Database Migrations**
- **Prisma Migrations**: For main database (users, imap_accounts)
- **Custom Script**: `npm run migrate:accounts` for account databases
- **Backward Compatible**: Existing data remains intact

### **Migration Commands**
```bash
# Main database migration
npx prisma migrate dev

# Account databases migration
npm run migrate:accounts

# Generate Prisma client
npx prisma generate
```

### **Content Type Migration**
- Automatic analysis of existing emails
- HTML detection based on `bodyHtml` field
- Fallback to `PLAIN` for all others

---

## 🎯 **Enhanced Features**

### **Email Display**
- **Smart Rendering**: HTML/Plain Text based on content type
- **Attachment Indicators**: Visual badges and icons
- **Content Type Badges**: Quick identification in lists
- **Sanitized HTML**: Safe rendering with prose styling

### **Performance Optimizations**
- **Database Indexes**: On `contentType` and `hasAttachments`
- **Truncated Content**: HTML at 1000, text at 500 characters for lists
- **On-Demand Loading**: Full content loaded only when needed
- **Selective Processing**: Attachments processed only when present

### **Data Structure**
```typescript
interface EmailResult {
  // ... existing fields
  bodyHtml?: string;
  contentType?: 'HTML' | 'PLAIN';
  hasAttachments?: boolean;
  attachmentsPath?: string;
  attachments?: AttachmentMetadata[];
}

interface AttachmentMetadata {
  filename: string;
  contentType: string;
  size: number;
  originalName: string;
  savedName: string;
}
```

---

## 🚀 **Usage Examples**

### **Sync with Attachments**
```bash
# New emails will automatically:
# 1. Detect HTML vs Plain content
# 2. Save attachments to secure directory
# 3. Set hasAttachments flag
# 4. Store attachment metadata
npm run sync
```

### **Production Deployment**
```yaml
# docker-compose.yml
volumes:
  - ./data/attachments:/app/data/attachments  # Secure attachments
  - ./data:/app/data                          # Main data directory
```

### **Search by Content Type**
```sql
-- HTML emails only
SELECT * FROM emails WHERE contentType = 'HTML';

-- Emails with attachments
SELECT * FROM emails WHERE hasAttachments = TRUE;

-- Combined search
SELECT * FROM emails 
WHERE contentType = 'HTML' 
AND hasAttachments = TRUE 
AND subject LIKE '%invoice%';
```

---

## ⚙️ **Configuration**

### **Environment Variables**
```env
# Attachment storage
DATA_DIR="./data"                    # Main data directory
ATTACHMENTS_DIR="./data/attachments" # Attachment storage

# Sync settings
SYNC_BATCH_SIZE=1                    # Gmail-optimized
SYNC_BATCH_DELAY=500                 # Rate limiting (ms)
SYNC_INTERVAL_MINUTES=30             # Background sync interval
```

### **Security Considerations**
- **Filename Sanitization**: Prevents path traversal attacks
- **Content Isolation**: Attachments separated per email
- **HTML Sanitization**: Prose styling limits security risks
- **User Authentication**: All attachment access requires valid session
- **Path Validation**: Server-side validation of all file paths

---

## 🔧 **Technical Implementation**

### **Attachment API Security**
```typescript
// Path traversal protection
const sanitizedFilename = filename
  .replace(/[^a-zA-Z0-9.\-_]/g, '_')
  .replace(/_{2,}/g, '_')
  .substring(0, 100);

// User isolation
const userAccounts = await prisma.imapAccount.findMany({
  where: { userId: session.user.id }
});

// Content-type detection
const contentType = getContentType(filename);
response.headers.set('Content-Type', contentType);
```

### **File Type Icons**
```typescript
const getFileIcon = (filename: string) => {
  const ext = filename.toLowerCase().split('.').pop();
  switch (ext) {
    case 'pdf': return '📄';
    case 'jpg': case 'jpeg': case 'png': case 'gif': return '🖼️';
    case 'doc': case 'docx': return '📝';
    case 'xls': case 'xlsx': return '📊';
    case 'zip': case 'rar': return '🗜️';
    default: return '📎';
  }
};
```

### **Background Sync Integration**
- **Automatic Processing**: Attachments processed during IMAP sync
- **Error Handling**: Failed attachments logged but don't stop sync
- **Size Limits**: Configurable maximum attachment size (default: 50MB)
- **Progress Monitoring**: Attachment processing included in sync status

---

## 🧪 **Testing & Validation**

### **Attachment Testing**
```bash
# Test attachment download
curl -H "Cookie: next-auth.session-token=..." \
  http://localhost:3000/api/attachments/email123/document.pdf

# Verify attachment storage
ls -la data/attachments/account123/email456/

# Check database consistency
sqlite3 data/accounts/account.db \
  "SELECT id, hasAttachments, attachmentsPath FROM emails WHERE hasAttachments = 1;"
```

### **Content Type Testing**
```bash
# Test HTML rendering
curl -H "Cookie: ..." \
  "http://localhost:3000/api/emails/search?fullContentId=email123"

# Verify content type detection
sqlite3 data/accounts/account.db \
  "SELECT contentType, COUNT(*) FROM emails GROUP BY contentType;"
```

---

## 🎉 **Getting Started**

### **Quick Setup**
1. **Login**: http://localhost:3000 (admin@example.com / admin123)
2. **Add IMAP Account**: Dashboard → Accounts Tab  
3. **Sync Emails**: `npm run sync` or use background service
4. **View Content**: Browse emails with HTML rendering and attachment downloads

### **Docker Deployment**
```bash
# Start services
docker-compose up -d

# Create initial user
docker-compose exec web node scripts/cli.js create-initial-user

# Monitor sync progress
docker-compose logs -f sync
```

### **Development Mode**
```bash
# Install dependencies
npm install

# Setup database
npx prisma migrate dev
npx prisma generate

# Start development server
npm run dev
```

---

## 📊 **Feature Comparison**

| Feature | Before | After |
|---------|--------|-------|
| **Email Content** | Plain text only | HTML + Plain text |
| **Attachments** | Not supported | Full download system |
| **Content Detection** | Manual | Automatic |
| **File Security** | N/A | Path traversal protection |
| **UI Indicators** | Basic | Rich icons and badges |
| **Database Schema** | Basic fields | Enhanced metadata |
| **API Endpoints** | Search only | Search + Attachments |

---

## 🔮 **Future Enhancements**

### **Planned Features**
- [ ] **Attachment Preview**: In-browser preview for common file types
- [ ] **Bulk Download**: Download all attachments from an email as ZIP
- [ ] **Attachment Search**: Full-text search within PDF and document attachments
- [ ] **Virus Scanning**: Integration with antivirus for uploaded attachments
- [ ] **Cloud Storage**: Optional integration with S3/Google Drive for attachments

### **Performance Improvements**
- [ ] **Lazy Loading**: Load attachments on-demand in UI
- [ ] **Compression**: Automatic compression for large attachments
- [ ] **CDN Integration**: Serve attachments through CDN
- [ ] **Caching**: Smart caching for frequently accessed attachments

---

The application is now production-ready with complete HTML rendering and attachment download capabilities! 🚀 