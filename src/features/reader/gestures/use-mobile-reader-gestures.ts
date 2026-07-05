import { useEffect, useRef } from "react";

export interface PinchEvent {
  phase: "start" | "move" | "end";
  /** scale relative to pinch start: <1 pinch-in, >1 pinch-out */
  scale: number;
  /** finger midpoint in viewport coords, used as zoom origin */
  midX: number;
  midY: number;
}

export interface TapEvent {
  x: number;
  y: number;
  /** element under the tap, so consumers can skip interactive children */
  target: EventTarget | null;
}

interface Options {
  targetRef: React.RefObject<HTMLElement | null>;

  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;

  /** fires on every pinch phase so the consumer can drive an imperative transform */
  onPinch?: (event: PinchEvent) => void;

  /** fires after the double-tap window elapses, so a fast second tap becomes onDoubleTap */
  onSingleTap?: (event: TapEvent) => void;
  onDoubleTap?: (event: TapEvent) => void;

  /** off keeps native scroll/selection for non-paginated viewers (epub, markdown) */
  enableSwipe: boolean;
  enablePinch: boolean;
}

interface TapRecord {
  x: number;
  y: number;
  t: number;
}

interface TouchState {
  start: { x: number; y: number; t: number } | null;
  /** true once a second finger lands, blocks swipe detection */
  multi: boolean;
  pinchStartDist: number;
  /** last clean tap, compared against for double-tap detection */
  lastTap: TapRecord | null;
  /** pending single-tap, delayed by the double-tap window so a second tap can promote it */
  singleTapTimer: ReturnType<typeof setTimeout> | null;
}

const SWIPE_MIN_DX = 50;
const SWIPE_MAX_TIME_MS = 500;
/** dx must exceed dy by this factor so vertical scrolls don't turn pages */
const SWIPE_RATIO = 2;

const TAP_MAX_TIME_MS = 250;
const TAP_MAX_MOVEMENT = 10;
const DOUBLE_TAP_INTERVAL_MS = 300;
const DOUBLE_TAP_MAX_DISTANCE = 30;

/**
 * Touch gestures for the mobile reader: swipe (page turn), pinch (zoom),
 * single-tap (toggle chrome), double-tap (zoom toggle). Uses native listeners
 * because touchmove needs passive:false to preventDefault, which React's
 * synthetic events don't allow.
 */
export function useMobileReaderGestures(opts: Options): void {
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

  useEffect(() => {
    const el = targetRef.current;
    if (!el) return;

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
        // cancel pending single-tap so chrome doesn't toggle mid-pinch
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
        // block native viewport pinch-zoom
        e.preventDefault();
      }
    };

    const handleEnd = (e: TouchEvent) => {
      const state = stateRef.current;
      if (state.multi) {
        // fewer fingers remain by touchend; any coords are fine for end-phase teardown
        const ref = e.changedTouches[0] ?? e.touches[0];
        const midX = ref?.clientX ?? 0;
        const midY = ref?.clientY ?? 0;
        onPinch?.({ phase: "end", scale: 1, midX, midY });
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

      // swipe wins over tap
      if (
        enableSwipe &&
        dt < SWIPE_MAX_TIME_MS &&
        Math.abs(dx) > SWIPE_MIN_DX &&
        Math.abs(dx) > Math.abs(dy) * SWIPE_RATIO
      ) {
        if (dx < 0) onSwipeLeft?.();
        else onSwipeRight?.();
        cancelPendingTap();
        return;
      }

      const isTap =
        dt < TAP_MAX_TIME_MS &&
        Math.abs(dx) < TAP_MAX_MOVEMENT &&
        Math.abs(dy) < TAP_MAX_MOVEMENT;
      if (!isTap) {
        // long press / drag: fire nothing, clear any pending tap
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
        // second tap of a pair: fire double-tap, drop the queued single-tap
        cancelPendingTap();
        onDoubleTap?.(tapEvent);
        return;
      }

      // first tap: defer so a follow-up can promote it to a double-tap
      state.lastTap = { x: end.clientX, y: end.clientY, t: now };
      // keep startedAt referenced to satisfy lint
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

    // iOS Safari: legacy gesture* events preempt 2-finger touchmove delivery
    // unless we preventDefault them here. Without this pinch does nothing on
    // iPhone. Never fires on Android/desktop.
    const handleGesture = (e: Event) => {
      if (enablePinch) e.preventDefault();
    };
    el.addEventListener("gesturestart", handleGesture, { passive: false });
    el.addEventListener("gesturechange", handleGesture, { passive: false });
    el.addEventListener("gestureend", handleGesture, { passive: false });

    // capture ref instance now so cleanup matches the handlers (keeps exhaustive-deps happy)
    const stateForCleanup = stateRef.current;
    return () => {
      el.removeEventListener("touchstart", handleStart);
      el.removeEventListener("touchmove", handleMove);
      el.removeEventListener("touchend", handleEnd);
      el.removeEventListener("touchcancel", handleEnd);
      el.removeEventListener("gesturestart", handleGesture);
      el.removeEventListener("gesturechange", handleGesture);
      el.removeEventListener("gestureend", handleGesture);
      // drop pending tap timer so it can't fire after unmount
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
}
