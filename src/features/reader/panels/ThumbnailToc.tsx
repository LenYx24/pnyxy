import { useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import {
  Loader2,
  Check,
  CheckSquare,
  Square,
  Crosshair,
  Image as ImageIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import { useReaderStore, useActiveDocument } from "@/stores/reader-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useUIStore } from "@/stores/ui-store";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf-assets/pdf.worker.min.mjs";

const THUMB_WIDTH = 150;
// A4 ratio placeholder; adjusts once the real page renders
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
  const setAiSendPagesAsImage = useReaderStore(
    (s) => s.setAiSendPagesAsImage,
  );
  const surroundingCount = useSettingsStore(
    (s) => s.aiSurroundingPagesCount,
  );

  const meta = activeDoc?.meta ?? null;
  const totalPages = activeDoc?.totalPages ?? 0;
  const currentPage = activeDoc?.currentPage ?? 1;
  const selectedPages = activeDoc?.aiSelectedPages ?? EMPTY_SET;
  const selectionAnchor = activeDoc?.aiSelectionAnchor ?? null;
  const sendAsImage = activeDoc?.aiSendPagesAsImage ?? false;

  // In the UI store so the AI chat panel can flip it on. Session-scoped, not persisted.
  const selectionMode = useUIStore((s) => s.aiContextSelectionMode);
  const setSelectionMode = useUIStore((s) => s.setAiContextSelectionMode);

  // On first entry to selection mode, pre-fill with the surrounding-page window if
  // nothing is selected. Ref guards against re-filling a selection the user cleared.
  const autoSelectedRef = useRef(false);
  useEffect(() => {
    if (!selectionMode) {
      autoSelectedRef.current = false;
      return;
    }
    if (autoSelectedRef.current) return;
    if ((activeDoc?.aiSelectedPages.size ?? 0) > 0) {
      autoSelectedRef.current = true;
      return;
    }
    if (!activeDoc || totalPages <= 0) return;
    selectAiPagesAround();
    autoSelectedRef.current = true;
  }, [selectionMode, activeDoc, totalPages, selectAiPagesAround]);

  const documentOptions = useMemo(
    () => ({ cMapUrl: "/pdf-assets/cmaps/", cMapPacked: true }),
    [],
  );

  if (!meta) return null;

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
          <Loader2 size={24} className="animate-spin text-accent" />
        </div>
      }
      error={null}
    >
      {/* z-20 so the thumbnail checkboxes (z-10) scroll beneath this sticky bar */}
      <div className="sticky top-0 z-20 flex flex-col gap-1 border-b border-glass-border bg-bg-secondary/95  px-2 py-2">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setSelectionMode(!selectionMode)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors cursor-pointer",
              selectionMode
                ? "bg-accent/20 text-accent"
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
            <span className="text-2xs text-text-muted">
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
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-2xs text-text-muted hover:bg-glass-hover hover:text-text-primary cursor-pointer"
            >
              <CheckSquare size={12} />
              {t("reader.sidebar.aiSelectAll")}
            </button>
            <button
              type="button"
              onClick={() => clearAiPages()}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-2xs text-text-muted hover:bg-glass-hover hover:text-text-primary cursor-pointer"
            >
              <Square size={12} />
              {t("reader.sidebar.aiClearSelection")}
            </button>
            <button
              type="button"
              onClick={() => selectAiPagesAround()}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-2xs text-text-muted hover:bg-glass-hover hover:text-text-primary cursor-pointer"
            >
              <Crosshair size={12} />
              {t("reader.sidebar.aiSelectAround", { n: surroundingCount })}
            </button>
            {/* When on, selected pages go as JPEG attachments instead of extracted text.
                Also the fallback for scanned PDFs. */}
            <button
              type="button"
              onClick={() => setAiSendPagesAsImage(!sendAsImage)}
              aria-pressed={sendAsImage}
              className={cn(
                "flex items-center gap-1 rounded px-1.5 py-0.5 text-2xs cursor-pointer transition-colors",
                sendAsImage
                  ? "bg-accent/20 text-accent"
                  : "text-text-muted hover:bg-glass-hover hover:text-text-primary",
              )}
              title={t("reader.sidebar.aiSendAsImageHint", {
                defaultValue:
                  "Render the selected pages as images so the AI sees figures and diagrams. Costs more tokens per page.",
              })}
            >
              <ImageIcon size={12} />
              {t("reader.sidebar.aiSendAsImage", {
                defaultValue: "Send as images",
              })}
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
 * Lazy-mounted thumbnail: renders a placeholder until the row nears the viewport,
 * then mounts <Page> and keeps it mounted. Avoids rendering every page of a large
 * PDF at once, which locks up the worker.
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
  // Once mounted, stay mounted; re-rendering the canvas is wasteful.
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (mounted) return;
    const el = ref.current;
    if (!el) return;
    // 400px overscan so thumbnails render before scrolling into view
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
        // selection ring takes priority over the active-page ring
        isSelected
          ? "ring-2 ring-success bg-success/10"
          : isActive
            ? "ring-2 ring-accent bg-accent/10"
            : "hover:bg-glass-hover",
      )}
    >
      {selectionMode && (
        <div
          className={cn(
            "absolute right-2 top-2 z-10 flex h-5 w-5 items-center justify-center rounded border",
            isSelected
              ? "border-success bg-success text-bg-primary"
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
          isActive ? "text-accent font-medium" : "text-text-muted",
        )}
      >
        {pageNum}
      </span>
    </button>
  );
}
