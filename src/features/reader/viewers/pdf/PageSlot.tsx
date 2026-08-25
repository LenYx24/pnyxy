import { memo } from "react";
import { Page } from "react-pdf";
import { HighlightLayer } from "../../layers/HighlightLayer";
import { AiCitationLayer } from "../../layers/AiCitationLayer";
import { CitationQuoteHighlightLayer } from "../../layers/CitationQuoteHighlightLayer";
import { SearchHighlightLayer } from "../../layers/SearchHighlightLayer";
import { CommentMarkers } from "../../layers/CommentMarkers";
import { InlineDrawLayer } from "../../layers/InlineDrawLayer";

export interface PageSlotProps {
  pageNum: number;
  offsetTop: number;
  pageWidth: number;
  pageHeight: number;
  /** Rasterize width. Grow-only, so resize just CSS-scales the slot. */
  renderWidth: number;
  rotation: 0 | 90 | 180 | 270;
  onRenderSuccess: (pageNum: number) => void;
  onRenderError: (pageNum: number, error: Error) => void;
}

// One virtualized page + overlay layers. Rasterized at renderWidth, inner
// div CSS-scales to pageWidth so a resize doesn't re-rasterize.
export const PageSlot = memo(function PageSlot({
  pageNum,
  offsetTop,
  pageWidth,
  pageHeight,
  renderWidth,
  rotation,
  onRenderSuccess,
  onRenderError,
}: PageSlotProps) {
  // Fall back to display width on the first frame before renderWidth is set.
  const effectiveRenderW = renderWidth > 0 ? renderWidth : pageWidth;
  const slotScale =
    effectiveRenderW > 0 ? pageWidth / effectiveRenderW : 1;
  const useSlotTransform = Math.abs(slotScale - 1) > 0.001;

  // guard against NaN offsetTop reaching the DOM
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
      {/* Outer holds layout space; inner is the renderWidth canvas scaled down. */}
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
            renderTextLayer={true}
            renderAnnotationLayer={true}
            loading={
              <div style={{ height: pageHeight, width: effectiveRenderW }} />
            }
            // react-pdf Page has no default error UI, would render blank white
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
