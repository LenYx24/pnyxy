import { useActiveDocument } from "@/stores/reader-store";

/**
 * Thin vertical bar pinned to the right edge of the reader's scroll
 * area. Shows how far the user has read, computed from the
 * tracker-maintained `progressPage` watermark, same value reading
 * plans, streaks and library cards consume, so the indicator stays
 * consistent across the app.
 *
 * Not the native scrollbar:
 *   - Browser-styled scrollbars can't paint a partial-fill gradient
 *     without ugly cross-browser shims (Firefox `scrollbar-color`
 *     only takes one solid colour per fill area, WebKit only via
 *     ::-webkit-scrollbar which is Chrome-only).
 *   - Rendering a custom 4 px overlay alongside the native scrollbar
 *     gives us a clean "filled up to here" visual everywhere and
 *     leaves the actual scrolling UX untouched.
 *
 * Mount inside a positioned ancestor that matches the reader's
 * visible viewport, the strip uses `absolute right-0 top-0 h-full`
 * relative to its parent, so the parent must NOT be the scroll
 * container itself (otherwise the strip scrolls away with the
 * content).
 */
export function ReadProgressStrip() {
  const doc = useActiveDocument();
  if (!doc || doc.totalPages <= 0) return null;

  const watermark = Math.min(doc.progressPage, doc.totalPages);
  const fillPct = Math.max(0, Math.min(100, (watermark / doc.totalPages) * 100));
  // Slot the cursor too, a brighter, narrower pip at the user's
  // current page (which can be ahead of OR behind the watermark
  // depending on tracker, e.g. "max" leaves the watermark sticky
  // when the user pages back).
  const cursorPct = Math.max(
    0,
    Math.min(100, (doc.currentPage / doc.totalPages) * 100),
  );

  return (
    <div
      className="pointer-events-none absolute right-0 top-0 z-20 h-full w-1.5 overflow-hidden"
      aria-hidden="true"
    >
      <div
        className="absolute left-0 right-0 top-0 bg-accent/25 transition-[height] duration-200 ease-out"
        style={{ height: `${fillPct}%` }}
      />
      <div
        className="absolute left-0 right-0 h-0.5 bg-accent transition-[top] duration-150 ease-out"
        style={{ top: `calc(${cursorPct}% - 1px)` }}
      />
    </div>
  );
}
