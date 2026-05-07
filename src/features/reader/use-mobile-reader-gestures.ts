import { useEffect, useRef } from "react";

export interface PinchEvent {
  /** Lifecycle phase. The controller only needs to set up styles on
   *  start, apply the live transform on move, and commit on end. */
  phase: "start" | "move" | "end";
  /** Current scale factor relative to pinch start (1.0 = no change,
   *  <1.0 = pinch-in, >1.0 = pinch-out). */
  scale: number;
  /** Midpoint of the two fingers in viewport coords. Used as the
   *  pivot/origin so the page expands from where the user pinched. */
  midX: number;
  midY: number;
}

export interface TapEvent {
  /** Tap location in viewport coords. */
  x: number;
  y: number;
  /** Element under the tap — consumers use this to skip taps on
   *  interactive children (buttons, links, annotation popovers, etc.). */
  target: EventTarget | null;
}

interface Options {
  /** Target element to attach listeners to. */
  targetRef: React.RefObject<HTMLElement | null>;

  /** Called when a swipe left → should go to the next page. */
  onSwipeLeft?: () => void;
  /** Called when a swipe right → should go to the previous page. */
  onSwipeRight?: () => void;

  /** Called on every pinch lifecycle event — start, move, end — so the
   *  consumer can drive an imperative DOM transform instead of plumbing
   *  React state through 60 frames per second. */
  onPinch?: (event: PinchEvent) => void;

  /** Single-tap (a brief, mostly-stationary touch). Fires *after* the
   *  double-tap detection window has elapsed so a fast follow-up tap
   *  fires onDoubleTap instead. Use it for "toggle chrome" UX that
   *  shouldn't double-up when the user is double-tapping to zoom. */
  onSingleTap?: (event: TapEvent) => void;
  /** Two taps in quick succession at roughly the same point. Use it
   *  for "double-tap to zoom" UX. */
  onDoubleTap?: (event: TapEvent) => void;

  /** Master switches. When false, the corresponding gesture is
   *  ignored so non-paginated viewers (EPUB, markdown) keep native
   *  scroll/selection behavior. */
  enableSwipe: boolean;
  enablePinch: boolean;
}

interface TapRecord {
  x: number;
  y: number;
  t: number;
}

interface TouchState {
  /** Time + position of the primary touchstart for the current gesture. */
  start: { x: number; y: number; t: number } | null;
  /** Set once a second finger lands — blocks swipe detection for this gesture. */
  multi: boolean;
  /** Distance between the two fingers when pinch started. */
  pinchStartDist: number;
  /** Most recent completed tap. The touchend handler compares against
   *  this to detect double-taps. Cleared whenever the gesture isn't a
   *  clean tap (swipe, pinch, long-press) so a stray earlier tap
   *  doesn't pair up with the next one. */
  lastTap: TapRecord | null;
  /** Pending single-tap timer. We delay onSingleTap by the double-tap
   *  interval so we can promote it to a double-tap if a second tap
   *  arrives. Cleared by the second tap or by any non-tap gesture. */
  singleTapTimer: ReturnType<typeof setTimeout> | null;
}

const SWIPE_MIN_DX = 50;
const SWIPE_MAX_TIME_MS = 500;
/** dx must be at least this many times dy for a swipe to count. Keeps
 *  vertical scrolls from accidentally turning pages. */
const SWIPE_RATIO = 2;

/** A "tap" is a touch shorter than this and that didn't move much. */
const TAP_MAX_TIME_MS = 250;
const TAP_MAX_MOVEMENT = 10;
/** Two taps within this window pair into a double-tap. Matches Google
 *  Chrome / Safari's native double-tap heuristics. */
const DOUBLE_TAP_INTERVAL_MS = 300;
const DOUBLE_TAP_MAX_DISTANCE = 30;

/**
 * Touch gestures for the mobile reader: horizontal swipes (page
 * turns), two-finger pinch (zoom), single-tap (toggle chrome) and
 * double-tap (zoom toggle). Listeners are attached as native events
 * with `{ passive: false }` on touchmove so pinch can `preventDefault`
 * — React's synthetic event system uses passive listeners and would
 * silently ignore the call.
 *
 * Exposes `wasJustGesture` via a ref so any sibling onClick handler
 * can skip when a swipe / pinch / double-tap just ended.
 */
