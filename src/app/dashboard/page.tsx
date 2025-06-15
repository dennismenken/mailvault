'use client';

import { useState, useEffect } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Search, Mail, User, Settings, LogOut, Plus, Calendar, Filter, Users, Server, CheckCircle, XCircle, Clock, AlertTriangle, ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { toast } from 'sonner';

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

interface AttachmentInfo {
  filename: string;
  originalName: string;
  size: number;
  contentType: string;
  downloadUrl: string;
}

interface SearchResponse {
  emails: EmailResult[];
  totalCount: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface User {
  id: string;
  email: string;
  name?: string;
  createdAt: string;
  _count: {
    imapAccounts: number;
  };
}

interface ImapAccount {
  id: string;
  email: string;
  imapServer: string;
  imapPort: number;
  useTls: boolean;
  isActive: boolean;
  syncEnabled: boolean;
  lastSyncAt?: string;
  errorMessage?: string;
  errorCount: number;
  createdAt: string;
}

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  
  // Email search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<EmailResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [selectedEmail, setSelectedEmail] = useState<EmailResult | null>(null);
  const [isLoadingEmail, setIsLoadingEmail] = useState(false);
  const [attachments, setAttachments] = useState<AttachmentInfo[]>([]);
  const [isLoadingAttachments, setIsLoadingAttachments] = useState(false);

  // User management state
  const [users, setUsers] = useState<User[]>([]);
  const [isCreateUserOpen, setIsCreateUserOpen] = useState(false);
  const [newUser, setNewUser] = useState({ email: '', password: '', name: '' });

  // IMAP account management state
  const [imapAccounts, setImapAccounts] = useState<ImapAccount[]>([]);
  const [isCreateAccountOpen, setIsCreateAccountOpen] = useState(false);
  const [newAccount, setNewAccount] = useState({
    email: '',
    imapServer: '',
    imapPort: 993,
    imapUsername: '',
    imapPassword: '',
    useTls: true,
  });

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  useEffect(() => {
    if (session) {
      handleSearch('', 1);
      loadUsers();
      loadImapAccounts();
    }
  }, [session]);

