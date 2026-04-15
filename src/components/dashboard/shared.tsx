import * as React from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface EmailResult {
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

export interface AttachmentInfo {
  filename: string;
  originalName: string;
  size: number;
  contentType: string;
  downloadUrl: string;
}

export interface SearchResponse {
  emails: EmailResult[];
  totalCount: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface UserRecord {
  id: string;
  email: string;
  name?: string;
  createdAt: string;
  _count: { imapAccounts: number };
}

export interface ImapAccount {
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

export type StateTone = "ok" | "warn" | "err" | "idle";

export const PAGE_SIZE = 20;

export function formatDate(value?: string) {
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

export function formatRelative(value?: string) {
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

export function formatSize(bytes?: number) {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function getInitials(name?: string, email?: string) {
  const source = name?.trim() || email?.split("@")[0] || "?";
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function accountState(account: ImapAccount): {
  label: string;
  tone: StateTone;
} {
  if (!account.isActive) return { label: "Inactive", tone: "err" };
  if (!account.syncEnabled) return { label: "Paused", tone: "idle" };
  if (account.errorCount > 0) return { label: "Errors", tone: "warn" };
  return { label: "Active", tone: "ok" };
}

export function StateDot({ tone }: { tone: StateTone }) {
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

export function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </dt>
      <dd className="text-sm text-foreground">{value}</dd>
    </div>
  );
}

export function FormRow({
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

export function EmptyState({
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
        {hint && <p className="mt-1 text-sm text-muted-foreground">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

export function SettingsBlock({
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

export function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-dashed border-border/60 py-1.5 last:border-b-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="font-mono text-sm text-foreground">{value}</span>
    </div>
  );
}
