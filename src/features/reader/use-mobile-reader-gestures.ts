import { useEffect, useRef } from "react";

interface Options {
  /** Target element to attach listeners to. */
  targetRef: React.RefObject<HTMLElement | null>;

  /** Called when a swipe left → should go to the next page. */
  onSwipeLeft?: () => void;
  /** Called when a swipe right → should go to the previous page. */
  onSwipeRight?: () => void;

  /** Called during pinch with the current scale factor relative to
   *  pinch start (1.0 = no change, <1.0 = pinch-in, >1.0 = pinch-out). */
  onPinch?: (scale: number) => void;

  /** Master switches. When false, the corresponding gesture is
   *  ignored so non-paginated viewers (EPUB, markdown) keep native
   *  scroll/selection behavior. */
  enableSwipe: boolean;
  enablePinch: boolean;
}

interface TouchState {
  /** Time + position of the primary touchstart for the current gesture. */
  start: { x: number; y: number; t: number } | null;
  /** Set once a second finger lands — blocks swipe detection for this gesture. */
  multi: boolean;
  /** Distance between the two fingers when pinch started. */
  pinchStartDist: number;
}

const SWIPE_MIN_DX = 50;
const SWIPE_MAX_TIME_MS = 500;
/** dx must be at least this many times dy for a swipe to count. Keeps
 *  vertical scrolls from accidentally turning pages. */
const SWIPE_RATIO = 2;

/**
 * Touch gestures for the mobile reader: horizontal swipes (page
 * turns) and two-finger pinch (zoom). Listeners are attached as
 * native events with `{ passive: false }` on touchmove so pinch can
 * `preventDefault` — React's synthetic event system uses passive
 * listeners and would silently ignore the call.
 *
 * Exposes `wasJustGesture` via a ref so the sibling tap-to-toggle
 * onClick can skip when a swipe/pinch just ended.
 */
export function useMobileReaderGestures(opts: Options): {
  wasJustGestureRef: React.MutableRefObject<boolean>;
} {
  const { targetRef, onSwipeLeft, onSwipeRight, onPinch, enableSwipe, enablePinch } = opts;

  const stateRef = useRef<TouchState>({ start: null, multi: false, pinchStartDist: 0 });
  const wasJustGestureRef = useRef(false);

  useEffect(() => {
    const el = targetRef.current;
    if (!el) return;

    const markGesture = () => {
      wasJustGestureRef.current = true;
      // Clear the flag after a tick so the synthetic click that fires
      // after touchend can read it, but a later unrelated click
      // doesn't see a stale true.
      setTimeout(() => {
        wasJustGestureRef.current = false;
      }, 150);
    };

    const handleStart = (e: TouchEvent) => {
      const state = stateRef.current;
      if (e.touches.length === 1) {
        const touch = e.touches[0];
        state.start = { x: touch.clientX, y: touch.clientY, t: Date.now() };
        state.multi = false;
      } else if (e.touches.length === 2 && enablePinch) {
        state.multi = true;
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        state.pinchStartDist = Math.hypot(dx, dy);
      }
    };

    const handleMove = (e: TouchEvent) => {
      const state = stateRef.current;
      if (e.touches.length === 2 && state.multi && enablePinch && state.pinchStartDist > 0) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy);
        const scale = dist / state.pinchStartDist;
        onPinch?.(scale);
        // Block native viewport pinch-zoom so our zoom is authoritative.
        e.preventDefault();
      }
    };

    const handleEnd = (e: TouchEvent) => {
      const state = stateRef.current;
      if (state.multi) {
        markGesture();
        state.multi = false;
        state.start = null;
        state.pinchStartDist = 0;
        return;
      }
      if (!state.start || !enableSwipe) {
        state.start = null;
        return;
      }
      const end = e.changedTouches[0];
      const dx = end.clientX - state.start.x;
      const dy = end.clientY - state.start.y;
      const dt = Date.now() - state.start.t;
      state.start = null;

      if (
        dt < SWIPE_MAX_TIME_MS &&
        Math.abs(dx) > SWIPE_MIN_DX &&
        Math.abs(dx) > Math.abs(dy) * SWIPE_RATIO
      ) {
        if (dx < 0) onSwipeLeft?.();
        else onSwipeRight?.();
        markGesture();
      }
    };

    el.addEventListener("touchstart", handleStart, { passive: true });
    el.addEventListener("touchmove", handleMove, { passive: false });
    el.addEventListener("touchend", handleEnd, { passive: true });
    el.addEventListener("touchcancel", handleEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", handleStart);
      el.removeEventListener("touchmove", handleMove);
      el.removeEventListener("touchend", handleEnd);
      el.removeEventListener("touchcancel", handleEnd);
    };
  }, [targetRef, onSwipeLeft, onSwipeRight, onPinch, enableSwipe, enablePinch]);

  return { wasJustGestureRef };
}
