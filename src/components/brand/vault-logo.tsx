import * as React from "react";
import { cn } from "@/lib/utils";

type VaultLogoProps = React.SVGProps<SVGSVGElement> & {
  className?: string;
  title?: string;
};

/**
 * VaultLogo
 * A monochrome mark combining a stylised vault door with a horizontal mail slot.
 * Designed to read clearly at favicon scale (16px) and remain crisp at hero size.
 * Uses currentColor for stroke + fill so it inherits theme color.
 */
export function VaultLogo({
  className,
  title = "Mail Vault",
  ...rest
}: VaultLogoProps) {
  return (
    <svg
      viewBox="0 0 32 32"
      role="img"
      aria-label={title}
      xmlns="http://www.w3.org/2000/svg"
      className={cn("text-foreground", className)}
      {...rest}
    >
      <title>{title}</title>
      {/* Outer vault frame */}
      <rect
        x="3"
        y="3"
        width="26"
        height="26"
        rx="3.25"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      {/* Dial / hinge tick (top-right corner) */}
      <circle cx="24.5" cy="7.5" r="1.1" fill="currentColor" />
      {/* Mail slot */}
      <rect
        x="9"
        y="14.5"
        width="14"
        height="3"
        rx="1.2"
        fill="currentColor"
      />
      {/* Inner slot highlight (hairline) */}
      <line
        x1="11"
        y1="16"
        x2="21"
        y2="16"
        stroke="var(--vault-mark-slot, transparent)"
        strokeWidth="0.4"
      />
      {/* Lock-bolt notches below slot */}
      <rect x="13" y="22" width="6" height="1.6" rx="0.6" fill="currentColor" />
    </svg>
  );
}

export default VaultLogo;
