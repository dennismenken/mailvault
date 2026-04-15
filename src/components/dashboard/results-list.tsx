import * as React from "react";
import { Mail, Paperclip, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  type EmailResult,
  EmptyState,
  PAGE_SIZE,
  formatRelative,
  getInitials,
} from "./shared";

interface ResultsListProps {
  results: EmailResult[];
  isLoading: boolean;
  totalCount: number;
  currentPage: number;
  totalPages: number;
  onSelect: (email: EmailResult) => void;
  selectedId?: string;
  onPage: (page: number) => void;
}

export function ResultsList({
  results,
  isLoading,
  totalCount,
  currentPage,
  totalPages,
  onSelect,
  selectedId,
  onPage,
}: ResultsListProps) {
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
                    type="button"
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
