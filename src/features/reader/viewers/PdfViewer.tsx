import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { useReaderStore, useDocumentState } from "@/stores/reader-store";
import { useSettingsStore } from "@/stores/settings-store";
import { getReaderPalette } from "@/lib/reader-themes";
import { logError } from "@/lib/logger";
import { useTextSelection } from "@/hooks/use-text-selection";
import { HighlightLayer } from "../layers/HighlightLayer";
import { AiCitationLayer } from "../layers/AiCitationLayer";
import { CitationQuoteHighlightLayer } from "../layers/CitationQuoteHighlightLayer";
import { SearchHighlightLayer } from "../layers/SearchHighlightLayer";
import { CommentMarkers } from "../layers/CommentMarkers";
import { InlineDrawLayer } from "../layers/InlineDrawLayer";
import { ReadProgressStrip } from "../controls/ReadProgressStrip";
import { AnnotationContextMenu } from "../popovers/AnnotationContextMenu";
import { CommentPopover } from "../popovers/CommentPopover";
import {
  registerZoomControls,
  type ZoomGestureControls,
} from "../gestures/pinch-zoom-controller";
import { Loader2 } from "lucide-react";

interface PageSlotProps {
  pageNum: number;
  offsetTop: number;
  pageWidth: number;
  pageHeight: number;
  /** Width at which react-pdf actually rasterizes the canvas. Constant
   *  for a session (grow-only) — set wide enough to cover any plausible
   *  display width so that container resize / panel resize change only
   *  the per-slot CSS scale, never re-trigger react-pdf's rasterizer.
   *  This is what eliminates the resize-blink: the canvas DOM stays
   *  identical, only its visual scale changes. */
  renderWidth: number;
  rotation: 0 | 90 | 180 | 270;
  onRenderSuccess: (pageNum: number) => void;
  /** Called when react-pdf fails to rasterize this page (corrupt page
   *  stream, unsupported filter, etc.) so the parent can log it. The
   *  slot itself shows a visible placeholder instead of blank white. */
  onRenderError: (pageNum: number, error: Error) => void;
}

// Renders one virtualized page + its overlay layers. The Page is
// rasterized at `renderWidth` (constant) and the slot's inner div
// applies a CSS `transform: scale(pageWidth / renderWidth)` so the
// visual size matches `pageWidth`. Container resize → pageWidth
// changes → per-slot scale recomputes → react-pdf does NOT re-render
// the canvas (its `width` prop didn't change). Same trick as our
// tray-level transform for zoom, applied one level deeper to also
// kill resize-blink.
const PageSlot = memo(function PageSlot({
  pageNum,
  offsetTop,
  pageWidth,
  pageHeight,
  renderWidth,
  rotation,
  onRenderSuccess,
  onRenderError,
}: PageSlotProps) {
  // Effective render width — fall back to display width on the very
  // first frame before the parent has computed the session's render
  // baseline. Once renderWidth > 0 it stays that way and only ever
  // grows.
  const effectiveRenderW = renderWidth > 0 ? renderWidth : pageWidth;
  const slotScale =
    effectiveRenderW > 0 ? pageWidth / effectiveRenderW : 1;
  // Skip a needless transform when the scale would be 1 (within FP
  // noise) so the layout effects pass straight through to the page.
  const useSlotTransform = Math.abs(slotScale - 1) > 0.001;

  // Belt-and-suspenders: if a stale `dimensions` entry ever does
  // sneak NaN into `offsetTop`, render the slot at the top of the
  // tray instead of emitting `top: NaN` into the DOM (which only
  // produces a console warning and a visually-stuck page anyway).
  const safeOffsetTop = Number.isFinite(offsetTop) ? offsetTop : 0;

  return (
    <div
      style={{
        position: "absolute",
        top: safeOffsetTop,
        left: 0,
        width: "100%",
        display: "flex",
        justifyContent: "center",
      }}
    >
      {/* Outer keeps `pageWidth × pageHeight` of layout space. The
          inner has the actual rasterized canvas at `renderWidth` and
          is CSS-scaled down to fit. transform-origin: 0 0 keeps the
          inner's visual top-left aligned with the outer's. */}
      <div style={{ width: pageWidth, height: pageHeight, position: "relative" }}>
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            transform: useSlotTransform
              ? `scale(${slotScale})`
              : undefined,
            transformOrigin: useSlotTransform ? "0 0" : undefined,
          }}
        >
          <Page
            pageNumber={pageNum}
            rotate={rotation}
            width={effectiveRenderW}
            // Explicit `renderTextLayer` is the default in react-pdf
            // 10, but stating it kills the class of bugs where a
            // future codepath flips it off silently — text selection
            // would just stop working for one breakpoint or one
            // upload type. Same reasoning for renderAnnotationLayer,
            // which carries links + form fields out of the box.
            renderTextLayer={true}
            renderAnnotationLayer={true}
            loading={
              <div style={{ height: pageHeight, width: effectiveRenderW }} />
            }
            // A per-page failure used to render as blank white with no
            // signal (react-pdf's Page has no default error UI and the
            // document-level `error` only fires on a total load failure).
            // Show a visible placeholder AND log the real cause so an
            // "all-white PDF" becomes diagnosable instead of silent.
            error={
              <div
                style={{ height: pageHeight, width: effectiveRenderW }}
                className="flex items-center justify-center p-2 text-center text-2xs text-danger"
              >
                Page {pageNum} couldn't be displayed.
              </div>
            }
            onRenderSuccess={() => onRenderSuccess(pageNum)}
            onRenderError={(error) => onRenderError(pageNum, error)}
          />
          <HighlightLayer pageNum={pageNum} />
          <AiCitationLayer pageNum={pageNum} />
          <CitationQuoteHighlightLayer pageNum={pageNum} />
          <SearchHighlightLayer pageNum={pageNum} />
          <CommentMarkers pageNum={pageNum} />
          <InlineDrawLayer pageNum={pageNum} />
        </div>
      </div>
    </div>
  );
});

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf-assets/pdf.worker.min.mjs";

const PAGE_GAP = 12;
const A4_RATIO = 1.4142;
const STORE_COMMIT_DEBOUNCE_MS = 250;
// Min/max liveScale, matches the store's ZOOM_MIN/MAX (25 / 1000) so
// store-driven and gesture-driven zoom share the same envelope.
const MIN_SCALE = 0.25;
const MAX_SCALE = 10;

