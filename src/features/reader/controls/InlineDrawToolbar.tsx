import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowUpRight,
  Circle,
  Eraser,
  Minus,
  MousePointer2,
  Pencil,
  Square,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import {
  INLINE_DRAW_COLORS,
  INLINE_DRAW_WIDTHS,
  useInlineDrawStore,
  type InlineDrawTool,
} from "@/stores/inline-draw-store";
import { useReaderStore } from "@/stores/reader-store";
import { cn } from "@/lib/cn";

/**
 * Floating tool palette for inline draw mode, pinned bottom-center.
 * Tools: select (move/resize placed items), pen, rectangle, ellipse,
 * line, arrow, eraser, plus a stroke-width picker, colour palette,
 * delete-selected, undo, clear-page, clear-all and exit.
 */
const TOOLS: {
  tool: InlineDrawTool;
  Icon: typeof Pencil;
  key: string;
  fallback: string;
}[] = [
  { tool: "select", Icon: MousePointer2, key: "select", fallback: "Select / move" },
  { tool: "pen", Icon: Pencil, key: "pen", fallback: "Pen" },
  { tool: "rectangle", Icon: Square, key: "rectangle", fallback: "Rectangle" },
  { tool: "ellipse", Icon: Circle, key: "ellipse", fallback: "Ellipse" },
  { tool: "line", Icon: Minus, key: "line", fallback: "Line" },
  { tool: "arrow", Icon: ArrowUpRight, key: "arrow", fallback: "Arrow" },
  { tool: "eraser", Icon: Eraser, key: "eraser", fallback: "Eraser" },
];

