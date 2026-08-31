import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Document, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { useReaderStore, useDocumentState } from "@/stores/reader-store";
import { useSettingsStore } from "@/stores/settings-store";
import { getReaderPalette } from "@/lib/reader-themes";
import { logError } from "@/lib/logger";
import { useTextSelection } from "@/hooks/use-text-selection";
import { ReadProgressStrip } from "../controls/ReadProgressStrip";
import { useFeature } from "@/lib/use-features";
import { AnnotationContextMenu } from "../popovers/AnnotationContextMenu";
import { CommentPopover } from "../popovers/CommentPopover";
import { AlertTriangle, Loader2 } from "lucide-react";
import { PageSlot } from "./pdf/PageSlot";
import { usePdfContainerSize } from "./pdf/usePdfContainerSize";
import { usePdfPageDims } from "./pdf/usePdfPageDims";
import { usePdfProgrammaticScroll } from "./pdf/usePdfProgrammaticScroll";
import { usePdfZoom, usePdfZoomModeSync } from "./pdf/usePdfZoom";
import { usePdfVirtualization } from "./pdf/usePdfVirtualization";
import { usePdfTouchAxisLock } from "./pdf/usePdfTouchAxisLock";
import {
  usePdfScrollAnchor,
  type ResumeTarget,
} from "./pdf/usePdfScrollAnchor";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf-assets/pdf.worker.min.mjs";

interface PdfViewerProps {
  documentId?: string;
}

