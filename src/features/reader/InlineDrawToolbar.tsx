import { useTranslation } from "react-i18next";
import { Eraser, Undo2, X } from "lucide-react";
import {
  INLINE_DRAW_COLORS,
  useInlineDrawStore,
} from "@/stores/inline-draw-store";
import { useReaderStore } from "@/stores/reader-store";
import { cn } from "@/lib/cn";

/**
 * Tiny floating tool palette for the inline draw mode. Pinned to the
 * bottom-center of the reader area — out of the way of the page
 * content but reachable while drawing.
 *
 * Deliberately minimal: 4 colours + undo + clear-page + exit. No
 * size picker (one fixed thickness), no eraser tool (undo handles
 * the same need with one click). Anything heavier belongs in the
 * full whiteboard mode.
 */
export function InlineDrawToolbar() {
  const { t } = useTranslation();
  const active = useInlineDrawStore((s) => s.active);
  const color = useInlineDrawStore((s) => s.color);
  const setColor = useInlineDrawStore((s) => s.setColor);
  const setActive = useInlineDrawStore((s) => s.setActive);
  const undoStrokeOnPage = useInlineDrawStore((s) => s.undoStrokeOnPage);
  const clearPage = useInlineDrawStore((s) => s.clearPage);
  const drawingsByPage = useInlineDrawStore((s) => s.drawingsByPage);

  // Reader's current page — drives which page undo / clear act on.
  const currentPage = useReaderStore(
    (s) => s.activeDocumentId
      ? s.documents.get(s.activeDocumentId)?.currentPage ?? 1
      : 1,
  );

  if (!active) return null;

  const pageHasStrokes = (drawingsByPage.get(currentPage)?.length ?? 0) > 0;

  return (
    <div
      className={cn(
        // Bottom-center so it doesn't fight the side panels (TOC,
        // AI chat) or the per-page content. Mobile: floats above
        // the reader's own bottom bar (which sits at bottom-0 of
        // the reader container).
        "pointer-events-none absolute left-1/2 z-30 -translate-x-1/2",
        "bottom-[calc(4rem+env(safe-area-inset-bottom,0px))] md:bottom-6",
      )}
    >
      <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-glass-border bg-bg-secondary/95 px-2 py-1.5 shadow-xl backdrop-blur-xl">
        {INLINE_DRAW_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setColor(c)}
            className={cn(
              "h-6 w-6 rounded-full border-2 transition-transform cursor-pointer",
              color === c
                ? "border-text-primary scale-110"
                : "border-transparent hover:scale-105",
            )}
            style={{ backgroundColor: c }}
            title={t("reader.inlineDraw.color", { defaultValue: "Pen colour" })}
            aria-label={t("reader.inlineDraw.color", {
              defaultValue: "Pen colour",
            })}
          />
        ))}

        <span className="mx-1 h-5 w-px bg-glass-border" />

        <button
          type="button"
          onClick={() => undoStrokeOnPage(currentPage)}
          disabled={!pageHasStrokes}
          className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
          title={t("reader.inlineDraw.undo", { defaultValue: "Undo last stroke" })}
          aria-label={t("reader.inlineDraw.undo", {
            defaultValue: "Undo last stroke",
          })}
        >
          <Undo2 size={14} />
        </button>

        <button
          type="button"
          onClick={() => clearPage(currentPage)}
          disabled={!pageHasStrokes}
          className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-glass-hover hover:text-red-400 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
          title={t("reader.inlineDraw.clearPage", {
            defaultValue: "Clear all strokes on this page",
          })}
          aria-label={t("reader.inlineDraw.clearPage", {
            defaultValue: "Clear all strokes on this page",
          })}
        >
          <Eraser size={14} />
        </button>

        <span className="mx-1 h-5 w-px bg-glass-border" />

        <button
          type="button"
          onClick={() => setActive(false)}
          className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
          title={t("reader.inlineDraw.exit", { defaultValue: "Exit draw mode" })}
          aria-label={t("reader.inlineDraw.exit", {
            defaultValue: "Exit draw mode",
          })}
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
