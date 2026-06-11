import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";

interface ShelfProps {
  title: string;
  /** Optional link shown as "See all" on the right of the header. */
  seeAllHref?: string;
  seeAllLabel?: string;
  /** When empty, the shelf renders nothing (caller can just always
   *  pass its list — empty lists hide the whole shelf, no placeholder
   *  noise for sections that happen to have no data yet). */
  children: ReactNode;
  /** The number of child items; needed to decide whether the shelf
   *  has anything to render before invoking children. */
  itemCount: number;
}

/**
 * Horizontal scroll shelf (Netflix / Google Play style). Uses CSS
 * scroll-snap, with left/right arrow buttons on pointer devices.
 * Touch devices get native momentum swipe + snap. The arrows
 * auto-hide at the edges; invisible on mobile.
 */
export function Shelf({
  title,
  seeAllHref,
  seeAllLabel,
  children,
  itemCount,
}: ShelfProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const recomputeArrows = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    recomputeArrows();
    el.addEventListener("scroll", recomputeArrows, { passive: true });
    const ro = new ResizeObserver(recomputeArrows);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", recomputeArrows);
      ro.disconnect();
    };
  }, [recomputeArrows, itemCount]);

  const scrollBy = (dir: 1 | -1) => {
    const el = scrollerRef.current;
    if (!el) return;
    // Scroll by ~80% of the visible width so a partial card stays
    // visible as an affordance that there's more off-screen.
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: "smooth" });
  };

  if (itemCount === 0) return null;

  return (
    <section className="mb-5">
      <header className="mb-2 flex items-center justify-between gap-3 px-1">
        <h2 className="text-lg font-semibold text-text-primary sm:text-xl">
          {title}
        </h2>
        <div className="flex items-center gap-1">
          {seeAllHref && (
            <Link
              to={seeAllHref}
              className="mr-1 text-xs font-medium text-text-muted hover:text-accent"
            >
              {seeAllLabel}
            </Link>
          )}
          {/* Arrows — desktop only; mobile uses swipe */}
          <button
            type="button"
            onClick={() => scrollBy(-1)}
            disabled={!canScrollLeft}
            aria-label="Scroll left"
            className={cn(
              "hidden h-8 w-8 items-center justify-center rounded-full border border-glass-border bg-glass-bg transition-opacity sm:flex",
              "hover:bg-glass-hover disabled:cursor-not-allowed disabled:opacity-30",
            )}
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            onClick={() => scrollBy(1)}
            disabled={!canScrollRight}
            aria-label="Scroll right"
            className={cn(
              "hidden h-8 w-8 items-center justify-center rounded-full border border-glass-border bg-glass-bg transition-opacity sm:flex",
              "hover:bg-glass-hover disabled:cursor-not-allowed disabled:opacity-30",
            )}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </header>
      <div
        ref={scrollerRef}
        className={cn(
          "flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2",
          // Hide the scrollbar so the shelf feels like a native list.
          "scrollbar-none [&::-webkit-scrollbar]:hidden",
        )}
        style={{ scrollbarWidth: "none" }}
      >
        {children}
      </div>
    </section>
  );
}