// Hook order below is load-bearing: layout effects run in call order, and
// the scroll writes must land as
//   dims (page geometry) -> zoom (sizer size) -> scroll anchor -> zoom-mode
//   sync (pivot write)
// so a re-anchor never runs against a stale sizer and the store-driven
// pivot is always the last scrollTop write in a commit.
export function PdfViewer({ documentId }: PdfViewerProps) {
  const { t } = useTranslation();
  const activeDocumentId = useReaderStore((s) => s.activeDocumentId);
  const docId = documentId ?? activeDocumentId;
  const doc = useDocumentState(docId ?? "");

  const setCurrentPage = useReaderStore((s) => s.setCurrentPage);
  const readProgressEnabled = useFeature("readProgress");
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

  const containerRef = useRef<HTMLDivElement>(null);
  const sizerRef = useRef<HTMLDivElement>(null);
  const trayRef = useRef<HTMLDivElement>(null);
  useTextSelection(containerRef);

  // Refs shared between the zoom (wheel) and scroll-anchor hooks.
  // True once the user drives the scroll themselves. Disarms the resume
  // re-snap for the current view. Gated on input intent, not scroll-position
  // matching: the re-snap's own programmatic write can land last in a frame
  // and get mis-read as "ours", so resumeTargetRef would never clear. Reset
  // by the scroll-to-page effect (doc open, TOC / search / citation jump).
  const userScrolledRef = useRef(false);
  const resumeTargetRef = useRef<ResumeTarget | null>(null);

  // Container scrollTop as React sees it, drives virtualization together
  // with liveScaleTrigger. Updated from the scroll handler (rAF) and, so the
  // pair never goes out of sync mid-zoom, synchronously by applyScale.
  const [scrollTop, setScrollTop] = useState(0);

  const {
    writeProgrammaticScroll,
    consumeProgrammaticScroll,
    lastScrollWasProgrammaticRef,
  } = usePdfProgrammaticScroll();

  const { containerWidth, containerHeight, baselineWidth, renderWidth } =
    usePdfContainerSize(containerRef);

  // Source of truth for visual zoom. Lives in ref + DOM; mirrored to the
  // store only after idle so gesture frames don't churn React. Owned here
  // because both the dims hook (render measurements) and the zoom hook
  // read it.
  const liveScaleRef = useRef(1);
  const {
    resolvedDims,
    getIntrinsicDims,
    getPageHeight,
    pageOffsets,
    totalContentHeight,
    handleDocumentLoadSuccess,
    handlePageRenderSuccess,
  } = usePdfPageDims({
    docId,
    totalPages,
    rotation,
    baselineWidth,
    containerRef,
    liveScaleRef,
  });

  const { liveScaleTrigger, zoomBoostActive, applyScale } = usePdfZoom({
    containerRef,
    sizerRef,
    trayRef,
    docId,
    baselineWidth,
    totalContentHeight,
    liveScaleRef,
    setZoomLevel,
    writeProgrammaticScroll,
    setScrollTop,
    userScrolledRef,
    resumeTargetRef,
  });

  const { renderedPages, sampleScrollVelocity } = usePdfVirtualization({
    totalPages,
    pageOffsets,
    getPageHeight,
    scrollTop,
    containerHeight,
    liveScaleTrigger,
    zoomBoostActive,
    scrollToPage,
  });

  const { touchAxisLockRef, handleTouchStart, handleTouchMove, handleTouchEnd } =
    usePdfTouchAxisLock(containerRef);

  const { handleScroll, handleMouseDown } = usePdfScrollAnchor({
    containerRef,
    docId,
    zoomMode,
    scrollToPage,
    pageOffsets,
    getPageHeight,
    resolvedDims,
    baselineWidth,
    containerHeight,
    scrollTop,
    setScrollTop,
    liveScaleRef,
    writeProgrammaticScroll,
    consumeProgrammaticScroll,
    lastScrollWasProgrammaticRef,
    userScrolledRef,
    resumeTargetRef,
    touchAxisLockRef,
    sampleScrollVelocity,
    setCurrentPage,
    setScrollOffset,
    clearScrollRequest,
  });

  usePdfZoomModeSync({
    containerRef,
    sizerRef,
    trayRef,
    zoomMode,
    zoomLevel,
    baselineWidth,
    containerHeight,
    containerWidth,
    liveScaleRef,
    applyScale,
    getPageHeight,
    getIntrinsicDims,
  });

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
      // base-14 fonts; without these, non-embedding PDFs shift text
      standardFontDataUrl: "/pdf-assets/standard_fonts/",
      // pdf.js 5 wasm decoders. Missing this, JPX-image PDFs throw
      // "JpxError: OpenJPEG failed to initialize" and render blank white.
      wasmUrl: "/pdf-assets/wasm/",
      // XFA forms, skip parsing for the textbooks/novels that don't use it
      enableXfa: false,
      // CSP-friendly, no eval
      isEvalSupported: false,
      // use OS-installed fonts when present instead of the bundled ones
      useSystemFonts: true,
    }),
    [],
  );

  if (!meta) return null;

  // Initial inline styles render at scale(1) / baseline width; the
  // zoom-mode sync effect runs before paint and pushes the correct scale via
  // applyScale. From then on imperative writes keep the DOM ahead of React.
  return (
    // Wrapper so ReadProgressStrip can position against the viewport instead
    // of scrolling away inside the scroll container.
    <div className="relative h-full w-full">
    <div
      ref={containerRef}
      onScroll={handleScroll}
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      data-pdf-viewer
      data-active-viewer
      // pdfGutter recolours the space around the page. The page raster can't
      // be themed in place, so the gutter carries the sepia/dark-mode feel.
      style={{
        touchAction: "pan-x pan-y",
        backgroundColor: getReaderPalette(readerTheme).pdfGutter,
        // Standard scrollbar props (not the global ::-webkit-scrollbar rule):
        // the tray's transform:scale makes this a GPU-composited scroller,
        // and the compositor ignores the -webkit pseudo (falling back to the
        // fat OS bar mid-scroll) but does honour scrollbar-width/color.
        scrollbarWidth: "auto",
        scrollbarColor: "#8a8f9e rgba(128, 128, 128, 0.16)",
        // Disable native scroll-anchoring: in a virtualized scroller its
        // scrollTop adjustments fight both the user's drag and our math.
        overflowAnchor: "none",
      }}
      className="h-full w-full overflow-auto"
    >
      <Document
        file={meta.fileUrl}
        loading={
          <div className="flex items-center justify-center h-full gap-2 text-text-secondary">
            <Loader2 size={20} className="animate-spin" />
            <span className="text-sm">{t("reader.viewer.loading")}</span>
          </div>
        }
        error={
          <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-text-secondary">
            <AlertTriangle size={24} className="text-warning" />
            <span className="text-sm">{t("reader.viewer.pdfLoadFailed")}</span>
          </div>
        }
        onLoadSuccess={handleDocumentLoadSuccess}
        onLoadError={(error) =>
          logError(`pdf:documentLoadError:${docId ?? "?"}`, error)
        }
        onSourceError={(error) =>
          logError(`pdf:documentSourceError:${docId ?? "?"}`, error)
        }
        options={documentOptions}
      >
        {/* Centers the sizer when narrower, scrolls horizontally when wider.
            `safe center` is required: plain `center` makes an overflowing
            sizer bleed both sides but overflow-auto only exposes the right,
            leaving the left unreachable. `safe center` falls back to `start`. */}
        <div
          style={{
            display: "flex",
            justifyContent: "safe center",
            minWidth: "100%",
            minHeight: "100%",
          }}
        >
          {/* Sizer dims are set imperatively, not via JSX style, so gesture
              re-renders don't overwrite the scaled size with unscaled JSX
              values and snap the visual back to 1x. */}
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
                // Page tint precedence: theme's pdfPageFilter first (dark
                // theme inverts + hue-rotates), else the pdfInvertColors toggle.
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
      {readProgressEnabled && <ReadProgressStrip />}
    </div>
  );
}