export function useMobileReaderGestures(opts: Options): {
  wasJustGestureRef: React.MutableRefObject<boolean>;
} {
  const {
    targetRef,
    onSwipeLeft,
    onSwipeRight,
    onPinch,
    onSingleTap,
    onDoubleTap,
    enableSwipe,
    enablePinch,
  } = opts;

  const stateRef = useRef<TouchState>({
    start: null,
    multi: false,
    pinchStartDist: 0,
    lastTap: null,
    singleTapTimer: null,
  });
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

    const cancelPendingTap = () => {
      const state = stateRef.current;
      if (state.singleTapTimer !== null) {
        clearTimeout(state.singleTapTimer);
        state.singleTapTimer = null;
      }
      state.lastTap = null;
    };

    const handleStart = (e: TouchEvent) => {
      const state = stateRef.current;
      if (e.touches.length === 1) {
        const touch = e.touches[0];
        state.start = { x: touch.clientX, y: touch.clientY, t: Date.now() };
        state.multi = false;
      } else if (e.touches.length === 2 && enablePinch) {
        // Multi-touch starts → cancel any pending single-tap so the
        // chrome doesn't toggle in the middle of a pinch.
        cancelPendingTap();
        state.multi = true;
        const t0 = e.touches[0];
        const t1 = e.touches[1];
        const dx = t0.clientX - t1.clientX;
        const dy = t0.clientY - t1.clientY;
        state.pinchStartDist = Math.hypot(dx, dy);
        const midX = (t0.clientX + t1.clientX) / 2;
        const midY = (t0.clientY + t1.clientY) / 2;
        onPinch?.({ phase: "start", scale: 1, midX, midY });
      }
    };

    const handleMove = (e: TouchEvent) => {
      const state = stateRef.current;
      if (e.touches.length === 2 && state.multi && enablePinch && state.pinchStartDist > 0) {
        const t0 = e.touches[0];
        const t1 = e.touches[1];
        const dx = t0.clientX - t1.clientX;
        const dy = t0.clientY - t1.clientY;
        const dist = Math.hypot(dx, dy);
        const scale = dist / state.pinchStartDist;
        const midX = (t0.clientX + t1.clientX) / 2;
        const midY = (t0.clientY + t1.clientY) / 2;
        onPinch?.({ phase: "move", scale, midX, midY });
        // Block native viewport pinch-zoom so our zoom is authoritative.
        e.preventDefault();
      }
    };

    const handleEnd = (e: TouchEvent) => {
      const state = stateRef.current;
      if (state.multi) {
        // Use the touch that was lifted (or the last remaining one) as
        // the reference midpoint — by the time touchend fires, fewer
        // fingers are on screen, but the controller only needs *some*
        // coords to trigger the end-phase teardown.
        const ref = e.changedTouches[0] ?? e.touches[0];
        const midX = ref?.clientX ?? 0;
        const midY = ref?.clientY ?? 0;
        onPinch?.({ phase: "end", scale: 1, midX, midY });
        markGesture();
        state.multi = false;
        state.start = null;
        state.pinchStartDist = 0;
        cancelPendingTap();
        return;
      }
      if (!state.start) {
        state.start = null;
        return;
      }
      const end = e.changedTouches[0];
      const dx = end.clientX - state.start.x;
      const dy = end.clientY - state.start.y;
      const dt = Date.now() - state.start.t;
      const startedAt = state.start;
      state.start = null;

      // Swipe wins over tap when both criteria match (a flick has
      // significant horizontal travel, a tap has nearly none).
      if (
        enableSwipe &&
        dt < SWIPE_MAX_TIME_MS &&
        Math.abs(dx) > SWIPE_MIN_DX &&
        Math.abs(dx) > Math.abs(dy) * SWIPE_RATIO
      ) {
        if (dx < 0) onSwipeLeft?.();
        else onSwipeRight?.();
        markGesture();
        cancelPendingTap();
        return;
      }

      const isTap =
        dt < TAP_MAX_TIME_MS &&
        Math.abs(dx) < TAP_MAX_MOVEMENT &&
        Math.abs(dy) < TAP_MAX_MOVEMENT;
      if (!isTap) {
        // Long press / drag that wasn't a swipe — don't fire either
        // tap callback, and clear any pending single-tap so it
        // doesn't pair with whatever happens next.
        cancelPendingTap();
        return;
      }

      const target = e.target;
      const tapEvent: TapEvent = { x: end.clientX, y: end.clientY, target };
      const last = state.lastTap;
      const now = Date.now();
      if (
        last &&
        now - last.t < DOUBLE_TAP_INTERVAL_MS &&
        Math.abs(end.clientX - last.x) < DOUBLE_TAP_MAX_DISTANCE &&
        Math.abs(end.clientY - last.y) < DOUBLE_TAP_MAX_DISTANCE
      ) {
        // Second tap of a pair → fire double-tap, kill the queued
        // single-tap from the first one.
        cancelPendingTap();
        onDoubleTap?.(tapEvent);
        // Mark a gesture so the synthetic click after touchend (which
        // would also fire toggle-chrome via React onClick) is
        // suppressed. Suppress for slightly longer than the synthetic
        // click delay (~50–300ms) since this fires on touchend and
        // some browsers re-emit the click late.
        markGesture();
        return;
      }

      // First tap (or a tap too far / too late from the previous one).
      // Defer fire so a follow-up tap can promote it to a double-tap.
      state.lastTap = { x: end.clientX, y: end.clientY, t: now };
      // `startedAt` is used here only to satisfy lint about unused
      // captures; the timer fires after the double-tap window
      // regardless of when the touch started.
      void startedAt;
      if (state.singleTapTimer !== null) clearTimeout(state.singleTapTimer);
      state.singleTapTimer = setTimeout(() => {
        state.singleTapTimer = null;
        state.lastTap = null;
        onSingleTap?.(tapEvent);
      }, DOUBLE_TAP_INTERVAL_MS);
    };

    el.addEventListener("touchstart", handleStart, { passive: true });
    el.addEventListener("touchmove", handleMove, { passive: false });
    el.addEventListener("touchend", handleEnd, { passive: true });
    el.addEventListener("touchcancel", handleEnd, { passive: true });

    // iOS Safari fires legacy `gesturestart`/`gesturechange`/`gestureend`
    // events for any 2-finger contact, *parallel* to the standard
    // touch events. Even with `user-scalable=no` and
    // `touch-action: pan-y` set, those legacy events can preempt
    // `touchmove` delivery for the second finger if we don't claim
    // them first — this was the smoking gun for "pinch on iPhone
    // does literally nothing." Calling preventDefault() on
    // gesturestart asserts our ownership of the multi-touch path
    // and lets the touchmove handler above receive its 2-touch
    // events as expected. No-op on Android / desktop (those don't
    // fire `GestureEvent`s; the listener silently never triggers).
    const handleGesture = (e: Event) => {
      if (enablePinch) e.preventDefault();
    };
    el.addEventListener("gesturestart", handleGesture, { passive: false });
    el.addEventListener("gesturechange", handleGesture, { passive: false });
    el.addEventListener("gestureend", handleGesture, { passive: false });

    // Capture the state object at setup time so the cleanup uses the
    // exact same instance the handlers wrote to. `useRef` returns a
    // stable object across renders so this is purely to satisfy the
    // react-hooks/exhaustive-deps lint without a disable comment.
    const stateForCleanup = stateRef.current;
    return () => {
      el.removeEventListener("touchstart", handleStart);
      el.removeEventListener("touchmove", handleMove);
      el.removeEventListener("touchend", handleEnd);
      el.removeEventListener("touchcancel", handleEnd);
      el.removeEventListener("gesturestart", handleGesture);
      el.removeEventListener("gesturechange", handleGesture);
      el.removeEventListener("gestureend", handleGesture);
      // Drop any pending tap timer so it can't fire after unmount.
      if (stateForCleanup.singleTapTimer !== null) {
        clearTimeout(stateForCleanup.singleTapTimer);
        stateForCleanup.singleTapTimer = null;
      }
    };
  }, [
    targetRef,
    onSwipeLeft,
    onSwipeRight,
    onPinch,
    onSingleTap,
    onDoubleTap,
    enableSwipe,
    enablePinch,
  ]);

  return { wasJustGestureRef };
}
