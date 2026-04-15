"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2, Lock } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BrandMark } from "@/components/brand/brand-mark";
import { ThemeToggle } from "@/components/theme-toggle";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });
      if (result?.error) {
        toast.error("Authentication rejected. Check email and password.");
      } else {
        toast.success("Vault unlocked.");
        router.push("/dashboard");
      }
    } catch (error) {
      console.error("Login failed:", error);
      toast.error("An unexpected error occurred.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      {/* Atmosphere */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-vault-grid opacity-60"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-vault-radial"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 size-[640px] -translate-x-1/2 rounded-full opacity-40 blur-3xl"
        style={{
          background:
            "radial-gradient(circle, var(--vault-muted) 0%, transparent 70%)",
        }}
      />

      {/* Top bar */}
      <div className="relative z-10 mx-auto flex w-full max-w-[1400px] items-center justify-between px-6 pt-6">
        <BrandMark size="md" tagline="Archive" />
        <ThemeToggle />
      </div>

      {/* Main panel */}
      <div className="relative z-10 mx-auto flex min-h-[calc(100vh-72px)] w-full max-w-[1400px] items-center justify-center px-6 pb-12">
        <div className="grid w-full max-w-5xl grid-cols-1 gap-10 lg:grid-cols-[1.05fr_1fr] lg:gap-16">
          {/* Left: editorial */}
          <div className="hidden flex-col justify-between lg:flex">
            <div className="space-y-8">
              <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                <span className="text-vault">/</span> Into the vault
              </p>
              <h1 className="text-display text-balance text-5xl font-medium leading-[0.98]">
                Every message,
                <br />
                under{" "}
                <span className="relative inline-block">
                  lock and key
                  <span
                    aria-hidden
                    className="absolute -bottom-1 left-0 h-[2px] w-full bg-vault"
                  />
                </span>
                .
              </h1>
              <p className="max-w-md text-base leading-relaxed text-muted-foreground">
                Mail Vault archives your IMAP accounts into a self-hosted, fully
                searchable vault. Attachments, folders, headers — preserved
                exactly as delivered.
              </p>
            </div>

            <dl className="grid grid-cols-3 gap-6 border-t border-border/70 pt-6">
              {[
                { k: "Self", v: "hosted" },
                { k: "Full", v: "text" },
                { k: "Multi", v: "account" },
              ].map((item) => (
                <div key={item.k} className="space-y-1">
                  <dt className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                    {item.k}
                  </dt>
                  <dd className="font-mono text-xl text-foreground">
                    {item.v}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          {/* Right: card */}
          <div className="relative">
            <div
              aria-hidden
              className="absolute -inset-px rounded-2xl bg-gradient-to-b from-border via-border to-transparent opacity-80"
            />
            <div className="relative rounded-2xl border border-border/80 bg-card/95 p-7 shadow-xl shadow-black/5 backdrop-blur-sm sm:p-9">
              <div className="mb-7 flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                  Authentication
                </span>
                <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                  <span className="size-1.5 rounded-full bg-vault" />
                  Encrypted
                </span>
              </div>

              <h2 className="text-display text-2xl font-medium tracking-tight text-foreground">
                Unlock your vault
              </h2>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Sign in with your administrator credentials.
              </p>

              <form onSubmit={handleSubmit} className="mt-7 space-y-5">
                <div className="space-y-2">
                  <Label
                    htmlFor="email"
                    className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground"
                  >
                    Email
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="h-11 bg-background"
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label
                      htmlFor="password"
                      className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground"
                    >
                      Password
                    </Label>
                    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                      <Lock className="inline size-3 -translate-y-px" /> local
                    </span>
                  </div>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="h-11 bg-background"
                  />
                </div>

                <Button
                  type="submit"
                  disabled={isLoading}
                  className="group h-11 w-full bg-foreground text-background hover:bg-foreground/90"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      Verifying
                    </>
                  ) : (
                    <>
                      Enter vault
                      <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                    </>
                  )}
                </Button>
              </form>

              <p className="mt-6 border-t border-border/60 pt-5 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                Mail / Vault — Self-hosted IMAP archive
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
