"use client";

import * as React from "react";
import { useSession, signOut } from "next-auth/react";
import { LogOut, User as UserIcon } from "lucide-react";
import { BrandMark } from "@/components/brand/brand-mark";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

type AppShellProps = {
  children: React.ReactNode;
  toolbar?: React.ReactNode;
};

function getInitial(name?: string | null, email?: string | null) {
  const source = name?.trim() || email?.trim() || "?";
  return source.charAt(0).toUpperCase();
}

export function AppShell({ children, toolbar }: AppShellProps) {
  const { data: session } = useSession();
  const initial = getInitial(session?.user?.name, session?.user?.email);

  return (
    <div className="relative min-h-screen bg-background text-foreground">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 bg-vault-grid opacity-60"
      />
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-0 -z-10 h-[420px] bg-vault-radial"
      />

      <header className="sticky top-0 z-30 border-b border-border/70 bg-background/75 backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-[1400px] items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <BrandMark size="md" tagline="Archive" />
          </div>

          <div className="flex items-center gap-1.5">
            <ThemeToggle />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="h-9 gap-2 px-2.5 font-mono text-xs"
                  aria-label="Account menu"
                >
                  <span
                    className={cn(
                      "flex size-7 items-center justify-center rounded-full border border-border bg-secondary text-[11px] font-medium text-foreground",
                    )}
                  >
                    {initial}
                  </span>
                  <span className="hidden text-foreground sm:inline">
                    {session?.user?.email ?? "Account"}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  Signed in as
                </DropdownMenuLabel>
                <div className="flex items-center gap-2 px-2 pb-2">
                  <UserIcon className="size-4 text-muted-foreground" />
                  <span className="truncate text-sm">
                    {session?.user?.email ?? "Unknown"}
                  </span>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => signOut({ callbackUrl: "/login" })}
                >
                  <LogOut className="size-4" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        {toolbar ? (
          <div className="border-t border-border/60 bg-background/60">
            <div className="mx-auto w-full max-w-[1400px] px-4 sm:px-6">
              {toolbar}
            </div>
          </div>
        ) : null}
      </header>

      <main className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 sm:py-8">
        {children}
      </main>

      <footer className="mx-auto w-full max-w-[1400px] px-4 pb-8 sm:px-6">
        <div className="hr-fade mb-3" />
        <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          <span>Mail / Vault</span>
          <span>Secured locally</span>
        </div>
      </footer>
    </div>
  );
}

export default AppShell;
