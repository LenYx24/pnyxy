// Imperative pinch-zoom controller for the PDF viewer. The previous
// implementation drove `liveZoomScale` through Zustand on every
// touchmove, which rebuilt the documents Map and re-rendered the entire
// viewer subtree 60×/sec. It also pinned `transform-origin` to
// "top center", so the page never expanded out of the user's pinch
// point — just slid around relative to it.
//
// This module owns the live transform directly on the DOM element. No
// React state changes during the gesture; the store is only touched
// once on touchend to commit the final scale into `zoomLevel`. The
// transform follows the finger midpoint so the page expands from where
// the user pinched, the way Google's PDF viewer does it.

let target: HTMLElement | null = null;

interface PinchState {
  active: boolean;
  /** Element-local coords of the initial pinch midpoint — used as
   *  transform-origin so scaling pivots around the focal point. */
  originX: number;
  originY: number;
  /** Viewport coords of the initial midpoint; the delta to the live
   *  midpoint becomes the translate offset (so the page tracks the
   *  user's hand if their fingers drift mid-pinch). */
  startMidX: number;
  startMidY: number;
  /** Last applied scale, kept so endPinch can return it without the
   *  caller having to thread it through every move event. */
  scale: number;
  /** Last applied translate, kept so the post-commit scroll math can
   *  convert hand-drift into a scroll adjustment. */
  dx: number;
  dy: number;
}

const state: PinchState = {
  active: false,
  originX: 0,
  originY: 0,
  startMidX: 0,
  startMidY: 0,
  scale: 1,
  dx: 0,
  dy: 0,
};

export function registerPinchTarget(el: HTMLElement | null) {
  target = el;
}

export function beginPinch(midX: number, midY: number) {
  if (!target) return;
  const rect = target.getBoundingClientRect();
  state.active = true;
  state.startMidX = midX;
  state.startMidY = midY;
  state.originX = midX - rect.left;
  state.originY = midY - rect.top;
  state.scale = 1;
  state.dx = 0;
  state.dy = 0;
  target.style.willChange = "transform";
  target.style.transformOrigin = `${state.originX}px ${state.originY}px`;
}

export function updatePinch(scale: number, midX: number, midY: number) {
  if (!target || !state.active) return;
  state.scale = scale;
  state.dx = midX - state.startMidX;
  state.dy = midY - state.startMidY;
  target.style.transform = `translate3d(${state.dx}px, ${state.dy}px, 0) scale(${scale})`;
}

/** End the pinch. Returns the final scale (≈1 if no actual pinch
 *  happened) plus the translate delta so the caller can fold it into
 *  scrollTop / scrollLeft after committing zoomLevel. */
export function endPinch(): { scale: number; dx: number; dy: number } {
  const result = { scale: state.scale, dx: state.dx, dy: state.dy };
  if (target) {
    target.style.transform = "";
    target.style.transformOrigin = "";
    target.style.willChange = "";
  }
  state.active = false;
  state.scale = 1;
  state.dx = 0;
  state.dy = 0;
  return result;
}
