import { useCallback, useRef, type RefObject } from "react";

export interface TouchAxisLock {
  startX: number;
  startY: number;
  lockLeft: number;
  decided: boolean;
  lockHoriz: boolean;
}

export interface PdfTouchAxisLock {
  touchAxisLockRef: RefObject<TouchAxisLock | null>;
  handleTouchStart: (e: React.TouchEvent) => void;
  handleTouchMove: (e: React.TouchEvent) => void;
  handleTouchEnd: () => void;
}

/**
 * Single-finger pan axis-lock. Once a drag commits to a dominant axis, a
 * vertical-dominant one pins scrollLeft (applied in the scroll handler) so
 * the zoomed page doesn't drift sideways. Cleared on touch end / multi-touch.
 */
export function usePdfTouchAxisLock(
  containerRef: RefObject<HTMLDivElement | null>,
): PdfTouchAxisLock {
  const touchAxisLockRef = useRef<TouchAxisLock | null>(null);

  // Touch pan axis-lock: decide a dominant axis a few px into the drag; a
  // vertical-dominant drag pins horizontal scroll (applied in handleScroll).
  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length !== 1) {
        touchAxisLockRef.current = null;
        return;
      }
      const el = containerRef.current;
      if (!el) return;
      const t = e.touches[0];
      touchAxisLockRef.current = {
        startX: t.clientX,
        startY: t.clientY,
        lockLeft: el.scrollLeft,
        decided: false,
        lockHoriz: false,
      };
    },
    [containerRef],
  );
  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      const lock = touchAxisLockRef.current;
      if (!lock) return;
      if (e.touches.length !== 1) {
        touchAxisLockRef.current = null;
        return;
      }
      if (lock.decided) return;
      const t = e.touches[0];
      const dx = Math.abs(t.clientX - lock.startX);
      const dy = Math.abs(t.clientY - lock.startY);
      if (dx > 8 || dy > 8) {
        lock.decided = true;
        // vertical-dominant pins horizontal; horizontal-dominant drags stay free
        lock.lockHoriz = dy > dx;
        if (lock.lockHoriz) {
          lock.lockLeft = containerRef.current?.scrollLeft ?? lock.lockLeft;
        }
      }
    },
    [containerRef],
  );
  const handleTouchEnd = useCallback(() => {
    touchAxisLockRef.current = null;
  }, []);

  return { touchAxisLockRef, handleTouchStart, handleTouchMove, handleTouchEnd };
}
