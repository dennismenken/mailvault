import * as React from "react";
import { X, Download, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  type AttachmentInfo,
  type EmailResult,
  DetailRow,
  formatDate,
  formatSize,
} from "./shared";

interface DetailPaneProps {
  email: EmailResult | null;
  isLoadingEmail: boolean;
  attachments: AttachmentInfo[];
  isLoadingAttachments: boolean;
  onClose: () => void;
  onDownload: (attachment: AttachmentInfo) => void;
}

export function DetailPane({
  email,
  isLoadingEmail,
  attachments,
  isLoadingAttachments,
  onClose,
  onDownload,
}: DetailPaneProps) {
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