  // Email search functions
  const handleSearch = async (query: string = searchQuery, page: number = 1) => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        ...(query && { query }),
        page: page.toString(),
        limit: '20',
      });

      const response = await fetch(`/api/emails/search?${params}`);
      if (!response.ok) {
        throw new Error('Search failed');
      }

      const data: SearchResponse = await response.json();
      setSearchResults(data.emails);
      setTotalCount(data.totalCount);
      setCurrentPage(data.page);
      setTotalPages(data.totalPages);
    } catch (error) {
      toast.error('Failed to search emails');
      console.error('Search error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // User management functions
  const loadUsers = async () => {
    try {
      const response = await fetch('/api/users');
      if (response.ok) {
        const data = await response.json();
        setUsers(data.users);
      }
    } catch (error) {
      console.error('Failed to load users:', error);
    }
  };

  const handleCreateUser = async () => {
    try {
      const response = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newUser),
      });

      if (response.ok) {
        toast.success('User created successfully');
        setIsCreateUserOpen(false);
        setNewUser({ email: '', password: '', name: '' });
        loadUsers();
      } else {
        const error = await response.json();
        toast.error(error.message || 'Failed to create user');
      }
    } catch (error) {
      toast.error('Failed to create user');
    }
  };

  // IMAP account management functions
  const loadImapAccounts = async () => {
    try {
      const response = await fetch('/api/imap-accounts');
      if (response.ok) {
        const data = await response.json();
        setImapAccounts(data.accounts);
      }
    } catch (error) {
      console.error('Failed to load IMAP accounts:', error);
    }
  };

  const handleCreateAccount = async () => {
    try {
      const response = await fetch('/api/imap-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newAccount),
      });

      if (response.ok) {
        toast.success('IMAP account created successfully');
        setIsCreateAccountOpen(false);
        setNewAccount({
          email: '',
          imapServer: '',
          imapPort: 993,
          imapUsername: '',
          imapPassword: '',
          useTls: true,
        });
        loadImapAccounts();
      } else {
        const error = await response.json();
        toast.error(error.message || 'Failed to create IMAP account');
      }
    } catch (error) {
      toast.error('Failed to create IMAP account');
    }
  };

  // Utility functions
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      setCurrentPage(1); // Reset to first page for new search
      handleSearch(searchQuery, 1);
    }
  };

  // Function to load full email content when opening modal
  const handleEmailClick = async (email: EmailResult) => {
    setIsLoadingEmail(true);
    setAttachments([]);
    
    try {
      const response = await fetch(`/api/emails/search?fullContentId=${email.id}`);
      if (response.ok) {
        const data = await response.json();
        if (data.emails && data.emails.length > 0) {
          const fullEmail = data.emails[0];
          setSelectedEmail(fullEmail);
          
          // Load attachments if email has them
          if (fullEmail.hasAttachments) {
            loadAttachments(fullEmail.id);
          }
        } else {
          // Fallback to truncated version if no email found
          setSelectedEmail(email);
          toast.error('Could not load full email content');
        }
      } else {
        // Fallback to truncated version if API fails
        setSelectedEmail(email);
        toast.error('Could not load full email content');
      }
    } catch (error) {
      console.error('Error loading email:', error);
      setSelectedEmail(email);
      toast.error('Could not load full email content');
    } finally {
      setIsLoadingEmail(false);
    }
  };

  const loadAttachments = async (emailId: string) => {
    setIsLoadingAttachments(true);
    try {
      const response = await fetch(`/api/attachments/${emailId}`);
      if (response.ok) {
        const data = await response.json();
        setAttachments(data.attachments || []);
      } else {
        console.error('Failed to fetch attachments');
        setAttachments([]);
      }
    } catch (error) {
      console.error('Error fetching attachments:', error);
      setAttachments([]);
    } finally {
      setIsLoadingAttachments(false);
    }
  };

  const handleDownloadAttachment = (attachment: AttachmentInfo) => {
    // Create a temporary link and trigger download
    const link = document.createElement('a');
    link.href = attachment.downloadUrl;
    link.download = attachment.originalName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'Unknown';
    try {
      const date = new Date(dateString);
      return date.toLocaleString();
    } catch {
      return 'Invalid date';
    }
  };

  const formatSize = (bytes?: number) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const truncateText = (text: string, maxLength: number) => {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  };

  const getAccountStatusIcon = (account: ImapAccount) => {
    if (!account.isActive) return <XCircle className="h-4 w-4 text-red-500" />;
    if (!account.syncEnabled) return <Clock className="h-4 w-4 text-yellow-500" />;
    if (account.errorCount > 0) return <AlertTriangle className="h-4 w-4 text-orange-500" />;
    return <CheckCircle className="h-4 w-4 text-green-500" />;
  };

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  if (!session) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <Mail className="h-8 w-8 text-blue-600 mr-3" />
              <h1 className="text-xl font-semibold text-gray-900">Mail Vault</h1>
            </div>
            <div className="flex items-center space-x-4">
              <div className="flex items-center text-sm text-gray-600">
                <User className="h-4 w-4 mr-1" />
                {session.user.email}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => signOut()}
                className="flex items-center"
              >
                <LogOut className="h-4 w-4 mr-2" />
                Sign Out
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Tabs defaultValue="search" className="space-y-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="search" className="flex items-center">
              <Search className="h-4 w-4 mr-2" />
              Search Emails
            </TabsTrigger>
            <TabsTrigger value="accounts" className="flex items-center">
              <Server className="h-4 w-4 mr-2" />
              IMAP Accounts
            </TabsTrigger>
            <TabsTrigger value="users" className="flex items-center">
              <Users className="h-4 w-4 mr-2" />
              Users
            </TabsTrigger>
            <TabsTrigger value="settings" className="flex items-center">
              <Settings className="h-4 w-4 mr-2" />
              Settings
            </TabsTrigger>
          </TabsList>

          {/* Email Search Tab */}
          <TabsContent value="search" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  <Search className="h-5 w-5 mr-2" />
                  Search Emails
                </CardTitle>
                <CardDescription>
                  Search across all your email accounts
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex space-x-2">
                  <div className="flex-1 relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <Input
                      placeholder="Search emails by subject, content, or sender..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyPress={handleKeyPress}
                      className="pl-10"
                    />
                  </div>
                  <Button 
                    onClick={() => {
                      setCurrentPage(1);
                      handleSearch(searchQuery, 1);
                    }}
                    disabled={isLoading}
                  >
                    {isLoading ? 'Searching...' : 'Search'}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Search Results</CardTitle>
                <CardDescription>
                  {totalCount > 0 ? `Found ${totalCount} emails` : 'No emails found'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {searchResults.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    {isLoading ? 'Loading...' : 'No emails to display'}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {searchResults.map((email) => (
                      <div
                        key={email.id}
                        className="border rounded-lg p-4 hover:bg-gray-50 cursor-pointer transition-colors"
                        onClick={() => handleEmailClick(email)}
                      >
                        <div className="flex flex-col lg:flex-row lg:justify-between lg:items-start mb-3">
                          <div className="flex-1 min-w-0 mb-2 lg:mb-0">
                            <h3 className="font-semibold text-gray-900 truncate">
                              {email.subject || '(No subject)'}
                            </h3>
                            <div className="flex items-center text-sm text-gray-600 mt-1">
                              <span className="font-medium truncate">
                                {email.fromName || email.fromAddress}
                              </span>
                              {email.fromName && email.fromAddress && (
                                <span className="ml-1 text-xs text-gray-500 truncate">
                                  ({email.fromAddress})
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex flex-col lg:items-end text-sm text-gray-500">
                            <span className="mb-2">{formatDate(email.date)}</span>
                            <div className="flex flex-wrap items-center gap-1">
                              <Badge variant="secondary" className="text-xs">
                                {email.folder}
                              </Badge>
                              <Badge variant="outline" className="text-xs">
                                {email.accountEmail}
                              </Badge>
                              {email.hasAttachments && (
                                <Badge variant="outline" className="text-xs bg-yellow-50">
                                  📎
                                </Badge>
                              )}
                              {email.contentType === 'HTML' && (
                                <Badge variant="outline" className="text-xs bg-blue-50">
                                  HTML
                                </Badge>
                              )}
                              {email.size && (
                                <span className="text-xs bg-gray-100 px-2 py-1 rounded">
                                  {formatSize(email.size)}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        {email.bodyText && (
                          <div className="bg-gray-50 p-3 rounded-md mt-3">
                            <p className="text-sm text-gray-700 leading-relaxed">
                              {truncateText(email.bodyText, 300)}
                            </p>
                          </div>
                        )}
                      </div>
                    ))}

                    {/* Pagination Controls */}
                    {totalPages > 1 && (
                      <div className="flex items-center justify-between mt-6 pt-4 border-t">
                        <div className="text-sm text-gray-600">
                          Showing {((currentPage - 1) * 20) + 1} to {Math.min(currentPage * 20, totalCount)} of {totalCount} emails
                        </div>
                        <div className="flex items-center space-x-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleSearch(searchQuery, Math.max(1, currentPage - 1))}
                            disabled={currentPage <= 1 || isLoading}
                            className="flex items-center"
                          >
                            <ChevronLeft className="h-4 w-4 mr-1" />
                            Previous
                          </Button>
                          
                          <div className="flex items-center space-x-1">
                            {/* Show page numbers */}
                            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                              let pageNum;
                              if (totalPages <= 5) {
                                pageNum = i + 1;
                              } else if (currentPage <= 3) {
                                pageNum = i + 1;
                              } else if (currentPage >= totalPages - 2) {
                                pageNum = totalPages - 4 + i;
                              } else {
                                pageNum = currentPage - 2 + i;
                              }
                              
                              return (
                                <Button
                                  key={pageNum}
                                  variant={pageNum === currentPage ? "default" : "outline"}
                                  size="sm"
                                  onClick={() => handleSearch(searchQuery, pageNum)}
                                  disabled={isLoading}
                                  className="w-8 h-8 p-0"
                                >
                                  {pageNum}
                                </Button>
                              );
                            })}
                            
                            {totalPages > 5 && currentPage < totalPages - 2 && (
                              <>
                                <span className="text-gray-400">...</span>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleSearch(searchQuery, totalPages)}
                                  disabled={isLoading}
                                  className="w-8 h-8 p-0"
                                >
                                  {totalPages}
                                </Button>
                              </>
                            )}
                          </div>
                          
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleSearch(searchQuery, Math.min(totalPages, currentPage + 1))}
                            disabled={currentPage >= totalPages || isLoading}
                            className="flex items-center"
                          >
                            Next
                            <ChevronRight className="h-4 w-4 ml-1" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* IMAP Accounts Tab */}
          <TabsContent value="accounts" className="space-y-6">
            <Card>
              <CardHeader>
                <div className="flex justify-between items-center">
                  <div>
                    <CardTitle className="flex items-center">
                      <Server className="h-5 w-5 mr-2" />
                      IMAP Accounts
                    </CardTitle>
                    <CardDescription>
                      Manage your email accounts for synchronization
                    </CardDescription>
                  </div>
                  <Dialog open={isCreateAccountOpen} onOpenChange={setIsCreateAccountOpen}>
                    <DialogTrigger asChild>
                      <Button>
                        <Plus className="h-4 w-4 mr-2" />
                        Add Account
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Add IMAP Account</DialogTitle>
                        <DialogDescription>
                          Configure a new email account for synchronization
                        </DialogDescription>
                      </DialogHeader>
                      <div className="grid gap-4 py-4">
                        <div className="grid grid-cols-4 items-center gap-4">
                          <Label htmlFor="email" className="text-right">Email</Label>
                          <Input
                            id="email"
                            value={newAccount.email}
                            onChange={(e) => setNewAccount({...newAccount, email: e.target.value})}
                            className="col-span-3"
                            placeholder="your@email.com"
                          />
                        </div>
                        <div className="grid grid-cols-4 items-center gap-4">
                          <Label htmlFor="server" className="text-right">IMAP Server</Label>
                          <Input
                            id="server"
                            value={newAccount.imapServer}
                            onChange={(e) => setNewAccount({...newAccount, imapServer: e.target.value})}
                            className="col-span-3"
                            placeholder="imap.gmail.com"
                          />
                        </div>
                        <div className="grid grid-cols-4 items-center gap-4">
                          <Label htmlFor="port" className="text-right">Port</Label>
                          <Input
                            id="port"
                            type="number"
                            value={newAccount.imapPort}
                            onChange={(e) => setNewAccount({...newAccount, imapPort: parseInt(e.target.value)})}
                            className="col-span-3"
                          />
                        </div>
                        <div className="grid grid-cols-4 items-center gap-4">
                          <Label htmlFor="username" className="text-right">Username</Label>
                          <Input
                            id="username"
                            value={newAccount.imapUsername}
                            onChange={(e) => setNewAccount({...newAccount, imapUsername: e.target.value})}
                            className="col-span-3"
                            placeholder="Usually your email address"
                          />
                        </div>
                        <div className="grid grid-cols-4 items-center gap-4">
                          <Label htmlFor="password" className="text-right">Password</Label>
                          <Input
                            id="password"
                            type="password"
                            value={newAccount.imapPassword}
                            onChange={(e) => setNewAccount({...newAccount, imapPassword: e.target.value})}
                            className="col-span-3"
                            placeholder="App password for Gmail/Outlook"
                          />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setIsCreateAccountOpen(false)}>
                          Cancel
                        </Button>
                        <Button onClick={handleCreateAccount}>Create Account</Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              </CardHeader>
              <CardContent>
                {imapAccounts.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    No IMAP accounts configured. Add one to start syncing emails.
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Status</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Server</TableHead>
                        <TableHead>Last Sync</TableHead>
                        <TableHead>Errors</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {imapAccounts.map((account) => (
                        <TableRow key={account.id}>
                          <TableCell className="flex items-center space-x-2">
                            {getAccountStatusIcon(account)}
                            <span className="text-sm">
                              {!account.isActive ? 'Inactive' : 
                               !account.syncEnabled ? 'Paused' :
                               account.errorCount > 0 ? 'Errors' : 'Active'}
                            </span>
                          </TableCell>
                          <TableCell>{account.email}</TableCell>
                          <TableCell>{account.imapServer}:{account.imapPort}</TableCell>
                          <TableCell>
                            {account.lastSyncAt ? formatDate(account.lastSyncAt) : 'Never'}
                          </TableCell>
                          <TableCell>
                            {account.errorCount > 0 && (
                              <Badge variant="destructive">{account.errorCount}</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Users Management Tab */}
          <TabsContent value="users" className="space-y-6">
            <Card>
              <CardHeader>
                <div className="flex justify-between items-center">
                  <div>
                    <CardTitle className="flex items-center">
                      <Users className="h-5 w-5 mr-2" />
                      User Management
                    </CardTitle>
                    <CardDescription>
                      Manage system users
                    </CardDescription>
                  </div>
                  <Dialog open={isCreateUserOpen} onOpenChange={setIsCreateUserOpen}>
                    <DialogTrigger asChild>
                      <Button>
                        <Plus className="h-4 w-4 mr-2" />
                        Add User
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Create New User</DialogTitle>
                        <DialogDescription>
                          Add a new user to the system
                        </DialogDescription>
                      </DialogHeader>
                      <div className="grid gap-4 py-4">
                        <div className="grid grid-cols-4 items-center gap-4">
                          <Label htmlFor="user-email" className="text-right">Email</Label>
                          <Input
                            id="user-email"
                            value={newUser.email}
                            onChange={(e) => setNewUser({...newUser, email: e.target.value})}
                            className="col-span-3"
                            placeholder="user@example.com"
                          />
                        </div>
                        <div className="grid grid-cols-4 items-center gap-4">
                          <Label htmlFor="user-name" className="text-right">Name</Label>
                          <Input
                            id="user-name"
                            value={newUser.name}
                            onChange={(e) => setNewUser({...newUser, name: e.target.value})}
                            className="col-span-3"
                            placeholder="Full Name (optional)"
                          />
                        </div>
                        <div className="grid grid-cols-4 items-center gap-4">
                          <Label htmlFor="user-password" className="text-right">Password</Label>
                          <Input
                            id="user-password"
                            type="password"
                            value={newUser.password}
                            onChange={(e) => setNewUser({...newUser, password: e.target.value})}
                            className="col-span-3"
                            placeholder="Secure password"
                          />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setIsCreateUserOpen(false)}>
                          Cancel
                        </Button>
                        <Button onClick={handleCreateUser}>Create User</Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              </CardHeader>
              <CardContent>
                {users.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    No users found.
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>IMAP Accounts</TableHead>
                        <TableHead>Created</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {users.map((user) => (
                        <TableRow key={user.id}>
                          <TableCell>{user.name || 'No name'}</TableCell>
                          <TableCell>{user.email}</TableCell>
                          <TableCell>
                            <Badge variant="secondary">
                              {user._count.imapAccounts} accounts
                            </Badge>
                          </TableCell>
                          <TableCell>{formatDate(user.createdAt)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Settings Tab */}
          <TabsContent value="settings" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  <Settings className="h-5 w-5 mr-2" />
                  Application Settings
                </CardTitle>
                <CardDescription>
                  System configuration and preferences
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="text-sm text-gray-600">
                    <h4 className="font-medium mb-2">Sync Configuration</h4>
                    <p>• Sync interval: {process.env.SYNC_INTERVAL_MINUTES || '30'} minutes</p>
                    <p>• Max errors before account disable: {process.env.MAX_SYNC_ERRORS || '5'}</p>
                    <p>• Data directory: {process.env.DATA_DIR || './data'}</p>
                  </div>
                  <div className="text-sm text-gray-600">
                    <h4 className="font-medium mb-2">System Info</h4>
                    <p>• Total users: {users.length}</p>
                    <p>• Total IMAP accounts: {imapAccounts.length}</p>
                    <p>• Active accounts: {imapAccounts.filter(a => a.isActive).length}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Email Detail Modal */}
        {(selectedEmail || isLoadingEmail) && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50 overflow-hidden">
            <div className="w-full max-w-6xl h-full max-h-[95vh] flex flex-col bg-white rounded-lg shadow-xl">
              {/* Modal Header - Fixed */}
              <div className="flex-shrink-0 px-6 py-4 border-b bg-white rounded-t-lg">
                <div className="flex justify-between items-start">
                  <div className="flex-1 min-w-0">
                    {isLoadingEmail ? (
                      <div className="animate-pulse">
                        <div className="h-6 bg-gray-200 rounded w-3/4 mb-2"></div>
                        <div className="h-4 bg-gray-200 rounded w-1/2"></div>
                      </div>
                    ) : selectedEmail ? (
                      <>
                        <h2 className="text-xl font-semibold text-gray-900 truncate">
                          {selectedEmail.subject || '(No subject)'}
                        </h2>
                        <p className="text-sm text-gray-600 mt-1">
                          From: {selectedEmail.fromName || selectedEmail.fromAddress}
                        </p>
                      </>
                    ) : null}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedEmail(null)}
                    className="ml-4 flex-shrink-0"
                  >
                    ×
                  </Button>
                </div>
              </div>

              {/* Modal Content - Scrollable */}
              <div className="flex-1 overflow-y-auto px-6 py-4">
                {isLoadingEmail ? (
                  <div className="animate-pulse space-y-4">
                    <div className="bg-gray-200 h-32 rounded"></div>
                    <div className="space-y-2">
                      <div className="h-4 bg-gray-200 rounded w-full"></div>
                      <div className="h-4 bg-gray-200 rounded w-5/6"></div>
                      <div className="h-4 bg-gray-200 rounded w-4/6"></div>
                    </div>
                  </div>
                ) : selectedEmail ? (
                  <div className="space-y-4">
                    {/* Email Metadata */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm bg-gray-50 p-4 rounded-lg">
                      <div>
                        <strong>Date:</strong> {formatDate(selectedEmail.date)}
                      </div>
                      <div>
                        <strong>Folder:</strong> {selectedEmail.folder}
                      </div>
                      <div>
                        <strong>Account:</strong> {selectedEmail.accountEmail}
                      </div>
                      <div>
                        <strong>Size:</strong> {formatSize(selectedEmail.size)}
                      </div>
                      <div>
                        <strong>Content Type:</strong> {selectedEmail.contentType || 'PLAIN'}
                      </div>
                      {selectedEmail.hasAttachments && (
                        <div>
                          <strong>Attachments:</strong> 
                          <Badge variant="secondary" className="ml-2">
                            📎 Has attachments
                          </Badge>
                        </div>
                      )}
                    </div>

                    {/* To Recipients */}
                    {selectedEmail.toAddresses && selectedEmail.toAddresses.length > 0 && (
                      <div className="bg-gray-50 p-4 rounded-lg">
                        <strong>To:</strong> {selectedEmail.toAddresses.join(', ')}
                      </div>
                    )}

                    {/* Attachments Section */}
                    {selectedEmail.hasAttachments && (
                      <div className="bg-gray-50 p-4 rounded-lg">
                        <div className="flex items-center justify-between mb-3">
                          <strong className="flex items-center">
                            📎 Attachments ({attachments.length})
                          </strong>
                          {isLoadingAttachments && (
                            <div className="text-sm text-gray-500">Loading...</div>
                          )}
                        </div>
                        
                        {isLoadingAttachments ? (
                          <div className="animate-pulse space-y-2">
                            <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                            <div className="h-4 bg-gray-200 rounded w-1/2"></div>
                          </div>
                        ) : attachments.length > 0 ? (
                          <div className="space-y-2">
                            {attachments.map((attachment, index) => (
                              <div
                                key={index}
                                className="flex items-center justify-between p-3 bg-white rounded border hover:bg-gray-50 transition-colors"
                              >
                                <div className="flex items-center space-x-3 flex-1 min-w-0">
                                  <div className="flex-shrink-0">
                                    {attachment.contentType.startsWith('image/') ? '🖼️' :
                                     attachment.contentType === 'application/pdf' ? '📄' :
                                     attachment.contentType.includes('word') ? '📝' :
                                     attachment.contentType.includes('excel') || attachment.contentType.includes('spreadsheet') ? '📊' :
                                     attachment.contentType.includes('zip') || attachment.contentType.includes('archive') ? '🗜️' :
                                     '📎'}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="font-medium text-sm truncate">
                                      {attachment.originalName}
                                    </div>
                                    <div className="text-xs text-gray-500">
                                      {formatSize(attachment.size)} • {attachment.contentType}
                                    </div>
                                  </div>
                                </div>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleDownloadAttachment(attachment)}
                                  className="flex-shrink-0 ml-3"
                                >
                                  <Download className="h-4 w-4 mr-1" />
                                  Download
                                </Button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-sm text-gray-500">
                            No attachments found
                          </div>
                        )}
                      </div>
                    )}
                    
                    {/* Email Content Display */}
                    {(selectedEmail.bodyText || selectedEmail.bodyHtml) && (
                      <div>
                        <div className="flex items-center justify-between mb-3">
                          <strong className="text-lg">Content:</strong>
                          {selectedEmail.contentType === 'HTML' && selectedEmail.bodyHtml && (
                            <Badge variant="outline" className="bg-blue-50 text-blue-700">
                              HTML Email
                            </Badge>
                          )}
                        </div>
                        
                        {selectedEmail.contentType === 'HTML' && selectedEmail.bodyHtml ? (
                          <div className="border rounded-lg bg-white">
                            <div 
                              className="p-6 prose prose-sm max-w-none overflow-auto"
                              style={{
                                maxHeight: 'none',
                                wordBreak: 'break-word',
                                overflowWrap: 'break-word'
                              }}
                              dangerouslySetInnerHTML={{ __html: selectedEmail.bodyHtml }}
                            />
                          </div>
                        ) : (
                          <div className="border rounded-lg bg-white p-6">
                            <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-gray-800">
                              {selectedEmail.bodyText}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
} 