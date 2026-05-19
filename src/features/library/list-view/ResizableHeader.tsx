import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

// Hard caps so a user can't drag a column down to 0 or out to silly
// widths that would shove the rest of the row off-screen.
const COL_MIN = 50;
const COL_MAX = 360;

/**
 * Resizable column header — a label cell with a 4px grab strip on its
 * right edge. Mouse-down on the strip starts a window-level drag that
 * tracks deltaX and commits a clamped new width via `onResize`. When
 * `onResize` is omitted (e.g. preview/test mounts without a setter),
 * the header degrades to a plain non-resizable cell so the row still
 * renders.
 */
export function ResizableHeader({
  label,
  width,
  onResize,
  className,
}: {
  label: string;
  width: number;
  onResize?: (next: number) => void;
  className?: string;
}) {
  const startRef = useRef<{ x: number; width: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  // Bind move/up on window so the drag survives the cursor leaving
  // the narrow grab strip. Bound only while a drag is in progress so
  // we're not leaking global listeners for every mounted header.
  useEffect(() => {
    if (!dragging || !onResize) return;
    const handleMove = (e: MouseEvent) => {
      if (!startRef.current) return;
      const next = Math.min(
        COL_MAX,
        Math.max(
          COL_MIN,
          startRef.current.width + (e.clientX - startRef.current.x),
        ),
      );
      onResize(next);
    };
    const handleUp = () => {
      startRef.current = null;
      setDragging(false);
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [dragging, onResize]);

  return (
    <div className={cn("relative items-center", className)} style={{ width }}>
      <span className="truncate">{label}</span>
      {onResize && (
        <span
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            startRef.current = { x: e.clientX, width };
            setDragging(true);
          }}
          // The grab strip extends a touch past the column's right
          // edge so the user can grab it without nudging perfect-
          // pixel alignment. cursor-col-resize + a hover tint sells
          // the affordance.
          className={cn(
            "absolute -right-1 top-0 z-10 h-full w-2 cursor-col-resize select-none",
            "before:absolute before:left-1/2 before:top-1 before:-translate-x-1/2",
            "before:h-[calc(100%-0.5rem)] before:w-px before:bg-glass-border",
            "hover:before:bg-accent-purple/70",
            dragging && "before:bg-accent-purple",
          )}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
