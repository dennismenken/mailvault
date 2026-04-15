"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import {
  Search,
  Server,
  Users,
  Settings,
  Plus,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Download,
  Paperclip,
  RefreshCw,
  X,
  Inbox,
  FileText,
  Mail,
} from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

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

interface UserRecord {
  id: string;
  email: string;
  name?: string;
  createdAt: string;
  _count: { imapAccounts: number };
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

const PAGE_SIZE = 20;

function formatDate(value?: string) {
  if (!value) return "Unknown";
  try {
    const d = new Date(value);
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "Invalid date";
  }
}

function formatRelative(value?: string) {
  if (!value) return "never";
  const t = new Date(value).getTime();
  if (Number.isNaN(t)) return "never";
  const diff = Date.now() - t;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(value).toLocaleDateString();
}

function formatSize(bytes?: number) {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getInitials(name?: string, email?: string) {
  const source = name?.trim() || email?.split("@")[0] || "?";
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function accountState(account: ImapAccount): {
  label: string;
  tone: "ok" | "warn" | "err" | "idle";
} {
  if (!account.isActive) return { label: "Inactive", tone: "err" };
  if (!account.syncEnabled) return { label: "Paused", tone: "idle" };
  if (account.errorCount > 0) return { label: "Errors", tone: "warn" };
  return { label: "Active", tone: "ok" };
}

function StateDot({ tone }: { tone: "ok" | "warn" | "err" | "idle" }) {
  const color =
    tone === "ok"
      ? "bg-emerald-500"
      : tone === "warn"
        ? "bg-amber-500"
        : tone === "err"
          ? "bg-red-500"
          : "bg-muted-foreground/60";
  return (
    <span className="relative inline-flex">
      <span className={cn("size-2 rounded-full", color)} />
      {tone === "ok" && (
        <span
          className={cn(
            "absolute inset-0 size-2 animate-ping rounded-full opacity-60",
            color,
          )}
        />
      )}
    </span>
  );
}

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  // Email search state
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<"all" | "attachments">(
    "all",
  );
  const [accountFilter, setAccountFilter] = useState<string>("all");
  const [searchResults, setSearchResults] = useState<EmailResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);

  // Detail pane
  const [selectedEmail, setSelectedEmail] = useState<EmailResult | null>(null);
  const [isLoadingEmail, setIsLoadingEmail] = useState(false);
  const [attachments, setAttachments] = useState<AttachmentInfo[]>([]);
  const [isLoadingAttachments, setIsLoadingAttachments] = useState(false);

  // Users / accounts
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [imapAccounts, setImapAccounts] = useState<ImapAccount[]>([]);

  const [isCreateUserOpen, setIsCreateUserOpen] = useState(false);
  const [newUser, setNewUser] = useState({ email: "", password: "", name: "" });

  const [isCreateAccountOpen, setIsCreateAccountOpen] = useState(false);
  const [newAccount, setNewAccount] = useState({
    email: "",
    imapServer: "",
    imapPort: 993,
    imapUsername: "",
    imapPassword: "",
    useTls: true,
  });

  // Sync state
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    }
  }, [status, router]);

  const handleSearch = useCallback(
    async (query: string, page: number) => {
      setIsLoading(true);
      try {
        const params = new URLSearchParams({
          ...(query && { query }),
          page: page.toString(),
          limit: PAGE_SIZE.toString(),
        });
        const response = await fetch(`/api/emails/search?${params}`);
        if (!response.ok) throw new Error("search failed");
        const data: SearchResponse = await response.json();
        setSearchResults(data.emails);
        setTotalCount(data.totalCount);
        setCurrentPage(data.page);
        setTotalPages(data.totalPages);
      } catch (error) {
        console.error("Search error:", error);
        toast.error("Failed to search emails");
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  const loadUsers = useCallback(async () => {
    try {
      const response = await fetch("/api/users");
      if (response.ok) {
        const data = await response.json();
        setUsers(data.users);
      }
    } catch (error) {
      console.error("Failed to load users:", error);
    }
  }, []);

  const loadImapAccounts = useCallback(async () => {
    try {
      const response = await fetch("/api/imap-accounts");
      if (response.ok) {
        const data = await response.json();
        setImapAccounts(data.accounts);
      }
    } catch (error) {
      console.error("Failed to load IMAP accounts:", error);
    }
  }, []);

  useEffect(() => {
    if (session) {
      handleSearch("", 1);
      loadUsers();
      loadImapAccounts();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  const handleCreateUser = async () => {
    try {
      const response = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newUser),
      });
      if (response.ok) {
        toast.success("User created");
        setIsCreateUserOpen(false);
        setNewUser({ email: "", password: "", name: "" });
        loadUsers();
      } else {
        const error = await response.json();
        toast.error(error.message || "Failed to create user");
      }
    } catch (error) {
      console.error("Failed to create user:", error);
      toast.error("Failed to create user");
    }
  };

  const handleCreateAccount = async () => {
    try {
      const response = await fetch("/api/imap-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newAccount),
      });
      if (response.ok) {
        toast.success("Account added");
        setIsCreateAccountOpen(false);
        setNewAccount({
          email: "",
          imapServer: "",
          imapPort: 993,
          imapUsername: "",
          imapPassword: "",
          useTls: true,
        });
        loadImapAccounts();
      } else {
        const error = await response.json();
        toast.error(error.message || "Failed to create account");
      }
    } catch (error) {
      console.error("Failed to create IMAP account:", error);
      toast.error("Failed to create account");
    }
  };

  const handleTriggerSync = async (accountId?: string) => {
    setIsSyncing(true);
    try {
      const response = await fetch("/api/sync/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(accountId ? { accountId } : {}),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        toast.success(
          accountId ? "Sync queued for account" : "Sync queued for all accounts",
        );
      } else {
        toast.error(data?.message || "Sync trigger failed");
      }
    } catch (error) {
      console.error("Sync trigger failed:", error);
      toast.error("Sync trigger failed");
    } finally {
      setIsSyncing(false);
      loadImapAccounts();
    }
  };

  const handleEmailClick = async (email: EmailResult) => {
    setIsLoadingEmail(true);
    setAttachments([]);
    setSelectedEmail(email);
    try {
      const response = await fetch(
        `/api/emails/search?fullContentId=${email.id}`,
      );
      if (response.ok) {
        const data = await response.json();
        if (data.emails && data.emails.length > 0) {
          const fullEmail = data.emails[0];
          setSelectedEmail(fullEmail);
          if (fullEmail.hasAttachments) {
            loadAttachments(fullEmail.id);
          }
        }
      }
    } catch (error) {
      console.error("Error loading email:", error);
      toast.error("Could not load full email");
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
        setAttachments([]);
      }
    } catch (error) {
      console.error("Error fetching attachments:", error);
      setAttachments([]);
    } finally {
      setIsLoadingAttachments(false);
    }
  };

  const handleDownloadAttachment = (attachment: AttachmentInfo) => {
    const link = document.createElement("a");
    link.href = attachment.downloadUrl;
    link.download = attachment.originalName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const onSearchKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      setCurrentPage(1);
      handleSearch(searchQuery, 1);
    }
  };

  // Client-side post-filter for chips (server search drives the page result set;
  // chips refine within the returned page).
  const filteredResults = useMemo(() => {
    let list = searchResults;
    if (activeFilter === "attachments") {
      list = list.filter((e) => e.hasAttachments);
    }
    if (accountFilter !== "all") {
      list = list.filter((e) => e.accountEmail === accountFilter);
    }
    return list;
  }, [searchResults, activeFilter, accountFilter]);

  const accountHealth = useMemo(() => {
    const total = imapAccounts.length;
    const ok = imapAccounts.filter(
      (a) => a.isActive && a.syncEnabled && a.errorCount === 0,
    ).length;
    const warn = imapAccounts.filter(
      (a) => a.isActive && a.errorCount > 0,
    ).length;
    const off = imapAccounts.filter((a) => !a.isActive).length;
    return { total, ok, warn, off };
  }, [imapAccounts]);

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
        <span className="font-mono text-xs uppercase tracking-[0.18em]">
          Loading vault
        </span>
      </div>
    );
  }
  if (!session) return null;

  return (
    <AppShell>
      <Tabs defaultValue="search" className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <TabsList className="h-10 bg-secondary/50 p-1">
            <TabsTrigger value="search" className="gap-2">
              <Inbox className="size-3.5" />
              Archive
            </TabsTrigger>
            <TabsTrigger value="accounts" className="gap-2">
              <Server className="size-3.5" />
              Accounts
            </TabsTrigger>
            <TabsTrigger value="users" className="gap-2">
              <Users className="size-3.5" />
              Users
            </TabsTrigger>
            <TabsTrigger value="settings" className="gap-2">
              <Settings className="size-3.5" />
              Settings
            </TabsTrigger>
          </TabsList>

          <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <StateDot tone="ok" />
              {accountHealth.ok} active
            </span>
            {accountHealth.warn > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <StateDot tone="warn" />
                {accountHealth.warn} warn
              </span>
            )}
            {accountHealth.off > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <StateDot tone="err" />
                {accountHealth.off} off
              </span>
            )}
          </div>
        </div>

        {/* ---------------- Archive (Search) ---------------- */}
        <TabsContent value="search" className="space-y-5">
          {/* Search bar */}
          <div className="relative overflow-hidden rounded-xl border border-border/80 bg-card">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-vault-grid-fine opacity-50"
            />
            <div className="relative flex items-center gap-3 px-4 py-3 sm:px-5">
              <Search className="size-4 text-muted-foreground" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={onSearchKey}
                placeholder="Search subject, body, sender..."
                className="h-9 w-full bg-transparent text-base text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
              />
              <kbd className="hidden h-6 items-center rounded border border-border bg-secondary px-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground sm:inline-flex">
                Enter
              </kbd>
              <Button
                onClick={() => {
                  setCurrentPage(1);
                  handleSearch(searchQuery, 1);
                }}
                disabled={isLoading}
                size="sm"
                className="h-9 px-4"
              >
                {isLoading ? "Searching" : "Search"}
              </Button>
            </div>

            {/* Filter chips */}
            <div className="relative flex items-center gap-2 overflow-x-auto border-t border-border/60 px-4 py-2.5 text-xs sm:px-5">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                Filter
              </span>
              {(
                [
                  { id: "all", label: "All" },
                  { id: "attachments", label: "With attachments" },
                ] as const
              ).map((c) => (
                <button
                  key={c.id}
                  onClick={() => setActiveFilter(c.id)}
                  className={cn(
                    "inline-flex h-7 items-center rounded-full border px-3 text-xs transition-colors",
                    activeFilter === c.id
                      ? "border-vault bg-vault-muted text-foreground"
                      : "border-border bg-background text-muted-foreground hover:text-foreground",
                  )}
                >
                  {c.label}
                </button>
              ))}
              <span className="mx-2 h-4 w-px bg-border" />
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                Account
              </span>
              <button
                onClick={() => setAccountFilter("all")}
                className={cn(
                  "inline-flex h-7 items-center rounded-full border px-3 text-xs transition-colors",
                  accountFilter === "all"
                    ? "border-vault bg-vault-muted text-foreground"
                    : "border-border bg-background text-muted-foreground hover:text-foreground",
                )}
              >
                All accounts
              </button>
              {imapAccounts.map((a) => (
                <button
                  key={a.id}
                  onClick={() => setAccountFilter(a.email)}
                  className={cn(
                    "inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs transition-colors",
                    accountFilter === a.email
                      ? "border-vault bg-vault-muted text-foreground"
                      : "border-border bg-background text-muted-foreground hover:text-foreground",
                  )}
                >
                  <StateDot tone={accountState(a).tone} />
                  {a.email}
                </button>
              ))}
              <span className="ml-auto" />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleTriggerSync()}
                disabled={isSyncing}
                className="h-7 gap-1.5 px-2 font-mono text-[10px] uppercase tracking-[0.18em]"
              >
                <RefreshCw
                  className={cn("size-3", isSyncing && "animate-spin")}
                />
                Sync now
              </Button>
            </div>
          </div>

          {/* Results + detail split */}
          <div className="grid gap-5 lg:grid-cols-[minmax(0,_1fr)_minmax(0,_1.1fr)]">
            <ResultsList
              results={filteredResults}
              isLoading={isLoading}
              totalCount={totalCount}
              currentPage={currentPage}
              totalPages={totalPages}
              onSelect={handleEmailClick}
              selectedId={selectedEmail?.id}
              onPage={(p) => handleSearch(searchQuery, p)}
            />
            <DetailPane
              email={selectedEmail}
              isLoadingEmail={isLoadingEmail}
              attachments={attachments}
              isLoadingAttachments={isLoadingAttachments}
              onClose={() => setSelectedEmail(null)}
              onDownload={handleDownloadAttachment}
            />
          </div>
        </TabsContent>

        {/* ---------------- Accounts ---------------- */}
        <TabsContent value="accounts" className="space-y-5">
          <div className="rounded-xl border border-border/80 bg-card p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-display text-lg font-medium tracking-tight">
                  IMAP accounts
                </h2>
                <p className="text-sm text-muted-foreground">
                  Mailboxes synchronised into the vault.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleTriggerSync()}
                  disabled={isSyncing}
                  className="gap-1.5"
                >
                  <RefreshCw
                    className={cn("size-3.5", isSyncing && "animate-spin")}
                  />
                  Sync all
                </Button>
                <Dialog
                  open={isCreateAccountOpen}
                  onOpenChange={setIsCreateAccountOpen}
                >
                  <DialogTrigger asChild>
                    <Button size="sm" className="gap-1.5">
                      <Plus className="size-3.5" />
                      Add account
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Add IMAP account</DialogTitle>
                      <DialogDescription>
                        Connect a mailbox for ongoing synchronisation.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-2">
                      <FormRow
                        id="email"
                        label="Email"
                        value={newAccount.email}
                        onChange={(v) =>
                          setNewAccount({ ...newAccount, email: v })
                        }
                        placeholder="you@example.com"
                      />
                      <FormRow
                        id="server"
                        label="IMAP server"
                        value={newAccount.imapServer}
                        onChange={(v) =>
                          setNewAccount({ ...newAccount, imapServer: v })
                        }
                        placeholder="imap.example.com"
                      />
                      <FormRow
                        id="port"
                        label="Port"
                        type="number"
                        value={String(newAccount.imapPort)}
                        onChange={(v) =>
                          setNewAccount({
                            ...newAccount,
                            imapPort: parseInt(v) || 993,
                          })
                        }
                      />
                      <FormRow
                        id="username"
                        label="Username"
                        value={newAccount.imapUsername}
                        onChange={(v) =>
                          setNewAccount({ ...newAccount, imapUsername: v })
                        }
                        placeholder="Usually your email"
                      />
                      <FormRow
                        id="password"
                        label="Password"
                        type="password"
                        value={newAccount.imapPassword}
                        onChange={(v) =>
                          setNewAccount({ ...newAccount, imapPassword: v })
                        }
                        placeholder="App password recommended"
                      />
                    </div>
                    <DialogFooter>
                      <Button
                        variant="outline"
                        onClick={() => setIsCreateAccountOpen(false)}
                      >
                        Cancel
                      </Button>
                      <Button onClick={handleCreateAccount}>
                        Create account
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </div>

            <div className="hr-fade my-4" />

            {imapAccounts.length === 0 ? (
              <EmptyState
                icon={<Server className="size-5" />}
                title="No accounts configured"
                hint="Add an IMAP mailbox to begin archiving."
                action={
                  <Button
                    size="sm"
                    onClick={() => setIsCreateAccountOpen(true)}
                  >
                    <Plus className="size-3.5" />
                    Add account
                  </Button>
                }
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                      Status
                    </TableHead>
                    <TableHead className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                      Email
                    </TableHead>
                    <TableHead className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                      Server
                    </TableHead>
                    <TableHead className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                      Last sync
                    </TableHead>
                    <TableHead className="text-right font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                      Action
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {imapAccounts.map((account) => {
                    const s = accountState(account);
                    return (
                      <TableRow key={account.id}>
                        <TableCell>
                          <div className="inline-flex items-center gap-2">
                            <StateDot tone={s.tone} />
                            <span className="text-sm">{s.label}</span>
                            {account.errorCount > 0 && (
                              <Badge
                                variant="destructive"
                                className="ml-1 px-1.5 py-0 text-[10px]"
                              >
                                {account.errorCount}
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="font-medium">
                          {account.email}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {account.imapServer}:{account.imapPort}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatRelative(account.lastSyncAt)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={isSyncing}
                            onClick={() => handleTriggerSync(account.id)}
                            className="gap-1.5"
                          >
                            <RefreshCw
                              className={cn(
                                "size-3.5",
                                isSyncing && "animate-spin",
                              )}
                            />
                            Sync
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </div>
        </TabsContent>

        {/* ---------------- Users ---------------- */}
        <TabsContent value="users" className="space-y-5">
          <div className="rounded-xl border border-border/80 bg-card p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-display text-lg font-medium tracking-tight">
                  Users
                </h2>
                <p className="text-sm text-muted-foreground">
                  Operators with access to the vault.
                </p>
              </div>
              <Dialog
                open={isCreateUserOpen}
                onOpenChange={setIsCreateUserOpen}
              >
                <DialogTrigger asChild>
                  <Button size="sm" className="gap-1.5">
                    <Plus className="size-3.5" />
                    Add user
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Create user</DialogTitle>
                    <DialogDescription>
                      Add a new operator to the system.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="grid gap-4 py-2">
                    <FormRow
                      id="user-email"
                      label="Email"
                      value={newUser.email}
                      onChange={(v) => setNewUser({ ...newUser, email: v })}
                      placeholder="user@example.com"
                    />
                    <FormRow
                      id="user-name"
                      label="Name"
                      value={newUser.name}
                      onChange={(v) => setNewUser({ ...newUser, name: v })}
                      placeholder="Optional"
                    />
                    <FormRow
                      id="user-password"
                      label="Password"
                      type="password"
                      value={newUser.password}
                      onChange={(v) => setNewUser({ ...newUser, password: v })}
                      placeholder="Secure password"
                    />
                  </div>
                  <DialogFooter>
                    <Button
                      variant="outline"
                      onClick={() => setIsCreateUserOpen(false)}
                    >
                      Cancel
                    </Button>
                    <Button onClick={handleCreateUser}>Create user</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>

            <div className="hr-fade my-4" />

            {users.length === 0 ? (
              <EmptyState
                icon={<Users className="size-5" />}
                title="No users yet"
                hint="Add an operator to share access."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                      User
                    </TableHead>
                    <TableHead className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                      Email
                    </TableHead>
                    <TableHead className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                      Mailboxes
                    </TableHead>
                    <TableHead className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                      Created
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <span className="flex size-7 items-center justify-center rounded-full border border-border bg-secondary text-[11px] font-medium">
                            {getInitials(u.name, u.email)}
                          </span>
                          <span className="font-medium">
                            {u.name || "Unnamed"}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {u.email}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {u._count.imapAccounts}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(u.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </TabsContent>

        {/* ---------------- Settings ---------------- */}
        <TabsContent value="settings" className="space-y-5">
          <div className="grid gap-5 md:grid-cols-2">
            <SettingsBlock title="Sync configuration">
              <SettingRow
                label="Sync interval"
                value={`${process.env.NEXT_PUBLIC_SYNC_INTERVAL_MINUTES || "30"} min`}
              />
              <SettingRow
                label="Max errors"
                value={process.env.NEXT_PUBLIC_MAX_SYNC_ERRORS || "5"}
              />
              <SettingRow
                label="Data directory"
                value={process.env.NEXT_PUBLIC_DATA_DIR || "./data"}
              />
            </SettingsBlock>
            <SettingsBlock title="Vault status">
              <SettingRow label="Total users" value={String(users.length)} />
              <SettingRow
                label="Total mailboxes"
                value={String(imapAccounts.length)}
              />
              <SettingRow
                label="Active mailboxes"
                value={String(
                  imapAccounts.filter((a) => a.isActive).length,
                )}
              />
            </SettingsBlock>
          </div>
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}

/* ---------------- Sub-components ---------------- */

function ResultsList({
  results,
  isLoading,
  totalCount,
  currentPage,
  totalPages,
  onSelect,
  selectedId,
  onPage,
}: {
  results: EmailResult[];
  isLoading: boolean;
  totalCount: number;
  currentPage: number;
  totalPages: number;
  onSelect: (e: EmailResult) => void;
  selectedId?: string;
  onPage: (page: number) => void;
}) {
  return (
    <div className="rounded-xl border border-border/80 bg-card">
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-2.5 text-xs text-muted-foreground">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em]">
          {totalCount > 0
            ? `${totalCount} message${totalCount === 1 ? "" : "s"}`
            : "No messages"}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em]">
          Page {currentPage} / {Math.max(1, totalPages)}
        </span>
      </div>

      {results.length === 0 ? (
        <div className="p-10">
          <EmptyState
            icon={<Mail className="size-5" />}
            title={isLoading ? "Loading vault" : "No emails to display"}
            hint={
              isLoading
                ? "Reading from the archive."
                : "Try a different search or import an account."
            }
          />
        </div>
      ) : (
        <>
          <ul className="divide-y divide-border/60">
            {results.map((email) => {
              const selected = selectedId === email.id;
              return (
                <li key={email.id}>
                  <button
                    onClick={() => onSelect(email)}
                    className={cn(
                      "group relative flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors",
                      "hover:bg-secondary/50",
                      selected && "bg-vault-muted/60",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "absolute left-0 top-3.5 h-[calc(100%-1.75rem)] w-[2px] rounded-r",
                        selected ? "bg-vault" : "bg-transparent",
                      )}
                    />
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-background text-[11px] font-medium text-foreground">
                      {getInitials(email.fromName, email.fromAddress)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="truncate text-sm font-medium text-foreground">
                          {email.fromName ||
                            email.fromAddress ||
                            "Unknown sender"}
                        </span>
                        <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                          {formatRelative(email.date)}
                        </span>
                      </div>
                      <div className="mt-0.5 truncate text-sm text-foreground/90">
                        {email.subject || "(no subject)"}
                      </div>
                      {email.bodyText && (
                        <div className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                          {email.bodyText}
                        </div>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <Badge
                          variant="secondary"
                          className="h-5 rounded px-1.5 font-mono text-[10px] uppercase tracking-wider"
                        >
                          {email.folder}
                        </Badge>
                        <Badge
                          variant="outline"
                          className="h-5 rounded px-1.5 font-mono text-[10px] normal-case tracking-normal text-muted-foreground"
                        >
                          {email.accountEmail}
                        </Badge>
                        {email.hasAttachments && (
                          <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-vault">
                            <Paperclip className="size-3" />
                            attach
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-3 border-t border-border/60 px-4 py-3 text-xs text-muted-foreground">
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage <= 1 || isLoading}
                onClick={() => onPage(Math.max(1, currentPage - 1))}
                className="h-8 gap-1.5"
              >
                <ChevronLeft className="size-3.5" />
                Prev
              </Button>
              <span className="font-mono text-[10px] uppercase tracking-[0.18em]">
                {(currentPage - 1) * PAGE_SIZE + 1}–
                {Math.min(currentPage * PAGE_SIZE, totalCount)} of {totalCount}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage >= totalPages || isLoading}
                onClick={() => onPage(Math.min(totalPages, currentPage + 1))}
                className="h-8 gap-1.5"
              >
                Next
                <ChevronRight className="size-3.5" />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function DetailPane({
  email,
  isLoadingEmail,
  attachments,
  isLoadingAttachments,
  onClose,
  onDownload,
}: {
  email: EmailResult | null;
  isLoadingEmail: boolean;
  attachments: AttachmentInfo[];
  isLoadingAttachments: boolean;
  onClose: () => void;
  onDownload: (a: AttachmentInfo) => void;
}) {
  if (!email) {
    return (
      <div className="hidden lg:block">
        <div className="flex h-full min-h-[400px] items-center justify-center rounded-xl border border-dashed border-border/80 bg-card/50 p-10 text-center">
          <div className="space-y-2">
            <FileText className="mx-auto size-6 text-muted-foreground/70" />
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Select a message
            </p>
            <p className="text-sm text-muted-foreground">
              Pick an email from the list to inspect its content.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Mobile overlay */}
      <div
        className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm lg:hidden"
        onClick={onClose}
      />
      <article
        className={cn(
          "fixed inset-x-2 bottom-2 top-16 z-50 flex flex-col overflow-hidden rounded-xl border border-border/80 bg-card shadow-2xl",
          "lg:static lg:inset-auto lg:z-auto lg:flex lg:shadow-none",
        )}
      >
        <header className="flex items-start justify-between gap-3 border-b border-border/60 bg-background/40 px-5 py-4">
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              {email.folder} · {email.accountEmail}
            </p>
            <h3 className="mt-1 truncate text-base font-medium text-foreground">
              {email.subject || "(no subject)"}
            </h3>
            <p className="mt-1 truncate text-sm text-muted-foreground">
              From {email.fromName || email.fromAddress}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Close detail"
          >
            <X className="size-4" />
          </Button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          {isLoadingEmail ? (
            <div className="space-y-3">
              <div className="h-3 w-1/3 animate-pulse rounded bg-secondary" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-secondary" />
              <div className="mt-6 h-32 animate-pulse rounded bg-secondary" />
            </div>
          ) : (
            <div className="space-y-5">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-border/60 bg-background/40 p-3 text-sm">
                <DetailRow label="Date" value={formatDate(email.date)} />
                <DetailRow
                  label="Size"
                  value={formatSize(email.size) || "—"}
                />
                <DetailRow
                  label="Type"
                  value={email.contentType || "PLAIN"}
                />
                <DetailRow
                  label="Attachments"
                  value={email.hasAttachments ? "yes" : "no"}
                />
              </dl>

              {email.toAddresses && email.toAddresses.length > 0 && (
                <div className="rounded-lg border border-border/60 bg-background/40 p-3 text-sm">
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    To
                  </p>
                  <p className="mt-1 break-words text-foreground">
                    {email.toAddresses.join(", ")}
                  </p>
                </div>
              )}

              {email.hasAttachments && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                      Attachments
                    </p>
                    {isLoadingAttachments && (
                      <span className="text-xs text-muted-foreground">
                        Loading
                      </span>
                    )}
                  </div>
                  {attachments.length > 0 ? (
                    <ul className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border/60">
                      {attachments.map((a, i) => (
                        <li
                          key={i}
                          className="flex items-center justify-between gap-3 bg-background/40 px-3 py-2.5"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">
                              {a.originalName}
                            </p>
                            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                              {formatSize(a.size)} · {a.contentType}
                            </p>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => onDownload(a)}
                            className="gap-1.5"
                          >
                            <Download className="size-3.5" />
                            Save
                          </Button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    !isLoadingAttachments && (
                      <p className="rounded-lg border border-dashed border-border/60 px-3 py-4 text-center text-sm text-muted-foreground">
                        No attachments resolved
                      </p>
                    )
                  )}
                </div>
              )}

              {(email.bodyText || email.bodyHtml) && (
                <div className="space-y-2">
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    Body
                  </p>
                  <div className="overflow-hidden rounded-lg border border-border/60 bg-background/60">
                    {email.contentType === "HTML" && email.bodyHtml ? (
                      <div
                        className="prose prose-sm max-w-none p-5 dark:prose-invert"
                        style={{ wordBreak: "break-word" }}
                        dangerouslySetInnerHTML={{ __html: email.bodyHtml }}
                      />
                    ) : (
                      <pre className="whitespace-pre-wrap p-5 font-sans text-sm leading-relaxed text-foreground/90">
                        {email.bodyText}
                      </pre>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </article>
    </>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </dt>
      <dd className="text-sm text-foreground">{value}</dd>
    </div>
  );
}

function FormRow({
  id,
  label,
  value,
  onChange,
  type,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div className="grid gap-2">
      <Label
        htmlFor={id}
        className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground"
      >
        {label}
      </Label>
      <Input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-center">
      <span className="flex size-10 items-center justify-center rounded-full border border-border bg-background text-muted-foreground">
        {icon}
      </span>
      <div>
        <p className="font-medium text-foreground">{title}</p>
        {hint && (
          <p className="mt-1 text-sm text-muted-foreground">{hint}</p>
        )}
      </div>
      {action}
    </div>
  );
}

function SettingsBlock({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border/80 bg-card p-5">
      <h3 className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
        {title}
      </h3>
      <div className="mt-3 space-y-2">{children}</div>
    </div>
  );
}

function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-dashed border-border/60 py-1.5 last:border-b-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="font-mono text-sm text-foreground">{value}</span>
    </div>
  );
}

// Suppress unused import warnings for icons that will be used by future filters
const _unused = { CheckCircle2, XCircle, Clock, AlertTriangle };
void _unused;
