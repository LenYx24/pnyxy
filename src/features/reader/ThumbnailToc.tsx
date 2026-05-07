import { useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { Loader2, Check, CheckSquare, Square, Crosshair } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import { useReaderStore, useActiveDocument } from "@/stores/reader-store";
import { useSettingsStore } from "@/stores/settings-store";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf-assets/pdf.worker.min.mjs";

const THUMB_WIDTH = 150;
// A4 ratio as the placeholder height — most book PDFs are close
// enough that the scroll geometry stays stable when the real page
// renders. Wrong-aspect pages will adjust on render; the surrounding
// layout doesn't depend on per-thumb height being exact.
const THUMB_PLACEHOLDER_HEIGHT = THUMB_WIDTH * 1.4142;

export function ThumbnailToc() {
  const { t } = useTranslation();
  const activeDoc = useActiveDocument();
  const goToPage = useReaderStore((s) => s.goToPage);
  const toggleAiPage = useReaderStore((s) => s.toggleAiPage);
  const selectAiPageRange = useReaderStore((s) => s.selectAiPageRange);
  const selectAllAiPages = useReaderStore((s) => s.selectAllAiPages);
  const clearAiPages = useReaderStore((s) => s.clearAiPages);
  const selectAiPagesAround = useReaderStore((s) => s.selectAiPagesAround);
  const surroundingCount = useSettingsStore(
    (s) => s.aiSurroundingPagesCount,
  );

  const meta = activeDoc?.meta ?? null;
  const totalPages = activeDoc?.totalPages ?? 0;
  const currentPage = activeDoc?.currentPage ?? 1;
  const selectedPages = activeDoc?.aiSelectedPages ?? EMPTY_SET;
  const selectionAnchor = activeDoc?.aiSelectionAnchor ?? null;

  // Selection mode is local to this view — no need to persist across
  // mounts. Coming back into the TOC always lands you in the
  // navigation-only mode unless the user opts in again.
  const [selectionMode, setSelectionMode] = useState(false);

  const documentOptions = useMemo(
    () => ({ cMapUrl: "/pdf-assets/cmaps/", cMapPacked: true }),
    [],
  );

  if (!meta) return null;

  // PDF-only: TOC selection only makes sense when there are pages we
  // can later extract text from. Other formats fall back to the
  // navigation-only behavior — but the existing ThumbnailToc only
  // renders for PDFs anyway via the meta-format check upstream.

  const handleThumbClick = (pageNum: number, e: React.MouseEvent) => {
    if (!selectionMode) {
      goToPage(pageNum);
      return;
    }
    if (e.shiftKey && selectionAnchor !== null) {
      selectAiPageRange(selectionAnchor, pageNum);
    } else {
      toggleAiPage(pageNum);
    }
  };

  const selectedCount = selectedPages.size;

  return (
    <Document
      file={meta.fileUrl}
      options={documentOptions}
      loading={
        <div className="flex items-center justify-center py-16">
          <Loader2 size={24} className="animate-spin text-accent-purple" />
        </div>
      }
      error={null}
    >
      <div className="sticky top-0 z-10 flex flex-col gap-1 border-b border-glass-border bg-bg-secondary/95 backdrop-blur-md px-2 py-2">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setSelectionMode((v) => !v)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors cursor-pointer",
              selectionMode
                ? "bg-accent-purple/20 text-accent-purple"
                : "text-text-muted hover:bg-glass-hover hover:text-text-primary",
            )}
            aria-pressed={selectionMode}
            title={
              selectionMode
                ? t("reader.sidebar.aiSelectModeOff")
                : t("reader.sidebar.aiSelectMode")
            }
          >
            <CheckSquare size={14} />
            {selectionMode
              ? t("reader.sidebar.aiSelectModeOff")
              : t("reader.sidebar.aiSelectMode")}
          </button>
          {selectionMode && (
            <span className="text-[10px] text-text-muted">
              {selectedCount > 0
                ? t("reader.sidebar.aiSelectedCount", { count: selectedCount })
                : t("reader.sidebar.aiSelectionEmpty")}
            </span>
          )}
        </div>
        {selectionMode && (
          <div className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              onClick={() => selectAllAiPages()}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-text-muted hover:bg-glass-hover hover:text-text-primary cursor-pointer"
            >
              <CheckSquare size={12} />
              {t("reader.sidebar.aiSelectAll")}
            </button>
            <button
              type="button"
              onClick={() => clearAiPages()}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-text-muted hover:bg-glass-hover hover:text-text-primary cursor-pointer"
            >
              <Square size={12} />
              {t("reader.sidebar.aiClearSelection")}
            </button>
            <button
              type="button"
              onClick={() => selectAiPagesAround()}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-text-muted hover:bg-glass-hover hover:text-text-primary cursor-pointer"
            >
              <Crosshair size={12} />
              {t("reader.sidebar.aiSelectAround", { n: surroundingCount })}
            </button>
          </div>
        )}
      </div>
      <div className="flex flex-col items-center gap-3 p-3">
        {Array.from({ length: totalPages }, (_, i) => {
          const pageNum = i + 1;
          return (
            <ThumbnailItem
              key={pageNum}
              pageNum={pageNum}
              isActive={currentPage === pageNum}
              isSelected={selectedPages.has(pageNum)}
              selectionMode={selectionMode}
              onClick={(e) => handleThumbClick(pageNum, e)}
            />
          );
        })}
      </div>
    </Document>
  );
}

