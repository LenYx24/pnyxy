// Live-tray zoom driver. PdfViewer owns the actual zoom — it mounts
// the tray + sizer DOM and the per-frame math that mutates them — and
// publishes a small set of imperative entry points here. ReaderPage's
// mobile pinch handler and the desktop double-tap zoom call these
// directly, so neither the touch path nor the wheel path has to know
// about React state or the tray's internal coordinate model.
//
// Why module-level state: the gesture source (touch handler in
// ReaderPage) and the state owner (PdfViewer's tray refs) live in
// different React subtrees that don't share a context. A registration
// pattern keeps them decoupled — PdfViewer fills these on mount,
// ReaderPage calls them ignorant of mounting order.

export interface ZoomGestureControls {
  /** Start a gesture pivoted at viewport coords (midX, midY). The
   *  controller captures whatever it needs (scroll, sizer offset,
   *  current scale) so subsequent `update` calls only need the
   *  scale-since-begin scalar. */
  begin: (midX: number, midY: number) => void;
  /** Apply a new gesture scale (relative to begin). Mutates tray /
   *  sizer / scroll synchronously; returns immediately. Coalesce in
   *  rAF at the call site if you receive events faster than 60 Hz. */
  update: (scaleSinceBegin: number) => void;
  /** End the gesture. The controller mirrors the final liveScale into
   *  the store (debounced) and clears any per-gesture state. */
  end: () => void;
  /** Set liveScale to an absolute value, animated optionally. Used by
   *  toolbar buttons (zoom in/out, fit-width, fit-page) and the
   *  double-tap-to-zoom path. */
  setAbsolute: (
    scale: number,
    options?: { pivotX?: number; pivotY?: number; animate?: boolean },
  ) => void;
  /** Read the current liveScale without going through React. Used by
   *  the toolbar's double-tap toggle to decide whether the page is
   *  currently "zoomed in" or at fit. */
  getScale: () => number;
}

let registered: ZoomGestureControls | null = null;

export function registerZoomControls(controls: ZoomGestureControls | null) {
  registered = controls;
}

export function getZoomControls(): ZoomGestureControls | null {
  return registered;
}
