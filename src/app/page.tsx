"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { VaultLogo } from "@/components/brand/vault-logo";

export default function Home() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "loading") return;
    router.push(session ? "/dashboard" : "/login");
  }, [session, status, router]);

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background text-foreground">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-vault-grid opacity-50"
      />
      <div className="relative flex flex-col items-center gap-3">
        <VaultLogo className="size-10 animate-pulse text-foreground" />
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          Mail / Vault
        </span>
      </div>
    </div>
  );
}
