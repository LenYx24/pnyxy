import { cn } from "@/lib/cn";
import type { DropPosition } from "./drag-intent";

/**
 * Insertion indicator rendered inside a `relative` row / card wrapper.
 * List rows get a horizontal 2 px line (with a dot at the left end)
 * at the top or bottom edge; grid cards get a vertical line in the
 * gap left or right of the card.
 */
export function DropIndicator({
  position,
  orientation,
}: {
  position: DropPosition | null;
  orientation: "row" | "card";
}) {
  if (position !== "before" && position !== "after") return null;
  const horizontal = orientation === "row";
  return (
    <div
      aria-hidden="true"
      data-drop-indicator={position}
      className={cn(
        "pointer-events-none absolute z-10 rounded-full bg-text-muted",
        horizontal
          ? "inset-x-3 h-0.5"
          : "inset-y-0 w-0.5",
        horizontal && position === "before" && "top-0 -translate-y-1/2",
        horizontal && position === "after" && "bottom-0 translate-y-1/2",
        !horizontal && position === "before" && "-left-2 -translate-x-1/2",
        !horizontal && position === "after" && "-right-2 translate-x-1/2",
      )}
    >
      <span
        className={cn(
          "absolute h-2 w-2 rounded-full bg-text-muted",
          horizontal
            ? "-left-1 top-1/2 -translate-y-1/2"
            : "-top-1 left-1/2 -translate-x-1/2",
        )}
      />
    </div>
  );
}
