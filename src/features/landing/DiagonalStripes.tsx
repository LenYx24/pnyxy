import { cn } from "@/lib/cn";

/**
 * The landing's signature motif: slanted accent bars. Deliberately
 * skewed (never horizontal) and asymmetric — a nod to the bold diagonal
 * stripe bands the design brief liked. Decorative only, so it's always
 * aria-hidden and pointer-events-none. Colour is the teal --color-accent.
 */

/** A dense cluster of slanted bars — sits BEHIND the hero product mock
 *  so the mock overlaps them (that Prebook-style diagonal band look). */
export function HeroStripes({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("pointer-events-none absolute overflow-hidden", className)}
    >
      <div className="-rotate-[8deg] space-y-2.5">
        <div className="h-16 w-[140%] -translate-x-[10%] rounded-sm bg-accent" />
        <div className="h-2 w-[140%] -translate-x-[10%] rounded-sm bg-accent/40" />
        <div className="h-6 w-[140%] -translate-x-[10%] rounded-sm bg-accent/70" />
        <div className="h-1.5 w-[140%] -translate-x-[10%] rounded-sm bg-accent/25" />
      </div>
    </div>
  );
}

/** A full-width slanted accent band used as a section divider — the
 *  page's recurring beat. Two offset bars so it reads as motion. */
export function SlantDivider({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("relative h-10 overflow-hidden", className)}
    >
      <div className="absolute inset-x-[-5%] top-1/2 -translate-y-1/2 -skew-y-2">
        <div className="h-2.5 w-full bg-accent/80" />
        <div className="mt-1.5 h-1 w-full bg-accent/25" />
      </div>
    </div>
  );
}