const EMPTY_SET: ReadonlySet<number> = new Set();

/**
 * Lazy-mounted thumbnail. Renders a placeholder skeleton until the
 * row scrolls into (or near) the viewport, then mounts the real
 * `<Page>` and keeps it mounted for the rest of the session — so
 * scrolling back up or quickly jumping around the TOC doesn't pay
 * the render cost again.
 *
 * Without this, opening the TOC on a 500-page PDF used to fire 500
 * concurrent thumbnail renders the moment the panel mounted; on
 * mid-tier hardware that froze the worker for several seconds. Now
 * only ~10 thumbnails (rootMargin overscan + visible) render up
 * front; the rest fill in as the user scrolls.
 */
function ThumbnailItem({
  pageNum,
  isActive,
  isSelected,
  selectionMode,
  onClick,
}: {
  pageNum: number;
  isActive: boolean;
  isSelected: boolean;
  selectionMode: boolean;
  onClick: (e: React.MouseEvent) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  // Once mounted, stay mounted. Re-rendering an already-rendered
  // canvas is wasteful, and a TOC has finite vertical extent so
  // memory growth is bounded by total pages × ~30 KB / canvas.
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (mounted) return;
    const el = ref.current;
    if (!el) return;
    // 400px above/below the panel's viewport — gives the worker a
    // head start so thumbnails appear "ready" by the time the user
    // scrolls them into actual view, instead of flashing in.
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setMounted(true);
          observer.disconnect();
        }
      },
      { rootMargin: "400px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [mounted]);

  return (
    <button
      ref={ref}
      onClick={onClick}
      className={cn(
        "relative flex flex-col items-center gap-1 rounded-lg p-1.5 transition-colors cursor-pointer",
        // Selection ring beats the active ring visually because the
        // user has explicit intent ("I'm choosing what to send"); the
        // page-they're-on highlight stays as a subtler purple.
        isSelected
          ? "ring-2 ring-emerald-400 bg-emerald-400/10"
          : isActive
            ? "ring-2 ring-accent-purple bg-accent-purple/10"
            : "hover:bg-glass-hover",
      )}
    >
      {selectionMode && (
        <div
          className={cn(
            "absolute right-2 top-2 z-10 flex h-5 w-5 items-center justify-center rounded border",
            isSelected
              ? "border-emerald-400 bg-emerald-400 text-bg-primary"
              : "border-glass-border bg-bg-primary/80 text-transparent",
          )}
          aria-hidden="true"
        >
          <Check size={12} strokeWidth={3} />
        </div>
      )}
      {mounted ? (
        <Page
          pageNumber={pageNum}
          width={THUMB_WIDTH}
          renderTextLayer={false}
          renderAnnotationLayer={false}
          loading={
            <div
              className="bg-glass-bg rounded animate-pulse"
              style={{ width: THUMB_WIDTH, height: THUMB_PLACEHOLDER_HEIGHT }}
            />
          }
        />
      ) : (
        <div
          className="bg-glass-bg/50 rounded"
          style={{ width: THUMB_WIDTH, height: THUMB_PLACEHOLDER_HEIGHT }}
        />
      )}
      <span
        className={cn(
          "text-xs",
          isActive ? "text-accent-purple font-medium" : "text-text-muted",
        )}
      >
        {pageNum}
      </span>
    </button>
  );
}
