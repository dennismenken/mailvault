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
  RefreshCw,
  Inbox,
} from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import {
  type AttachmentInfo,
  type EmailResult,
  type ImapAccount,
  type SearchResponse,
  type UserRecord,
  PAGE_SIZE,
  accountState,
  EmptyState,
  formatDate,
  formatRelative,
  FormRow,
  getInitials,
  SettingsBlock,
  SettingRow,
  StateDot,
} from "@/components/dashboard/shared";
import { ResultsList } from "@/components/dashboard/results-list";
import { DetailPane } from "@/components/dashboard/detail-pane";

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
    async (
      query: string,
      page: number,
      filter: "all" | "attachments" = activeFilter,
      account: string = accountFilter,
    ) => {
      setIsLoading(true);
      try {
        const params = new URLSearchParams({
          ...(query && { query }),
          page: page.toString(),
          limit: PAGE_SIZE.toString(),
          ...(filter === "attachments" && { hasAttachments: "1" }),
          ...(account !== "all" && { accountId: account }),
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
    [activeFilter, accountFilter],
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

  // Filters are applied server-side via query params; results come back pre-filtered.
  const filteredResults = searchResults;

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
                type="search"
                aria-label="Search emails"
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
                  type="button"
                  aria-pressed={activeFilter === c.id}
                  onClick={() => {
                    setActiveFilter(c.id);
                    setCurrentPage(1);
                    handleSearch(searchQuery, 1, c.id, accountFilter);
                  }}
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
                type="button"
                aria-pressed={accountFilter === "all"}
                onClick={() => {
                  setAccountFilter("all");
                  setCurrentPage(1);
                  handleSearch(searchQuery, 1, activeFilter, "all");
                }}
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
                  type="button"
                  aria-pressed={accountFilter === a.id}
                  onClick={() => {
                    setAccountFilter(a.id);
                    setCurrentPage(1);
                    handleSearch(searchQuery, 1, activeFilter, a.id);
                  }}
                  className={cn(
                    "inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs transition-colors",
                    accountFilter === a.id
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
