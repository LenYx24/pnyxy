import { useTranslation } from "react-i18next";
import { Eraser, Pencil, Trash2, Undo2, X } from "lucide-react";
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
 * 4 colours + pen/eraser toggle + undo + clear-page + clear-all +
 * exit. The eraser mode lets users tap individual strokes to remove
 * them; the trash button wipes every page so users don't have to
 * navigate through each page to clean up.
 */
export function InlineDrawToolbar() {
  const { t } = useTranslation();
  const active = useInlineDrawStore((s) => s.active);
  const color = useInlineDrawStore((s) => s.color);
  const tool = useInlineDrawStore((s) => s.tool);
  const setColor = useInlineDrawStore((s) => s.setColor);
  const setTool = useInlineDrawStore((s) => s.setTool);
  const setActive = useInlineDrawStore((s) => s.setActive);
  const undoStrokeOnPage = useInlineDrawStore((s) => s.undoStrokeOnPage);
  const clearPage = useInlineDrawStore((s) => s.clearPage);
  const clearAllPages = useInlineDrawStore((s) => s.clearAllPages);
  const drawingsByPage = useInlineDrawStore((s) => s.drawingsByPage);

  // Reader's current page — drives which page undo / clear act on.
  const currentPage = useReaderStore(
    (s) => s.activeDocumentId
      ? s.documents.get(s.activeDocumentId)?.currentPage ?? 1
      : 1,
  );

  if (!active) return null;

  const pageHasStrokes = (drawingsByPage.get(currentPage)?.length ?? 0) > 0;
  let hasAnyStrokes = false;
  for (const strokes of drawingsByPage.values()) {
    if (strokes.length > 0) {
      hasAnyStrokes = true;
      break;
    }
  }

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
        {/* Pen / eraser mode toggle. The eraser mode swaps pointer
            behaviour in InlineDrawLayer: instead of drawing, taps
            remove the stroke they land on. */}
        <button
          type="button"
          onClick={() => setTool("pen")}
          className={cn(
            "rounded-md p-1.5 transition-colors cursor-pointer",
            tool === "pen"
              ? "bg-accent-purple/20 text-accent-purple"
              : "text-text-muted hover:bg-glass-hover hover:text-text-primary",
          )}
          title={t("reader.inlineDraw.pen", { defaultValue: "Pen" })}
          aria-label={t("reader.inlineDraw.pen", { defaultValue: "Pen" })}
        >
          <Pencil size={14} />
        </button>
        <button
          type="button"
          onClick={() => setTool("eraser")}
          className={cn(
            "rounded-md p-1.5 transition-colors cursor-pointer",
            tool === "eraser"
              ? "bg-accent-purple/20 text-accent-purple"
              : "text-text-muted hover:bg-glass-hover hover:text-text-primary",
          )}
          title={t("reader.inlineDraw.eraser", {
            defaultValue: "Eraser — tap a stroke to remove it",
          })}
          aria-label={t("reader.inlineDraw.eraser", {
            defaultValue: "Eraser",
          })}
        >
          <Eraser size={14} />
        </button>

        <span className="mx-1 h-5 w-px bg-glass-border" />

        {INLINE_DRAW_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => {
              setTool("pen");
              setColor(c);
            }}
            className={cn(
              "h-6 w-6 rounded-full border-2 transition-transform cursor-pointer",
              color === c && tool === "pen"
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
          <Trash2 size={14} />
        </button>

        <button
          type="button"
          onClick={() => {
            if (
              window.confirm(
                t("reader.inlineDraw.clearAllConfirm", {
                  defaultValue:
                    "Erase every drawing on every page of this book?",
                }),
              )
            ) {
              clearAllPages();
            }
          }}
          disabled={!hasAnyStrokes}
          className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-glass-hover hover:text-red-400 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
          title={t("reader.inlineDraw.clearAll", {
            defaultValue: "Clear drawings on every page",
          })}
          aria-label={t("reader.inlineDraw.clearAll", {
            defaultValue: "Clear drawings on every page",
          })}
        >
          <span className="relative inline-flex">
            <Trash2 size={14} />
            <span className="absolute -right-1 -top-1 text-[8px] font-bold leading-none">
              *
            </span>
          </span>
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