export function InlineDrawToolbar() {
  const { t } = useTranslation();
  const active = useInlineDrawStore((s) => s.active);
  const color = useInlineDrawStore((s) => s.color);
  const width = useInlineDrawStore((s) => s.width);
  const tool = useInlineDrawStore((s) => s.tool);
  const selectedId = useInlineDrawStore((s) => s.selectedId);
  const setColor = useInlineDrawStore((s) => s.setColor);
  const setWidth = useInlineDrawStore((s) => s.setWidth);
  const setTool = useInlineDrawStore((s) => s.setTool);
  const setActive = useInlineDrawStore((s) => s.setActive);
  const removeSelected = useInlineDrawStore((s) => s.removeSelected);
  const undoOnPage = useInlineDrawStore((s) => s.undoOnPage);
  const clearPage = useInlineDrawStore((s) => s.clearPage);
  const clearAllPages = useInlineDrawStore((s) => s.clearAllPages);
  const drawingsByPage = useInlineDrawStore((s) => s.drawingsByPage);

  const currentPage = useReaderStore((s) =>
    s.activeDocumentId
      ? s.documents.get(s.activeDocumentId)?.currentPage ?? 1
      : 1,
  );

  // Delete / Backspace removes the selected element (unless the user is
  // typing in a field).
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const el = document.activeElement;
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el as HTMLElement | null)?.isContentEditable
      ) {
        return;
      }
      if (useInlineDrawStore.getState().selectedId) {
        e.preventDefault();
        removeSelected();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, removeSelected]);

  if (!active) return null;

  const pageHasContent = (drawingsByPage.get(currentPage)?.length ?? 0) > 0;
  let hasAnyContent = false;
  for (const els of drawingsByPage.values()) {
    if (els.length > 0) {
      hasAnyContent = true;
      break;
    }
  }

  return (
    <div
      className={cn(
        "pointer-events-none absolute left-1/2 z-30 -translate-x-1/2",
        "bottom-[calc(4rem+env(safe-area-inset-bottom,0px))] md:bottom-6",
      )}
    >
      <div className="pointer-events-auto flex max-w-[95vw] flex-wrap items-center justify-center gap-1 rounded-2xl border border-glass-border bg-bg-secondary/95 px-2 py-1.5 shadow-xl backdrop-blur-xl">
        {/* Tools */}
        {TOOLS.map(({ tool: tl, Icon, key, fallback }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTool(tl)}
            className={cn(
              "rounded-md p-1.5 transition-colors cursor-pointer",
              tool === tl
                ? "bg-accent/20 text-accent"
                : "text-text-muted hover:bg-glass-hover hover:text-text-primary",
            )}
            title={t(`reader.inlineDraw.${key}`, { defaultValue: fallback })}
            aria-label={t(`reader.inlineDraw.${key}`, { defaultValue: fallback })}
          >
            <Icon size={14} />
          </button>
        ))}

        <span className="mx-1 h-5 w-px bg-glass-border" />

        {/* Stroke width */}
        {INLINE_DRAW_WIDTHS.map((w) => (
          <button
            key={w}
            type="button"
            onClick={() => setWidth(w)}
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded-md transition-colors cursor-pointer",
              width === w
                ? "bg-accent/20"
                : "hover:bg-glass-hover",
            )}
            title={t("reader.inlineDraw.width", { defaultValue: "Stroke width" })}
            aria-label={t("reader.inlineDraw.width", { defaultValue: "Stroke width" })}
          >
            <span
              className="rounded-full bg-text-primary"
              style={{
                width: Math.max(3, w + 1),
                height: Math.max(3, w + 1),
                opacity: width === w ? 1 : 0.6,
              }}
            />
          </button>
        ))}

        <span className="mx-1 h-5 w-px bg-glass-border" />

        {/* Colours */}
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
            title={t("reader.inlineDraw.color", { defaultValue: "Colour" })}
            aria-label={t("reader.inlineDraw.color", { defaultValue: "Colour" })}
          />
        ))}

        <span className="mx-1 h-5 w-px bg-glass-border" />

        {/* Delete selected */}
        <button
          type="button"
          onClick={() => removeSelected()}
          disabled={!selectedId}
          className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-glass-hover hover:text-danger cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
          title={t("reader.inlineDraw.deleteSelected", { defaultValue: "Delete selected" })}
          aria-label={t("reader.inlineDraw.deleteSelected", { defaultValue: "Delete selected" })}
        >
          <Trash2 size={14} />
        </button>

        {/* Undo */}
        <button
          type="button"
          onClick={() => undoOnPage(currentPage)}
          disabled={!pageHasContent}
          className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
          title={t("reader.inlineDraw.undo", { defaultValue: "Undo last" })}
          aria-label={t("reader.inlineDraw.undo", { defaultValue: "Undo last" })}
        >
          <Undo2 size={14} />
        </button>

        {/* Clear page */}
        <button
          type="button"
          onClick={() => clearPage(currentPage)}
          disabled={!pageHasContent}
          className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-glass-hover hover:text-danger cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
          title={t("reader.inlineDraw.clearPage", { defaultValue: "Clear this page" })}
          aria-label={t("reader.inlineDraw.clearPage", { defaultValue: "Clear this page" })}
        >
          <Trash2 size={14} />
          <span className="sr-only">page</span>
        </button>

        {/* Clear all */}
        <button
          type="button"
          onClick={() => {
            if (
              window.confirm(
                t("reader.inlineDraw.clearAllConfirm", {
                  defaultValue: "Erase every drawing on every page of this book?",
                }),
              )
            ) {
              clearAllPages();
            }
          }}
          disabled={!hasAnyContent}
          className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-glass-hover hover:text-danger cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
          title={t("reader.inlineDraw.clearAll", { defaultValue: "Clear every page" })}
          aria-label={t("reader.inlineDraw.clearAll", { defaultValue: "Clear every page" })}
        >
          <span className="relative inline-flex">
            <Trash2 size={14} />
            <span className="absolute -right-1 -top-1 text-[8px] font-bold leading-none">
              *
            </span>
          </span>
        </button>

        <span className="mx-1 h-5 w-px bg-glass-border" />

        {/* Exit */}
        <button
          type="button"
          onClick={() => setActive(false)}
          className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
          title={t("reader.inlineDraw.exit", { defaultValue: "Exit draw mode" })}
          aria-label={t("reader.inlineDraw.exit", { defaultValue: "Exit draw mode" })}
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
