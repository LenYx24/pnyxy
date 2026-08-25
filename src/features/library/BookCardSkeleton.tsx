import type { ViewMode } from "./useLibraryPrefs";
import { ROW_SEPARATOR_CLASS } from "./list-view/helpers";

interface BookCardSkeletonGridProps {
  viewMode: ViewMode;
  count: number;
  /** Same grid sizing knob AllBooksTab passes to the real grid, so
   *  skeleton tile widths match the cards they'll be replaced by and
   *  the layout doesn't reflow when the fetch resolves. */
  cardSize: number;
}

export function BookCardSkeleton({
  viewMode,
  count,
  cardSize,
}: BookCardSkeletonGridProps) {
  if (count <= 0) return null;

  if (viewMode === "list") {
    return (
      <div className="flex flex-col">
        {Array.from({ length: count }).map((_, i) => (
          <div
            key={i}
            className={`flex h-[58px] animate-pulse items-center gap-3 px-3 ${ROW_SEPARATOR_CLASS}`}
          >
            <div className="h-11 w-8 shrink-0 rounded-[3px] bg-bg-tertiary" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 w-2/5 rounded bg-bg-tertiary" />
              <div className="h-2.5 w-1/4 rounded bg-bg-tertiary/70" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div
      className="grid gap-4"
      style={{
        gridTemplateColumns: `repeat(auto-fill, minmax(min(${cardSize}px, 100%), 1fr))`,
      }}
    >
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="animate-pulse">
          {/* aspect-[5/7] mirrors the real cover wrapper in
              LibraryBookCard so the placeholder occupies the exact
              card footprint, no layout shift on hand-off. */}
          <div className="aspect-[5/7] w-full overflow-hidden rounded-md bg-bg-tertiary shadow-page" />
          <div className="mt-2 space-y-1">
            <div className="h-3 w-3/4 rounded bg-bg-tertiary" />
            <div className="h-2.5 w-1/2 rounded bg-bg-tertiary/70" />
          </div>
        </div>
      ))}
    </div>
  );
}
