import * as React from "react";
import { cn } from "@/lib/utils";
import { VaultLogo } from "./vault-logo";

type BrandMarkProps = {
  className?: string;
  size?: "sm" | "md" | "lg" | "xl";
  showWordmark?: boolean;
  tagline?: string;
};

const sizeMap = {
  sm: { mark: "size-5", word: "text-sm", gap: "gap-2", tag: "text-[10px]" },
  md: { mark: "size-7", word: "text-base", gap: "gap-2.5", tag: "text-[11px]" },
  lg: { mark: "size-10", word: "text-xl", gap: "gap-3", tag: "text-xs" },
  xl: { mark: "size-14", word: "text-3xl", gap: "gap-4", tag: "text-sm" },
} as const;

export function BrandMark({
  className,
  size = "md",
  showWordmark = true,
  tagline,
}: BrandMarkProps) {
  const s = sizeMap[size];
  return (
    <div className={cn("inline-flex items-center", s.gap, className)}>
      <VaultLogo className={cn(s.mark, "text-foreground")} />
      {showWordmark && (
        <div className="flex flex-col leading-none">
          <span
            className={cn(
              "font-medium tracking-tight text-foreground",
              s.word,
            )}
          >
            Mail<span className="text-muted-foreground">/</span>Vault
          </span>
          {tagline ? (
            <span
              className={cn(
                "mt-1 font-mono uppercase tracking-[0.18em] text-muted-foreground",
                s.tag,
              )}
            >
              {tagline}
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}

export default BrandMark;
