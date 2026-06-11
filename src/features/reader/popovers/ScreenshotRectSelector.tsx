import { useCallback, useEffect, useState } from "react";
import { useBackToClose } from "@/hooks/use-back-to-close";

export interface ScreenshotRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface ScreenshotRectSelectorProps {
  onCapture: (rect: ScreenshotRect) => void;
  onCancel: () => void;
}

/**
 * Full-viewport overlay that lets the user drag a rectangle to select
 * a screenshot region. Coordinates are reported in client (viewport)
 * space so the caller can translate them to document/element space.
 */
export function ScreenshotRectSelector({
  onCapture,
  onCancel,
}: ScreenshotRectSelectorProps) {
  const [start, setStart] = useState<{ x: number; y: number } | null>(null);
  const [end, setEnd] = useState<{ x: number; y: number } | null>(null);

  const rect: ScreenshotRect | null =
    start && end
      ? {
          left: Math.min(start.x, end.x),
          top: Math.min(start.y, end.y),
          width: Math.abs(end.x - start.x),
          height: Math.abs(end.y - start.y),
        }
      : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  // Android back / system back gesture cancels the screenshot selection.
  useBackToClose(true, onCancel);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    setStart({ x: e.clientX, y: e.clientY });
    setEnd({ x: e.clientX, y: e.clientY });
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!start) return;
      setEnd({ x: e.clientX, y: e.clientY });
    },
    [start],
  );

  const handlePointerUp = useCallback(() => {
    // Only commit/cancel if this overlay actually owned the gesture
    // (we saw a pointerdown on it). When the overlay mounts in
    // response to a button tap, the user's finger is still on the
    // screen — the pointerup that follows lands on the *overlay*
    // even though pointerdown landed on the button, so without the
    // `start` gate we'd treat it as a zero-size selection and fire
    // onCancel immediately. That cancel pops the back-sentinel and
    // navigates the user off the reader entirely. Ignoring a stray
    // pointerup with no matching pointerdown keeps the overlay open
    // so the user can actually draw a rectangle.
    if (!start) return;
    if (rect && rect.width > 4 && rect.height > 4) {
      onCapture(rect);
    } else {
      onCancel();
    }
  }, [start, rect, onCapture, onCancel]);

  return (
    <div
      className="fixed inset-0 z-[9999]"
      style={{ cursor: "crosshair", touchAction: "none" }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <div className="pointer-events-none absolute inset-0 bg-black/30" />
      {rect && (
        <>
          <div
            className="pointer-events-none absolute border-2 border-accent bg-accent/10"
            style={{
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height,
            }}
          />
          <div
            className="pointer-events-none absolute rounded bg-black/70 px-1.5 py-0.5 text-xs font-mono text-white"
            style={{
              left: rect.left,
              top: rect.top + rect.height + 4,
            }}
          >
            {Math.round(rect.width)} × {Math.round(rect.height)}
          </div>
        </>
      )}
      <div className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1 text-xs text-white">
        Drag to select · Esc to cancel
      </div>
    </div>
  );
}