function upperBound(arr: number[], target: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

interface PageDimensions {
  width: number;
  height: number;
}

interface PdfViewerProps {
  documentId?: string;
}

export function PdfViewer({ documentId }: PdfViewerProps) {
  const activeDocumentId = useReaderStore((s) => s.activeDocumentId);
  const docId = documentId ?? activeDocumentId;
  const doc = useDocumentState(docId ?? "");

  const setCurrentPage = useReaderStore((s) => s.setCurrentPage);
  const setScrollOffset = useReaderStore((s) => s.setScrollOffset);
  const clearScrollRequest = useReaderStore((s) => s.clearScrollRequest);
  const setZoomLevel = useReaderStore((s) => s.setZoomLevel);

  const meta = doc?.meta ?? null;
  const totalPages = doc?.totalPages ?? 0;
  const zoomMode = doc?.zoomMode ?? "fit-width";
  const zoomLevel = doc?.zoomLevel ?? 100;
  const rotation = doc?.pageRotation ?? 0;
  const scrollToPage = doc?.scrollToPage ?? null;
  const invertColors = useSettingsStore((s) => s.pdfInvertColors);
  const readerTheme = useSettingsStore((s) => s.readerTheme);

  const offsetReportTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const sizerRef = useRef<HTMLDivElement>(null);
  const trayRef = useRef<HTMLDivElement>(null);
  useTextSelection(containerRef);

  const [containerWidth, setContainerWidth] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);
  // Real measured page dimensions, keyed by page number. Stored as
  // state (not a ref) so getPageHeight reads it cleanly during render
  // and the layout pipeline picks up new measurements naturally.
  // handlePageRenderSuccess merges via functional setState to avoid
  // closure staleness when multiple pages render in the same tick.
  const [dimensions, setDimensions] = useState<Map<number, PageDimensions>>(
    () => new Map(),
  );
  const rafRef = useRef<number>(0);

  // The single source of truth for visual zoom. Lives in a ref +
  // directly on the DOM (tray transform, sizer dimensions); only
  // mirrored to the store after STORE_COMMIT_DEBOUNCE_MS of idle, so
  // gesture frames don't churn React. Read with `getLiveScale`,
  // written via `applyScale` / the store-sync useLayoutEffect.
  const liveScaleRef = useRef(1);
  const storeCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // React-visible mirror of liveScaleRef. Driven by applyScale via a
  // functional setter that returns prev when sub-threshold (0.5 % of
  // scale), so React only re-renders when the visible-pages math
  // actually needs to. Declared before applyScale because that
  // callback closes over the dispatcher.
  const [liveScaleTrigger, setLiveScaleTrigger] = useState(1);
  // True while the user is mid-zoom (any wheel/pinch event in the last
  // ~250 ms). When true, visiblePages expands its render window so
  // pages that *might* enter view as the user keeps zooming are
  // already mounted — no "loading" placeholder flash mid-gesture.
  // Ref + state pair: the ref dedups so we don't dispatch setState on
  // every wheel event, the state drives the visiblePages re-memo.
  const [zoomBoostActive, setZoomBoostActive] = useState(false);
  const zoomBoostRef = useRef(false);
  const setZoomBoost = useCallback((active: boolean) => {
    if (zoomBoostRef.current === active) return;
    zoomBoostRef.current = active;
    setZoomBoostActive(active);
  }, []);

  // Most-recent target of a programmatic scroll write. The scroll
  // handler compares its incoming scrollTop/Left against this to
  // know whether the event came from us (the zoom-pivot anchor,
  // the resume effect, or the scroll-to-page) vs the user. Replaces
  // the old `programmaticScrollRef + setTimeout(100)` flag, which
  // failed on slow mobile devices when the async scroll event landed
  // after the 100ms timer cleared the flag. The marker is consumed
  // (set back to null) once the scroll handler sees a matching
  // event, so a single write is good for exactly one event.
  const programmaticScrollTargetRef = useRef<{ top: number; left: number } | null>(null);
  /** Set by `handleScroll` after each scroll event so downstream
   *  effects (offset-report) can know whether this scroll was ours
   *  or a real user scroll. Single-shot — the consumer clears it. */
  const lastScrollWasProgrammaticRef = useRef(false);
  /** Commit a programmatic scroll and arm the matching marker so
   *  `handleScroll` recognises the resulting event as ours.
   *  Containers' scrollLeft/Top are clamped by the browser, so we
   *  also clamp here against the live max to make the matcher
   *  bullet-proof when the requested target is past the edge. */
  const writeProgrammaticScroll = (
    el: HTMLElement,
    top: number,
    left: number = el.scrollLeft,
  ) => {
    const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
    const maxLeft = Math.max(0, el.scrollWidth - el.clientWidth);
    const ct = clamp(top, 0, maxTop);
    const cl = clamp(left, 0, maxLeft);
    programmaticScrollTargetRef.current = { top: ct, left: cl };
    el.scrollTop = ct;
    el.scrollLeft = cl;
  };
  /** Returns true and consumes the marker iff the current scroll
   *  values match the most recent programmatic target (within 1px).
   *  Callers use this to skip user-scroll side effects (clearing
   *  resumeTargetRef, persisting scrollOffset). */
  const consumeProgrammaticScroll = (el: HTMLElement): boolean => {
    const target = programmaticScrollTargetRef.current;
    if (!target) return false;
    const matches =
      Math.abs(el.scrollTop - target.top) <= 1 &&
      Math.abs(el.scrollLeft - target.left) <= 1;
    if (matches) {
      programmaticScrollTargetRef.current = null;
      return true;
    }
    return false;
  };
  const resumeTargetRef = useRef<{
    page: number;
    offset: number;
    expiresAt: number;
  } | null>(null);

  // The page + in-page fraction currently pinned to the viewport TOP,
  // refreshed on every *user* scroll. Width-independent (page index +
  // fraction, not pixels), so it survives a panel resize: after the
  // pages reflow to the new width we restore scrollTop so this exact
  // point stays at the top of the panel — Google-PDF behaviour. The
  // persisted currentPage/scrollOffset can't drive this because they're
  // viewport-CENTRE based, so anchoring them to the top shifts the view
  // by ~half a panel on every resize.
  const topAnchorRef = useRef<{ page: number; fraction: number } | null>(
    null,
  );

  // True once the user drives the scroll themselves (wheel or scrollbar
  // drag). This permanently disarms the resume re-snap for the current
  // view so it can't yank the viewport back to the open/TOC position
  // mid-scroll. It's gated on *input intent*, not scroll-position
  // matching, because during a scroll the re-snap's own programmatic
  // write can land last within a frame — the coalesced scroll event then
  // matches the programmatic marker and `handleScroll` mis-reads the
  // user's scroll as "ours", so `resumeTargetRef` never clears and the
  // re-snap fights the user for the whole 5 s window. Reset to false by
  // the scroll-to-page effect below (the single legitimate re-arm point:
  // doc open, TOC / search / citation jump).
  const userScrolledRef = useRef(false);

  // The exact scrollTop the resume system last wrote. A native scrollbar
  // drag fires NO wheel/pointer event we can catch, and — because our
  // re-snap can overwrite the dragged position within the same frame —
  // the coalesced scroll event `handleScroll` sees is our target, not the
  // user's, so the userScrolledRef signal above never trips for a drag.
  // The reliable tell is drift: if on a re-snap tick el.scrollTop differs
  // from what we last wrote, something OTHER than us moved the scroll
  // between writes = the user is dragging. (Pages are absolutely
  // positioned in a fixed-height tray, so layout reflow never moves
  // scrollTop — any drift is genuinely the user.)
  const lastResumeWriteRef = useRef<number | null>(null);

  const prevRotationRef = useRef(rotation);
  useLayoutEffect(() => {
    if (prevRotationRef.current === rotation) return;
    prevRotationRef.current = rotation;
    // Rotation invalidates every cached page dimension (90°/270° swaps
    // width/height). Resetting forces handlePageRenderSuccess to
    // re-measure as new renders land.
    setDimensions(new Map());
  }, [rotation]);

  // Track container size — rAF-throttled (NOT debounced). The old 150ms
  // debounce existed because renderWidth used to track the display
  // width, so every resize step re-rasterized → flicker, and deferring
  // to one trailing fire hid most of it. But that also froze the page
  // at its old size during the whole drag and then SNAPPED to the new
  // layout on release — the jarring "blink + a dark gap before the page
  // repaints" the user sees. Now that renderWidth is window-based and
  // constant (see below), a resize step is pure CSS (page width →
  // per-slot scale, tray width, offsets) with NO re-rasterize, so we
  // can update live and let the page track the divider smoothly. rAF
  // coalesces the ResizeObserver burst to one update per frame.
  const resizeRafRef = useRef<number>(0);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    setContainerWidth(el.clientWidth);
    setContainerHeight(el.clientHeight);

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      if (resizeRafRef.current) cancelAnimationFrame(resizeRafRef.current);
      resizeRafRef.current = requestAnimationFrame(() => {
        setContainerWidth(entry.contentRect.width);
        setContainerHeight(entry.contentRect.height);
      });
    });

    observer.observe(el);
    return () => {
      observer.disconnect();
      if (resizeRafRef.current) cancelAnimationFrame(resizeRafRef.current);
    };
  }, []);

  // baselineWidth = the tray-local width of every page (1× scale).
  // The TRAY's CSS transform handles visual zoom; the PER-SLOT
  // transform handles the gap between baselineWidth (display) and
  // renderWidth (rasterization). With containerWidth - 48 padding,
  // fit-width === 1× zoom.
  const baselineWidth = containerWidth > 0 ? containerWidth - 48 : 600;

  // renderWidth = the width at which react-pdf actually rasterizes.
  // Grow-only: shrinking the panel keeps the larger canvas + lets a
  // per-slot CSS down-scale handle the smaller display, so resize-down
  // never re-rasterizes. Resize-up beyond the largest size we've seen
  // does re-rasterize (one blink), then the new larger size sticks.
  //
  // Why we DON'T pin to window-width × 1.5: react-pdf's canvas backing
  // store is `W × devicePixelRatio` pixels. On a Retina laptop (DPR=2)
  // a 2880-px logical render becomes ~5760 px backing, ~187 MB / page.
  // That tanked scrolling and doc-open. Pinning to display width keeps
  // memory proportional to what's actually visible. See react-pdf
  // issues #1760, #1705, #875 for the underlying constraint.
  const RENDER_GROWTH_HEADROOM = 1.1;
  const RENDER_WIDTH_CAP = 1800;
  const [renderWidth, setRenderWidth] = useState(0);
  useLayoutEffect(() => {
    if (baselineWidth <= 0) return;
    // Rasterize at the WIDEST the panel could plausibly reach (the
    // window width), NOT the current panel width. A panel can't grow
    // past the window, so dragging a side-panel divider never pushes
    // the display beyond the canvas we already have — which is exactly
    // what used to re-rasterize every page mid-drag and produce the
    // resize "blink" (react-pdf swaps the canvas for an empty loading
    // box while it re-renders). Basing the target on the window means a
    // single rasterize covers every panel size, so panel resizes only
    // CSS-scale and never blink. Still grow-only + capped, so memory
    // stays bounded; only a window-resize-up (rare) re-rasterizes.
    const maxDisplay = Math.max(
      baselineWidth,
      typeof window !== "undefined" ? window.innerWidth : baselineWidth,
    );
    const target = Math.min(maxDisplay * RENDER_GROWTH_HEADROOM, RENDER_WIDTH_CAP);
    setRenderWidth((prev) => (target > prev ? target : prev));
  }, [baselineWidth]);

  // Estimate page height from cached dimensions or A4 ratio.
  // Defensive: a stray cache entry with `width=0` or non-finite
  // values would otherwise propagate NaN into `pageOffsets[]` and
  // every downstream `top: <number>` style. We've seen this in the
  // wild when react-pdf's onLoadSuccess fired before the page had
  // intrinsic dimensions; the resulting NaN is invisible until the
  // browser logs an "invalid value for top" warning on every page
  // mount. Fall back to the A4 estimate in that case.
  const getPageHeight = useCallback(
    (pageNum: number): number => {
      const cached = dimensions.get(pageNum);
      if (
        cached &&
        Number.isFinite(cached.width) &&
        Number.isFinite(cached.height) &&
        cached.width > 0 &&
        cached.height > 0
      ) {
        const scale = baselineWidth / cached.width;
        const height = cached.height * scale;
        if (Number.isFinite(height) && height > 0) return height;
      }
      const fallback = baselineWidth * A4_RATIO;
      return Number.isFinite(fallback) && fallback > 0
        ? fallback
        : 600 * A4_RATIO;
    },
    [baselineWidth, dimensions],
  );

  // pageOffsets and totalContentHeight are in **tray-local** (pre-CSS-
  // scale) coordinates. Multiply by liveScale to get container-scroll
  // coords.
  const pageOffsets = useMemo(() => {
    if (totalPages === 0) return [];
    const offsets: number[] = [0];
    for (let i = 1; i < totalPages; i++) {
      offsets.push(offsets[i - 1] + getPageHeight(i) + PAGE_GAP);
    }
    return offsets;
  }, [totalPages, getPageHeight]);

  const totalContentHeight = useMemo(() => {
    if (totalPages === 0 || pageOffsets.length === 0) return 0;
    return pageOffsets[totalPages - 1] + getPageHeight(totalPages) + PAGE_GAP;
  }, [totalPages, pageOffsets, getPageHeight]);

  // Refs mirror the latest derived values for use inside event-time
  // closures (the wheel handler is set up once and reads these on
  // every gesture frame). Updated in a layout effect so the writes
  // don't happen during render.
  const baselineWidthRef = useRef(baselineWidth);
  const totalContentHeightRef = useRef(totalContentHeight);
  useLayoutEffect(() => {
    baselineWidthRef.current = baselineWidth;
    totalContentHeightRef.current = totalContentHeight;
  }, [baselineWidth, totalContentHeight]);

  // Imperatively size the sizer to `baselineWidth × liveScale`,
  // `totalContentHeight × liveScale`. This runs synchronously after
  // every render (no deps), so any time React commits — gesture
  // trigger, store update, dimensions update — the sizer dimensions
  // get reasserted from the imperative source of truth before the
  // browser paints. Kills the snap bug: there's no longer a window
  // where the DOM has the JSX-declared unscaled values.
  //
  // Critical: skip the write when dimensions match what's already on
  // the element. `handleScroll` fires a `setScrollTop` on every
  // scroll event (vertical and horizontal alike), and a re-write
  // here — even of identical values — can trigger the browser's
  // scroll-position clamping pass mid-drag. That manifested as the
  // horizontal scrollbar "moving a bit, then snapping back to 0"
  // when the user dragged it on a zoomed-in page. The string
  // comparison is cheap; the layout side-effect of an unneeded write
  // is not.
  useLayoutEffect(() => {
    const sizerEl = sizerRef.current;
    if (!sizerEl) return;
    const scale = liveScaleRef.current;
    const nextWidth = `${baselineWidth * scale}px`;
    const nextHeight = `${totalContentHeight * scale}px`;
    if (
      sizerEl.style.width === nextWidth &&
      sizerEl.style.height === nextHeight
    ) {
      return;
    }
    // Save scroll across the write. When the sizer's box actually
    // does change size — e.g. a freshly-measured page replaced an
    // A4-estimated height with a smaller real height — the browser
    // clamps both axes to the new bounds. Restore them so an
    // in-progress horizontal scrollbar drag isn't yanked back to 0.
    const containerEl = containerRef.current;
    const prevLeft = containerEl?.scrollLeft ?? 0;
    const prevTop = containerEl?.scrollTop ?? 0;
    sizerEl.style.width = nextWidth;
    sizerEl.style.height = nextHeight;
    if (containerEl) {
      if (containerEl.scrollLeft !== prevLeft) {
        containerEl.scrollLeft = prevLeft;
      }
      if (containerEl.scrollTop !== prevTop) {
        containerEl.scrollTop = prevTop;
      }
    }
  });

  // Apply the scale + scroll math imperatively. Runs 60×/sec during a
  // gesture, so it touches only DOM and refs (no React state writes;
  // setLiveScaleTrigger uses a functional updater that returns prev
  // when the change is sub-threshold, so React only re-renders when
  // the visible-pages math actually needs to update).
  //
  // Math: after the scale change, we want the tray-local point
  // (logicalX, logicalY) to land at viewport (focalX, focalY). The
  // sizer's viewport rect after the style write tells us where the
  // tray's origin is; solving for scrollLeft/Top so the focal stays
  // pinned is one subtraction. Using getBoundingClientRect rather than
  // offsetLeft/Top sidesteps any "which ancestor is the offsetParent"
  // surprises from the flex centering wrapper.
  const applyScale = useCallback(
    (
      newScale: number,
      logicalX: number,
      logicalY: number,
      focalViewportX: number,
      focalViewportY: number,
    ) => {
      const containerEl = containerRef.current;
      const sizerEl = sizerRef.current;
      const trayEl = trayRef.current;
      if (!containerEl || !sizerEl || !trayEl) return;

      const clampedScale = clamp(newScale, MIN_SCALE, MAX_SCALE);
      // Capture old scale BEFORE we overwrite the ref so the ratio
      // below is meaningful.
      const oldScale = liveScaleRef.current;
      liveScaleRef.current = clampedScale;

      const baseW = baselineWidthRef.current;
      const baseH = totalContentHeightRef.current;
      sizerEl.style.width = `${baseW * clampedScale}px`;
      sizerEl.style.height = `${baseH * clampedScale}px`;
      trayEl.style.transform = `scale(${clampedScale})`;

      // Anchor the *logical* viewport top/left across the scale
      // change instead of pivoting at the focal point. The old
      // formula computed scroll so that the logical (x, y) under
      // `focalViewport*` stayed put, which is correct Google-Maps
      // pivot math but on a PDF reader read as "the page jumps
      // away from my eyes every time I zoom" — the cursor / centre
      // / wherever-the-pivot-was rarely matched the place the user
      // was actually looking. Multiplying the old scrollTop/Left by
      // the scale ratio keeps the upper-left corner of what's
      // visible (top of the page you're reading) anchored to its
      // viewport position. The `focalViewport*` / `logical*` args
      // are now ignored — callers can pass anything.
      const oldScrollLeft = containerEl.scrollLeft;
      const oldScrollTop = containerEl.scrollTop;
      const ratio = oldScale > 0 ? clampedScale / oldScale : 1;
      const newScrollLeft = oldScrollLeft * ratio;
      const newScrollTop = oldScrollTop * ratio;
      void focalViewportX;
      void focalViewportY;
      void logicalX;
      void logicalY;

      // Arm the programmatic-scroll marker so the resulting scroll
      // event doesn't get mis-attributed to user input (which would
      // clear `resumeTargetRef` and break URL-deep-link / TOC-jump
      // scroll restoration). The marker carries the exact target,
      // not a time-window — the scroll handler matches the new
      // values against it instead of racing a setTimeout(100ms).
      writeProgrammaticScroll(containerEl, newScrollTop, newScrollLeft);

      // Bump the React trigger when the scale moved enough to matter
      // for visible-pages virtualization. Functional updater returning
      // `prev` skips the re-render when sub-threshold — same throttle
      // as the old idle-rAF tick, with no battery cost when idle.
      setLiveScaleTrigger((prev) =>
        Math.abs(prev - clampedScale) > 0.005 ? clampedScale : prev,
      );
    },
    [],
  );

  // Mirror the live scale into the store as `zoomLevel` (mode = custom)
  // after the user stops zooming. Debounced so a gesture only triggers
  // one React render, and that render arrives *after* the gesture
  // settles — visually the user sees no transition flash.
  const scheduleStoreCommit = useCallback(() => {
    if (storeCommitTimerRef.current) clearTimeout(storeCommitTimerRef.current);
    storeCommitTimerRef.current = setTimeout(() => {
      storeCommitTimerRef.current = null;
      const scale = liveScaleRef.current;
      // Skip if the store already matches — avoids ping-pong between
      // this commit and the store-sync useLayoutEffect. Stored as a
      // float (no rounding) so the round-trip is exact.
      const currentLevel = useReaderStore.getState().documents.get(docId ?? "")
        ?.zoomLevel;
      const desiredLevel = scale * 100;
      if (currentLevel != null && Math.abs(currentLevel - desiredLevel) < 0.5) {
        return;
      }
      setZoomLevel(desiredLevel, docId ?? undefined);
    }, STORE_COMMIT_DEBOUNCE_MS);
  }, [docId, setZoomLevel]);

  // Per-gesture state. The controller's begin/update/end mutate this
  // and call applyScale; nothing here goes through React.
  const gestureRef = useRef<{
    active: boolean;
    startScale: number;
    logicalX: number;
    logicalY: number;
    focalX: number;
    focalY: number;
  }>({
    active: false,
    startScale: 1,
    logicalX: 0,
    logicalY: 0,
    focalX: 0,
    focalY: 0,
  });

  const beginGesture = useCallback(
    (focalViewportX: number, focalViewportY: number) => {
      const sizerEl = sizerRef.current;
      if (!sizerEl) return;
      const sizerRect = sizerEl.getBoundingClientRect();
      const scale = liveScaleRef.current;
      // tray-local (logical) coords of the focal point. The cursor's
      // visual offset from the sizer's left edge is just
      // (focalX - sizerRect.left); divide by scale to get tray-local.
      const logicalX = (focalViewportX - sizerRect.left) / scale;
      const logicalY = (focalViewportY - sizerRect.top) / scale;
      gestureRef.current = {
        active: true,
        startScale: scale,
        logicalX,
        logicalY,
        focalX: focalViewportX,
        focalY: focalViewportY,
      };
      // GPU-promote the tray for the gesture. Cleared on end so we
      // don't pin a layer forever.
      const trayEl = trayRef.current;
      if (trayEl) trayEl.style.willChange = "transform";
      setZoomBoost(true);
    },
    [setZoomBoost],
  );

  const updateGesture = useCallback(
    (scaleSinceBegin: number) => {
      const g = gestureRef.current;
      if (!g.active) return;
      applyScale(
        g.startScale * scaleSinceBegin,
        g.logicalX,
        g.logicalY,
        g.focalX,
        g.focalY,
      );
    },
    [applyScale],
  );

  const endGesture = useCallback(() => {
    const g = gestureRef.current;
    if (!g.active) return;
    g.active = false;
    const trayEl = trayRef.current;
    if (trayEl) trayEl.style.willChange = "";
    setZoomBoost(false);
    scheduleStoreCommit();
  }, [scheduleStoreCommit, setZoomBoost]);

  const setAbsolute = useCallback<ZoomGestureControls["setAbsolute"]>(
    (scale, options) => {
      const containerEl = containerRef.current;
      const sizerEl = sizerRef.current;
      if (!containerEl || !sizerEl) return;
      // Default pivot: viewport center.
      const containerRect = containerEl.getBoundingClientRect();
      const focalX = options?.pivotX ?? containerRect.left + containerRect.width / 2;
      const focalY = options?.pivotY ?? containerRect.top + containerRect.height / 2;
      const sizerRect = sizerEl.getBoundingClientRect();
      const oldScale = liveScaleRef.current;
      const logicalX = (focalX - sizerRect.left) / oldScale;
      const logicalY = (focalY - sizerRect.top) / oldScale;
      applyScale(scale, logicalX, logicalY, focalX, focalY);
      scheduleStoreCommit();
    },
    [applyScale, scheduleStoreCommit],
  );

  // Register the imperative entry points so ReaderPage's mobile
  // pinch handler and double-tap handler can drive the tray without
  // reaching into PdfViewer's internals.
  useEffect(() => {
    const controls: ZoomGestureControls = {
      begin: beginGesture,
      update: updateGesture,
      end: endGesture,
      setAbsolute,
      getScale: () => liveScaleRef.current,
    };
    registerZoomControls(controls);
    return () => registerZoomControls(null);
  }, [beginGesture, updateGesture, endGesture, setAbsolute]);

  // Ctrl+wheel cursor-pivot zoom — Google PDF / Maps style. ctrlKey
  // also fires on trackpad pinch (macOS / Windows synthesise pinch
  // as ctrl+wheel).
  //
  // Each wheel event re-anchors the pivot to the *current* cursor
  // position — there's no per-gesture lock, so moving the cursor
  // mid-zoom always pivots around where the cursor IS RIGHT NOW. The
  // rAF flush computes logical coords from the live sizerRect at flush
  // time, so the math sees the latest scale even if multiple events
  // batched into one frame.
  //
  // Zoom acceleration: rapid consecutive events grow `burstMul` (cap
  // 3×) which scales the per-event delta. A gap >200 ms decays back
  // to 1×. This is the "the more you scroll, the bigger each step
  // gets" behavior of Google PDF / Photoshop. Calm one-detent-at-a-
  // time zoom keeps its 15 % step; flicking the wheel gets you across
  // the document fast.
  //
  // Plain wheel scrolling scales by `1 / sqrt(liveScale)` so that at
  // 4× zoom each detent scrolls half the visual distance — matches
  // Google Maps' "zoomed in = finer pan" intuition.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let pendingDeltaY = 0;
    let pendingFocalX = 0;
    let pendingFocalY = 0;
    let pending = false;
    let lastEventTime = 0;
    // Acceleration latch: count consecutive *fast* events. The boost
    // only starts growing once we've seen FAST_RAMP_THRESHOLD of them
    // back-to-back, so a short flurry of casual zooming feels exactly
    // like single-detent zoom — only sustained rapid wheeling triggers
    // the burst multiplier.
    let fastCount = 0;
    let burstMul = 1;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    let trayPromoted = false;

    // Smooth-scroll target tracking. We animate the container's
    // scrollTop/Left toward a target with rAF-driven exponential
    // easing — accumulating deltas across rapid wheel events so a
    // burst feels like one continuous glide rather than N back-to-
    // back jumps. Replaces the old `behavior: "auto"` instant scroll.
    let scrollTargetY = 0;
    let scrollTargetX = 0;
    let scrollAnimating = false;
    let scrollAnimRaf = 0;
    // Same acceleration shape as the zoom burst: only kicks in after
    // sustained rapid scrolling, so single detents stay calm.
    let lastScrollEventTime = 0;
    let scrollFastCount = 0;
    let scrollBurstMul = 1;
    const SCROLL_LERP = 0.25;
    const SCROLL_FAST_DT_MS = 60;
    const SCROLL_FAST_THRESHOLD = 5;

    const animateScrollFrame = () => {
      scrollAnimRaf = 0;
      const curY = el.scrollTop;
      const curX = el.scrollLeft;
      const dy = scrollTargetY - curY;
      const dx = scrollTargetX - curX;
      if (Math.abs(dy) < 0.5 && Math.abs(dx) < 0.5) {
        el.scrollTop = scrollTargetY;
        el.scrollLeft = scrollTargetX;
        scrollAnimating = false;
        return;
      }
      el.scrollTop = curY + dy * SCROLL_LERP;
      el.scrollLeft = curX + dx * SCROLL_LERP;
      scrollAnimRaf = requestAnimationFrame(animateScrollFrame);
    };

    const smoothScrollBy = (dy: number, dx: number) => {
      if (!scrollAnimating) {
        // Re-anchor target to current position so we don't lerp from
        // a stale target after the user manually scrolled (scrollbar
        // drag, programmatic jump, etc.).
        scrollTargetY = el.scrollTop;
        scrollTargetX = el.scrollLeft;
        scrollAnimating = true;
      }
      const maxY = Math.max(0, el.scrollHeight - el.clientHeight);
      const maxX = Math.max(0, el.scrollWidth - el.clientWidth);
      scrollTargetY = clamp(scrollTargetY + dy, 0, maxY);
      scrollTargetX = clamp(scrollTargetX + dx, 0, maxX);
      if (!scrollAnimRaf) {
        scrollAnimRaf = requestAnimationFrame(animateScrollFrame);
      }
    };

    // Abort any in-flight smooth-scroll animation. Called when the
    // user's intent shifts away from scrolling — e.g., they start
    // Ctrl+wheel-zooming, in which case our lerp toward the stale
    // scroll target would fight applyScale's cursor-pivot scroll
    // writes and produce a visible up/down jitter during zoom.
    const cancelScrollAnimation = () => {
      if (scrollAnimRaf) {
        cancelAnimationFrame(scrollAnimRaf);
        scrollAnimRaf = 0;
      }
      scrollAnimating = false;
      scrollTargetY = el.scrollTop;
      scrollTargetX = el.scrollLeft;
    };

    const flush = () => {
      pending = false;
      if (pendingDeltaY === 0) return;
      const sizerEl = sizerRef.current;
      if (!sizerEl) {
        pendingDeltaY = 0;
        return;
      }
      const oldScale = liveScaleRef.current;
      const sizerRect = sizerEl.getBoundingClientRect();
      const logicalX = (pendingFocalX - sizerRect.left) / oldScale;
      const logicalY = (pendingFocalY - sizerRect.top) / oldScale;
      // 0.0015 coefficient: a single mouse-wheel detent (deltaY≈100)
      // gives exp(±0.15) ≈ ±16 % per click — comfortable click-by-
      // click control, especially in the low-zoom range where smaller
      // absolute steps prevent overshoot. Burst multiplier above only
      // kicks in for sustained rapid zoom, so calm zoom stays at this
      // rate.
      // The per-flush clamp bounds the change applied in one rAF
      // frame even when several wheel events accumulate into a single
      // flush — without it, a fast spin compounds (5 detents in 16 ms
      // → exp(0.75) ≈ +112 %) and feels jumpy. Across multiple frames
      // accumulated input still flows through, just at a bounded rate.
      // Tuning dials: the 0.0015 coefficient (per-event), and the
      // 0.78 / 1.28 clamps (per-flush ceiling/floor).
      const rawStep = Math.exp(-pendingDeltaY * 0.0015);
      const stepFactor = clamp(rawStep, 0.78, 1.28);
      applyScale(
        oldScale * stepFactor,
        logicalX,
        logicalY,
        pendingFocalX,
        pendingFocalY,
      );
      pendingDeltaY = 0;
    };

    const schedule = () => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(flush);
    };

    const handleWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) {
        // Any wheel scroll is unambiguous user intent — kill the resume
        // re-snap synchronously (before the smooth-scroll write) so it
        // can never fight this gesture, even if a re-snap write would
        // otherwise land last within the frame and be mis-read as ours.
        userScrolledRef.current = true;
        resumeTargetRef.current = null;

        // Scroll dampens with zoom-in (less detent → less travel) but
        // is capped at 1× when zoomed out — without the cap, at 50 %
        // zoom each detent moved 2× the visual distance, which felt
        // way too floaty.
        // Tuning dial: drop to e.g. 0.8 here for slower scrolling at
        // every zoom level, or remove the Math.min for the old
        // "scroll more when zoomed out" behavior.
        const scale = liveScaleRef.current || 1;
        const mul = Math.min(1.0, 1.0 / scale);

        // Scroll acceleration latch: same shape as the zoom burst.
        // Only after FAST_THRESHOLD consecutive fast events does
        // scrollBurstMul start growing; calm single-detent scroll
        // stays at 1×. Reset when events space out.
        const now = performance.now();
        const dt = now - lastScrollEventTime;
        if (dt < SCROLL_FAST_DT_MS) {
          scrollFastCount++;
          if (scrollFastCount > SCROLL_FAST_THRESHOLD) {
            scrollBurstMul = Math.min(3, scrollBurstMul * 1.1);
          }
        } else {
          scrollFastCount = 0;
          if (dt > 200) scrollBurstMul = 1;
        }
        lastScrollEventTime = now;
        const accelMul = mul * scrollBurstMul;

        if (e.shiftKey) {
          // Shift+wheel = horizontal scroll. Some platforms map this
          // to deltaX automatically; others leave deltaY and we have
          // to redirect. Use whichever axis carries the magnitude.
          const horizDelta = Math.abs(e.deltaX) > Math.abs(e.deltaY)
            ? e.deltaX
            : e.deltaY;
          if (horizDelta !== 0) {
            e.preventDefault();
            smoothScrollBy(0, horizDelta * accelMul);
          }
          return;
        }
        // Process every non-zero wheel delta through our smooth
        // scroller. The previous `>=40` threshold let touchpad's
        // decaying tail events (typical deltaY 5–30) fall through to
        // the browser's native scroll while our smooth-scroll
        // animation was still mid-flight toward an older target —
        // native scroll moved scrollTop, our rAF kept dragging it
        // back, and the user saw the viewport vibrate up/down at
        // the end of every gesture.
        if (e.deltaY !== 0 || e.deltaX !== 0) {
          e.preventDefault();
          smoothScrollBy(e.deltaY * accelMul, e.deltaX * accelMul);
        }
        return;
      }
      e.preventDefault();
      // User has switched from scrolling to zooming — kill any tail
      // scroll animation so it doesn't fight applyScale's cursor-pivot
      // scroll writes and produce up/down jitter during the zoom.
      cancelScrollAnimation();

      const now = performance.now();
      const dt = now - lastEventTime;
      const FAST_DT_MS = 60;
      const FAST_RAMP_THRESHOLD = 5;
      if (dt < FAST_DT_MS) {
        fastCount++;
        if (fastCount > FAST_RAMP_THRESHOLD) {
          // Past the ramp gate — sustained rapid zoom, start
          // accelerating. 1.10 per event, capped at 2.5×.
          burstMul = Math.min(2.5, burstMul * 1.1);
        }
      } else {
        // Any pause resets the counter so the next burst has to ramp
        // up again. burstMul itself only decays after a longer gap so
        // a tiny stutter inside a burst doesn't drop us back to 1×.
        fastCount = 0;
        if (dt > 200) burstMul = 1;
      }
      lastEventTime = now;

      pendingDeltaY += e.deltaY * burstMul;
      pendingFocalX = e.clientX;
      pendingFocalY = e.clientY;
      if (!trayPromoted) {
        const trayEl = trayRef.current;
        if (trayEl) trayEl.style.willChange = "transform";
        trayPromoted = true;
      }
      setZoomBoost(true);
      schedule();

      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        settleTimer = null;
        burstMul = 1;
        fastCount = 0;
        lastEventTime = 0;
        if (trayPromoted) {
          const trayEl = trayRef.current;
          if (trayEl) trayEl.style.willChange = "";
          trayPromoted = false;
        }
        setZoomBoost(false);
        scheduleStoreCommit();
      }, 200);
    };

    el.addEventListener("wheel", handleWheel, { passive: false });
    // Snapshot the tray node for cleanup so the listener tear-down
    // doesn't depend on the ref still pointing to a live element.
    const trayElForCleanup = trayRef.current;
    return () => {
      el.removeEventListener("wheel", handleWheel);
      if (settleTimer) clearTimeout(settleTimer);
      if (scrollAnimRaf) cancelAnimationFrame(scrollAnimRaf);
      if (trayPromoted && trayElForCleanup) {
        trayElForCleanup.style.willChange = "";
      }
    };
  }, [applyScale, scheduleStoreCommit, setZoomBoost]);

  // Determine visible pages — virtualization happens in tray-local
  // coords. Container scrollTop / scale = tray-local viewport top.
  const [scrollTop, setScrollTop] = useState(0);

  const [scrollVelocity, setScrollVelocity] = useState(0);
  const lastScrollSampleRef = useRef<{ y: number; t: number } | null>(null);
  const velocityDecayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );


  const visiblePages = useMemo(() => {
    if (totalPages === 0 || pageOffsets.length === 0) return [];
    const scale = liveScaleTrigger;
    const trayViewportTop = scrollTop / scale;
    const trayViewportH = containerHeight / scale;

    const fastScroll = scrollVelocity > 1.5;
    const aheadFactor = fastScroll
      ? Math.min(6, 2 + scrollVelocity * 0.8)
      : 2;
    const goingDown = scrollVelocity >= 0;
    let aboveFactor = goingDown ? 1 : aheadFactor;
    let belowFactor = goingDown ? aheadFactor : 1;
    if (zoomBoostActive) {
      // Pre-mount enough pages above/below that a fast zoom-out (which
      // triples the visible-page count) doesn't reveal blanks.
      aboveFactor = Math.max(aboveFactor, 3);
      belowFactor = Math.max(belowFactor, 4);
    }
    const viewportTop = trayViewportTop - trayViewportH * aboveFactor;
    const viewportBottom =
      trayViewportTop + trayViewportH * (1 + belowFactor);

    const ub = upperBound(pageOffsets, viewportTop);
    let startIdx = Math.max(0, ub - 1);
    if (
      startIdx < pageOffsets.length - 1 &&
      pageOffsets[startIdx] + getPageHeight(startIdx + 1) < viewportTop
    ) {
      startIdx += 1;
    }

    const pages: number[] = [];
    for (let i = startIdx; i < totalPages; i++) {
      if (pageOffsets[i] > viewportBottom) break;
      pages.push(i + 1);
    }
    return pages;
  }, [
    scrollTop,
    containerHeight,
    totalPages,
    pageOffsets,
    getPageHeight,
    scrollVelocity,
    liveScaleTrigger,
    zoomBoostActive,
  ]);

  const jumpPrefetchPages = useMemo(() => {
    if (scrollToPage === null) return new Set<number>();
    const set = new Set<number>();
    for (let p = scrollToPage - 1; p <= scrollToPage + 1; p++) {
      if (p >= 1 && p <= totalPages) set.add(p);
    }
    return set;
  }, [scrollToPage, totalPages]);

  const renderedPages = useMemo(() => {
    if (jumpPrefetchPages.size === 0) return visiblePages;
    const set = new Set(visiblePages);
    for (const p of jumpPrefetchPages) set.add(p);
    return Array.from(set).sort((a, b) => a - b);
  }, [visiblePages, jumpPrefetchPages]);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;

    // Identify our own programmatic write by matching the current scroll
    // against the most recent target. A match consumes the marker
    // (single-shot per write) so the NEXT event reads as user-initiated.
    //
    // This MUST run synchronously on the raw scroll event, NOT inside the
    // rAF below. A genuine user scroll (scrollbar drag, wheel) has to
    // cancel an in-flight resume anchor immediately — before the re-snap
    // layout effect can re-apply the old target. When this lived in the
    // rAF, the re-snap fired in the gap, wrote the scroll back to the
    // resume spot *programmatically*, and the deferred check then read
    // THAT value as "programmatic" and never cleared the resume — so
    // dragging the scrollbar snapped straight back to the open position
    // every time.
    const isProgrammatic = consumeProgrammaticScroll(el);
    lastScrollWasProgrammaticRef.current = isProgrammatic;
    if (!isProgrammatic) {
      userScrolledRef.current = true;
      resumeTargetRef.current = null;
    }

    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const st = el.scrollTop;
      setScrollTop(st);

      const now = performance.now();
      const prev = lastScrollSampleRef.current;
      if (prev) {
        const dt = now - prev.t;
        if (dt > 0) {
          const dy = st - prev.y;
          setScrollVelocity((v) => v * 0.4 + (dy / dt) * 0.6);
        }
      }
      lastScrollSampleRef.current = { y: st, t: now };
      if (velocityDecayTimerRef.current) {
        clearTimeout(velocityDecayTimerRef.current);
      }
      velocityDecayTimerRef.current = setTimeout(() => {
        setScrollVelocity(0);
        lastScrollSampleRef.current = null;
      }, 250);

      if (isProgrammatic) return;
      if (pageOffsets.length === 0) return;

      const scale = liveScaleRef.current;
      const viewportCenterTrayY = (st + containerHeight / 2) / scale;
      const ub = upperBound(pageOffsets, viewportCenterTrayY);
      const containingIdx = Math.max(0, ub - 1);
      const candidates =
        containingIdx + 1 < pageOffsets.length
          ? [containingIdx, containingIdx + 1]
          : [containingIdx];

      let closestPage = candidates[0] + 1;
      let closestDist = Infinity;
      for (const idx of candidates) {
        const pageCenter = pageOffsets[idx] + getPageHeight(idx + 1) / 2;
        const dist = Math.abs(pageCenter - viewportCenterTrayY);
        if (dist < closestDist) {
          closestDist = dist;
          closestPage = idx + 1;
        }
      }

      setCurrentPage(closestPage, docId ?? undefined);

      // Capture what's at the viewport TOP (not centre) so a later panel
      // resize can pin it back to the top. Width-independent page +
      // fraction; recomputed cheaply from the same tray-local math.
      const viewportTopTrayY = st / scale;
      const topIdx = Math.max(0, upperBound(pageOffsets, viewportTopTrayY) - 1);
      const topPageTop = pageOffsets[topIdx];
      const topPageHeight = getPageHeight(topIdx + 1);
      const topFraction =
        topPageHeight > 0 ? (viewportTopTrayY - topPageTop) / topPageHeight : 0;
      topAnchorRef.current = {
        page: topIdx + 1,
        fraction: Math.min(1, Math.max(0, topFraction)),
      };
    });
  }, [containerHeight, pageOffsets, getPageHeight, setCurrentPage, docId]);

  // Scroll-to-page (resume on doc open, TOC click, page input, search
  // hit, citation jump). Container scrollTop = pageOffsets[N] * liveScale.
  //
  // `resumeTargetRef` is set FIRST — even before pageOffsets has the
  // entry we need — so the re-snap useLayoutEffect below catches every
  // subsequent dim/totalPages update and pulls the scroll toward the
  // target as the layout fills in. Without this, a slow doc-load can
  // leave `scrollToPage=N` cleared but the actual scroll never
  // arriving (the symptom: URL says page N, view stays at page 1).
  useEffect(() => {
    if (scrollToPage === null) return;
    const el = containerRef.current;
    if (!el) return;

    const offset =
      useReaderStore.getState().documents.get(docId ?? "")?.scrollOffset ?? 0;
    // A fresh scroll-to-page (doc open, TOC / search / citation jump) is
    // the one legitimate re-arm point for the resume re-snap: re-enable
    // it even if the user had scrolled the previous view.
    userScrolledRef.current = false;
    // Fresh arming — forget the previous view's last write so the first
    // re-snap tick below doesn't mistake it for user drift.
    lastResumeWriteRef.current = null;
    resumeTargetRef.current = {
      page: scrollToPage,
      offset,
      expiresAt: Date.now() + 5000,
    };

    if (pageOffsets.length === 0) return;
    const pageTop = pageOffsets[scrollToPage - 1];
    if (pageTop === undefined) return;

    const pageHeight = getPageHeight(scrollToPage);
    const scale = liveScaleRef.current;
    const targetOffset = (pageTop + offset * pageHeight) * scale;

    writeProgrammaticScroll(el, targetOffset);
    lastResumeWriteRef.current = el.scrollTop;
    setScrollTop(targetOffset);

    clearScrollRequest(docId ?? undefined);
  }, [scrollToPage, pageOffsets, clearScrollRequest, docId, getPageHeight]);

  // Re-snap on layout settle. Fires on every dim/getPageHeight change
  // within the resume window, so as virtualized pages render and
  // their real heights replace A4 estimates the scroll stays anchored
  // to the requested page. Watchdog window above (5 s) is the
  // back-stop.
  useLayoutEffect(() => {
    const target = resumeTargetRef.current;
    if (!target) return;
    // The user took over the scroll — drop the resume anchor instead of
    // re-pinning against them. (handleScroll/handleWheel already null it,
    // but this guards the frame where a layout-settle commit runs before
    // the scroll event is processed.)
    if (userScrolledRef.current) {
      resumeTargetRef.current = null;
      return;
    }
    if (Date.now() > target.expiresAt) {
      resumeTargetRef.current = null;
      return;
    }
    const el = containerRef.current;
    if (!el || pageOffsets.length === 0) return;
    // Drift since our last write means the user grabbed the scrollbar
    // (a drag we can't otherwise detect) — stop re-pinning against them.
    const lastWrite = lastResumeWriteRef.current;
    if (lastWrite !== null && Math.abs(el.scrollTop - lastWrite) > 1) {
      userScrolledRef.current = true;
      resumeTargetRef.current = null;
      return;
    }
    const pageTop = pageOffsets[target.page - 1];
    if (pageTop === undefined) return;
    const pageHeight = getPageHeight(target.page);
    const desired = (pageTop + target.offset * pageHeight) * liveScaleRef.current;
    if (Math.abs(el.scrollTop - desired) <= 1) return;
    writeProgrammaticScroll(el, desired);
    lastResumeWriteRef.current = el.scrollTop;
    setScrollTop(desired);
  }, [pageOffsets, getPageHeight]);

  // Re-anchor when the container WIDTH changes (e.g. dragging a side-
  // panel divider). In fit-width / custom modes every page's tray-local
  // width is `baselineWidth`, so a width change resizes all pages and
  // shifts `pageOffsets` — a fixed scrollTop then lands on a different
  // page and the reader "jumps". The store-sync effect below already
  // re-anchors fit-page (whose scale depends on width), so we skip that
  // mode here.
  //
  // We pin the page-position that was at the viewport TOP back to the
  // top (offset 0 within the same page-fraction), which is what the
  // user perceives as "the page stayed put" — matching Google's PDF
  // viewer. `topAnchorRef` is page + fraction (width-independent), so
  // after the reflow we just recompute the pixel target from the fresh
  // `pageOffsets`/`getPageHeight`. Pages above the anchor are already
  // measured (the user scrolled past them), so a single write holds —
  // no settle loop needed. Falls back to the persisted currentPage top
  // (fraction 0) before the user has scrolled.
  const lastAnchorWidthRef = useRef(baselineWidth);
  useLayoutEffect(() => {
    const prevWidth = lastAnchorWidthRef.current;
    lastAnchorWidthRef.current = baselineWidth;
    if (prevWidth === baselineWidth) return; // only act on a width change
    if (zoomMode === "fit-page") return; // applyScale owns this re-anchor
    if (scrollToPage !== null || resumeTargetRef.current) return; // resume owns the scroll
    const el = containerRef.current;
    if (!el || pageOffsets.length === 0) return;

    let page: number;
    let fraction: number;
    const anchor = topAnchorRef.current;
    if (anchor) {
      page = anchor.page;
      fraction = anchor.fraction;
    } else {
      const doc = useReaderStore.getState().documents.get(docId ?? "");
      if (!doc) return;
      page = doc.currentPage;
      fraction = 0;
    }
    const pageTop = pageOffsets[page - 1];
    if (pageTop === undefined) return;
    const pageHeight = getPageHeight(page);
    const desired = (pageTop + fraction * pageHeight) * liveScaleRef.current;
    if (Math.abs(el.scrollTop - desired) <= 1) return;
    writeProgrammaticScroll(el, desired);
    setScrollTop(desired);
  }, [baselineWidth, zoomMode, scrollToPage, pageOffsets, getPageHeight, docId]);

  // Save scroll fraction to store for resume sync. Skip when the
  // scroll came from us (zoom-pivot, scroll-to-page, resume) —
  // those writes shouldn't overwrite the saved fraction with the
  // value we just re-applied. `lastScrollWasProgrammaticRef` is
  // set by `handleScroll` and consumed here single-shot so the
  // next user scroll legitimately commits.
  useEffect(() => {
    if (pageOffsets.length === 0 || containerHeight === 0) return;
    if (lastScrollWasProgrammaticRef.current) {
      lastScrollWasProgrammaticRef.current = false;
      return;
    }
    const scale = liveScaleRef.current;
    const viewportCenter = (scrollTop + containerHeight / 2) / scale;
    const idx = Math.max(0, upperBound(pageOffsets, viewportCenter) - 1);
    const pageTop = pageOffsets[idx];
    const pageHeight = getPageHeight(idx + 1);
    if (viewportCenter >= pageTop && viewportCenter <= pageTop + pageHeight) {
      const fraction = (viewportCenter - pageTop) / pageHeight;
      if (offsetReportTimerRef.current) clearTimeout(offsetReportTimerRef.current);
      offsetReportTimerRef.current = setTimeout(() => {
        setScrollOffset(fraction, docId ?? undefined);
      }, 250);
    }
  }, [scrollTop, pageOffsets, getPageHeight, containerHeight, setScrollOffset, docId]);

  // Sync the live tray scale to the store-driven zoom mode/level. The
  // store holds the user's persisted intent (fit-width, fit-page, or a
  // custom level); this useLayoutEffect computes the matching liveScale
  // and applies it imperatively. Runs on:
  //   - doc open (zoomLevel/Mode loaded from disk)
  //   - container resize (fit modes recompute)
  //   - explicit user action via toolbar (zoom in/out, fit buttons)
  //
  // `lastAppliedRef` records what we last actually drove. Without it,
  // a `getPageHeight` identity change (which fires every time a page
  // reports new dimensions) would re-run this effect mid-gesture and
  // snap liveScale back to the store's mode-derived target — the
  // "near 100% zoom snaps back to 1.0" bug, since fit-width is still
  // the persisted mode until scheduleStoreCommit fires. We re-apply
  // only when the *intent* (mode + level) actually changes, plus
  // dependent layout values for fit-page (which legitimately needs
  // re-evaluation when page-1 dims become known or container resizes).
  const lastAppliedRef = useRef<{
    mode: typeof zoomMode;
    level: number;
    baselineWidth: number;
    containerHeight: number;
    page1Width: number;
  } | null>(null);
  useLayoutEffect(() => {
    const containerEl = containerRef.current;
    const sizerEl = sizerRef.current;
    const trayEl = trayRef.current;
    if (!containerEl || !sizerEl || !trayEl) return;
    if (containerWidth === 0 || baselineWidth <= 0) return;

    // Page-1 intrinsic width (in tray-local units). At scale 1 the page
    // is laid out at `baselineWidth`, so `page1Width / baselineWidth` is
    // the scale that renders it at its actual size — the basis for the
    // "actual" and "auto" zoom modes.
    const page1Dims = dimensions.get(1);
    const page1Width =
      page1Dims && Number.isFinite(page1Dims.width) && page1Dims.width > 0
        ? page1Dims.width
        : 0;

    const last = lastAppliedRef.current;
    // For fit-width: targetScale = 1 always — depends on nothing.
    // For custom: targetScale = level/100 — depends only on zoomLevel.
    // For fit-page: depends on baselineWidth, containerHeight, page-1 dims.
    // For auto/actual: depends on baselineWidth + page-1 width.
    //
    // The bug we're squashing: when the user wheel-zooms slightly past
    // fit-width (say to scale=1.003), scheduleStoreCommit's 0.5%
    // threshold suppresses the store update, so the store still says
    // `fit-width / level=100`. A horizontal scrollbar then appears
    // (because the sizer is now wider than the viewport), shrinking
    // the container by ~17px. The ResizeObserver fires, containerHeight
    // changes, store-sync re-runs, and — if our sameIntent check was
    // gated on containerHeight — would snap liveScale from 1.003 back
    // to 1.0. So we ignore baselineWidth/containerHeight changes for
    // modes whose target scale doesn't actually depend on them.
    let sameIntent =
      last !== null && last.mode === zoomMode && last.level === zoomLevel;
    if (sameIntent && last !== null && zoomMode === "fit-page") {
      sameIntent =
        last.baselineWidth === baselineWidth &&
        last.containerHeight === containerHeight;
    }
    if (sameIntent && last !== null && (zoomMode === "auto" || zoomMode === "actual")) {
      // Recompute once page-1 dims arrive or the container width changes.
      sameIntent =
        last.baselineWidth === baselineWidth && last.page1Width === page1Width;
    }
    if (sameIntent) return;

    // Actual-size scale (page rendered at its intrinsic dimensions).
    // Falls back to fit-width (1) until page-1 dimensions are known.
    const actualScale = page1Width > 0 ? page1Width / baselineWidth : 1;

    let targetScale: number;
    if (zoomMode === "fit-width") {
      targetScale = 1;
    } else if (zoomMode === "fit-page") {
      const pageH = getPageHeight(1);
      const usableH = containerHeight - 24;
      targetScale = pageH > 0 ? usableH / pageH : 1;
    } else if (zoomMode === "actual") {
      targetScale = actualScale;
    } else if (zoomMode === "auto") {
      // Page width, but never blown up past actual size (Google
      // "Automatic Zoom"): min(fit-width=1, actual).
      targetScale = Math.min(1, actualScale);
    } else {
      targetScale = zoomLevel / 100;
    }
    targetScale = clamp(targetScale, MIN_SCALE, MAX_SCALE);

    lastAppliedRef.current = {
      mode: zoomMode,
      level: zoomLevel,
      baselineWidth,
      containerHeight,
      page1Width,
    };

    if (Math.abs(targetScale - liveScaleRef.current) < 0.005) {
      // Mode+level changed but resolved to the same scale (e.g.,
      // user pressed "fit-width" while already at scale=1). Skip the
      // DOM write but keep lastAppliedRef updated above.
      return;
    }

    // Pivot at the viewport center for toolbar-driven zooms.
    const rect = containerEl.getBoundingClientRect();
    const focalX = rect.left + rect.width / 2;
    const focalY = rect.top + rect.height / 2;
    const sizerRect = sizerEl.getBoundingClientRect();
    const oldScale = liveScaleRef.current;
    const logicalX = (focalX - sizerRect.left) / oldScale;
    const logicalY = (focalY - sizerRect.top) / oldScale;
    applyScale(targetScale, logicalX, logicalY, focalX, focalY);
  }, [
    zoomMode,
    zoomLevel,
    baselineWidth,
    containerHeight,
    containerWidth,
    applyScale,
    getPageHeight,
    dimensions,
  ]);

  const handlePageRenderSuccess = useCallback((pageNum: number) => {
    const el = containerRef.current;
    if (!el) return;
    const pageEl = el.querySelector(
      `[data-page-number="${pageNum}"]`,
    ) as HTMLElement | null;
    if (!pageEl) return;
    const rect = pageEl.getBoundingClientRect();
    // The page lives inside the scaled tray, so its bounding rect is in
    // viewport pixels (post-scale). Divide by liveScale to get the
    // tray-local intrinsic size we want to cache.
    const scale = liveScaleRef.current || 1;
    const intrinsicW = rect.width / scale;
    const intrinsicH = rect.height / scale;
    setDimensions((prev) => {
      const cached = prev.get(pageNum);
      if (
        cached &&
        Math.abs(cached.width - intrinsicW) < 0.5 &&
        Math.abs(cached.height - intrinsicH) < 0.5
      ) {
        return prev;
      }
      const next = new Map(prev);
      next.set(pageNum, { width: intrinsicW, height: intrinsicH });
      return next;
    });
  }, []);

  const handlePageRenderError = useCallback(
    (pageNum: number, error: Error) => {
      logError(`pdf:pageRenderError:page-${pageNum}:${docId ?? "?"}`, error);
    },
    [docId],
  );

  const documentOptions = useMemo(
    () => ({
      // CJK character maps for PDFs that reference them.
      cMapUrl: "/pdf-assets/cmaps/",
      cMapPacked: true,
      // Standard PDF fonts (Helvetica, Times, Courier, …). Without
      // these, PDFs that don't embed the base 14 fonts fall back
      // to a generic substitute and rendered text shifts noticeably.
      standardFontDataUrl: "/pdf-assets/standard_fonts/",
      // WebAssembly image decoders (pdf.js 5). openjpeg.wasm decodes
      // JPEG2000 / JPX images; qcms handles ICC colour. Without this
      // pointing at the served .wasm files, JPX-image PDFs throw
      // "JpxError: OpenJPEG failed to initialize" and render blank
      // white. Copied into public/pdf-assets/wasm by copy-pdf-assets.mjs.
      wasmUrl: "/pdf-assets/wasm/",
      // XFA forms — niche IRS/government forms feature. Disabling
      // skips parsing/rendering for the 99% of textbooks/novels
      // that don't use it and saves a bit of CPU on first parse.
      enableXfa: false,
      // CSP-friendly. Marginal perf cost on font subsetting paths
      // that historically used eval; modern pdf.js codepaths don't
      // require it for the bulk of rendering work.
      isEvalSupported: false,
      // Use the OS-installed Helvetica/Times/Courier when present
      // instead of downloading the bundled substitutes. Skipped
      // automatically when the requested font isn't on the system.
      useSystemFonts: true,
    }),
    [],
  );

  if (!meta) return null;

  // Initial inline styles render at scale(1) / baseline width. The
  // store-sync useLayoutEffect runs synchronously after mount (before
  // paint) and pushes the correct scale via applyScale, which mutates
  // the DOM imperatively. From then on every imperative write keeps
  // the DOM ahead of React's view; JSX style writes don't run again
  // because React reconciles to the same inline-style hash on re-render.
  return (
    // Wrapper exists so the ReadProgressStrip below can position
    // absolutely against the visible viewport. Without it, the
    // strip would have to live inside the scroll container and
    // would scroll away with the content.
    <div className="relative h-full w-full">
    <div
      ref={containerRef}
      onScroll={handleScroll}
      data-pdf-viewer
      data-active-viewer
      // pdfGutter recolours the space *around* the page (where the
      // app-chrome bg used to bleed through). The page itself is a
      // raster — can't be themed in place — but the gutter colour is
      // what carries the "sepia / dark mode" reading-room feel for
      // the eye on either side of the page edge.
      style={{
        touchAction: "pan-x pan-y",
        backgroundColor: getReaderPalette(readerTheme).pdfGutter,
        // Use the STANDARD scrollbar properties here (not the global
        // `*::-webkit-scrollbar` rule). The zoom tray's `transform: scale`
        // promotes this container to a GPU-composited scroller, and during
        // an active scroll Chrome paints its scrollbar on the compositor
        // thread — which ignores the legacy ::-webkit-scrollbar pseudo and
        // falls back to the fat OS-default bar, so the thumb visibly
        // widened to grey the moment you started scrolling. `scrollbar-width`
        // / `scrollbar-color` ARE honoured by the compositor, so the thin
        // themed bar now stays consistent at rest and mid-scroll.
        scrollbarWidth: "thin",
        scrollbarColor: "var(--color-glass-border) transparent",
        // Disable native scroll-anchoring: in a virtualized scroller
        // where pages mount/unmount and resize as you scroll, Chrome's
        // anchoring adjusts scrollTop to "keep content stable" and
        // fights both the user's drag and our own scroll math.
        overflowAnchor: "none",
      }}
      className="h-full w-full overflow-auto"
    >
      <Document
        file={meta.fileUrl}
        loading={
          <div className="flex items-center justify-center h-full gap-2 text-text-secondary">
            <Loader2 size={20} className="animate-spin" />
            <span className="text-sm">Loading PDF...</span>
          </div>
        }
        error={
          <div className="text-danger text-sm p-4 text-center">
            Failed to load PDF. The file may be corrupted.
          </div>
        }
        onLoadError={(error) =>
          logError(`pdf:documentLoadError:${docId ?? "?"}`, error)
        }
        onSourceError={(error) =>
          logError(`pdf:documentSourceError:${docId ?? "?"}`, error)
        }
        options={documentOptions}
      >
        {/* Wrapper centers the sizer when narrower than the container,
            grows when wider so the container scrolls horizontally.
            `safe center` is critical: with plain `center`, an overflowing
            sizer (zoomed in beyond viewport width) bleeds equally on
            both sides, but the browser's overflow-auto only exposes
            rightward scroll — the leftward overflow becomes
            unreachable. `safe center` falls back to `start` when the
            child overflows, keeping both edges scrollable. */}
        <div
          style={{
            display: "flex",
            justifyContent: "safe center",
            minWidth: "100%",
            minHeight: "100%",
          }}
        >
          {/* Sizer dimensions are set imperatively (in syncSizerDims
              effect + applyScale) — *not* via JSX style — so React
              re-renders during gestures don't overwrite our scaled
              width/height with the unscaled JSX values, which would
              snap the visual back to 1.0× bounds and break the next
              gesture's cursor-pivot math. */}
          <div
            ref={sizerRef}
            style={{
              flexShrink: 0,
              position: "relative",
            }}
          >
            <div
              ref={trayRef}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: baselineWidth,
                height: totalContentHeight,
                transformOrigin: "0 0",
                transform: "scale(1)",
                // PDF page tinting precedence:
                //   1. Active reader theme's `pdfPageFilter` if set
                //      (dark theme → invert + hue-rotate so light pages
                //      come out dark with roughly-correct image colour).
                //   2. The legacy per-user `pdfInvertColors` toggle when
                //      no theme filter applies — keeps the "night mode
                //      on PDFs only" power-user knob working in light
                //      / sepia themes.
                filter:
                  getReaderPalette(readerTheme).pdfPageFilter ??
                  (invertColors ? "invert(1) hue-rotate(180deg)" : undefined),
              }}
            >
              {renderedPages.map((pageNum) => (
                <PageSlot
                  key={pageNum}
                  pageNum={pageNum}
                  offsetTop={pageOffsets[pageNum - 1]}
                  pageWidth={baselineWidth}
                  pageHeight={getPageHeight(pageNum)}
                  renderWidth={renderWidth}
                  rotation={rotation}
                  onRenderSuccess={handlePageRenderSuccess}
                  onRenderError={handlePageRenderError}
                />
              ))}
            </div>
          </div>
        </div>
      </Document>
      <AnnotationContextMenu />
      <CommentPopover />
    </div>
      <ReadProgressStrip />
    </div>
  );
}
