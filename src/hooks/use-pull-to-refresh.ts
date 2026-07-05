import { useEffect, useState } from "react";

interface Options {
  /** Called when the user releases a pull past the trigger threshold. */
  onRefresh: () => Promise<void> | void;
  /** Hook disables itself when false (e.g. on desktop). */
  enabled: boolean;
}

/** Distance (px) the user has to pull past to trigger a refresh. */
const TRIGGER_DISTANCE = 70;
/** How far the indicator can be dragged visually. Pulling further
 *  than this caps the translate so the UI doesn't fly off-screen. */
const MAX_DRAG = 120;
/** Threshold (px) of scroll-from-top to still count as "at the top".
 *  Mobile Safari sometimes reports tiny non-zero scrollY even at rest. */
const AT_TOP_SLOP = 2;

/**
 * Touch-based pull-to-refresh. Attaches to `document.body` and fires
 * `onRefresh` when the user pulls down past the trigger distance
 * while the page is scrolled to the very top. Returns progress state
 * the caller uses to render an indicator.
 *
 * `pullDistance` is 0 when idle, positive while pulling, and eased
 * (rubber-band) past the trigger point. `isRefreshing` stays true
 * until the returned `onRefresh` promise settles.
 */
export function usePullToRefresh({ onRefresh, enabled }: Options): {
  pullDistance: number;
  isRefreshing: boolean;
} {
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let startY: number | null = null;
    let tracking = false;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      if (window.scrollY > AT_TOP_SLOP) return;
      startY = e.touches[0].clientY;
      tracking = true;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!tracking || startY == null) return;
      const dy = e.touches[0].clientY - startY;
      if (dy <= 0) {
        // User pulled up, abandon; let native scroll resume.
        tracking = false;
        setPullDistance(0);
        return;
      }
      // Rubber-band past the trigger so the UI feels physical.
      const eased =
        dy < TRIGGER_DISTANCE
          ? dy
          : TRIGGER_DISTANCE + (dy - TRIGGER_DISTANCE) * 0.4;
      setPullDistance(Math.min(eased, MAX_DRAG));
    };

    const onTouchEnd = async () => {
      if (!tracking) return;
      tracking = false;
      const dist = pullDistance;
      setPullDistance(0);
      startY = null;
      if (dist >= TRIGGER_DISTANCE && !isRefreshing) {
        setIsRefreshing(true);
        try {
          await onRefresh();
        } finally {
          setIsRefreshing(false);
        }
      }
    };

    document.body.addEventListener("touchstart", onTouchStart, { passive: true });
    document.body.addEventListener("touchmove", onTouchMove, { passive: true });
    document.body.addEventListener("touchend", onTouchEnd, { passive: true });
    document.body.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      document.body.removeEventListener("touchstart", onTouchStart);
      document.body.removeEventListener("touchmove", onTouchMove);
      document.body.removeEventListener("touchend", onTouchEnd);
      document.body.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [enabled, onRefresh, pullDistance, isRefreshing]);

  return { pullDistance, isRefreshing };
}
