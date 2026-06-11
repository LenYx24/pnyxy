import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { X, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import { useReaderStore, useActiveDocument } from "@/stores/reader-store";
import { useConfirm } from "@/hooks/use-confirm";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf-assets/pdf.worker.min.mjs";

const THUMB_WIDTH = 90;
// A4 ratio placeholder so the strip's geometry is stable while
// thumbnails stream in.
const THUMB_PLACEHOLDER_HEIGHT = THUMB_WIDTH * 1.4142;

/**
 * Inline AI page picker that sits above the ChatComposer. A horizontal
 * scrolling strip of page thumbnails; clicking a tile toggles whether
 * that page gets included in the next message's context. Mirrors the
 * sidebar `ThumbnailToc`'s selection state — both surfaces edit the
 * same `aiSelectedPages` set on the active doc, so changes here show
 * up in the sidebar editor and vice versa.
 *
 * Lives in the chat panel because that's where the user actually
 * sees the "x pages" count and wants to adjust it — saves a round
 * trip to the sidebar TOC. PDF-only (react-pdf renders the tiles);
 * for non-PDF formats the chat panel falls back to the sidebar
 * editor route.
 */
export function InlineAiPagePicker({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const activeDoc = useActiveDocument();
  const toggleAiPage = useReaderStore((s) => s.toggleAiPage);
  const clearAiPages = useReaderStore((s) => s.clearAiPages);
  const selectAiPagesAround = useReaderStore((s) => s.selectAiPagesAround);
  const selectAiPageRange = useReaderStore((s) => s.selectAiPageRange);
  const selectAllAiPages = useReaderStore((s) => s.selectAllAiPages);
  const { confirm, ConfirmModalElement } = useConfirm();

  const meta = activeDoc?.meta ?? null;
  const totalPages = activeDoc?.totalPages ?? 0;
  const currentPage = activeDoc?.currentPage ?? 1;
  const selectedPages = activeDoc?.aiSelectedPages ?? EMPTY_SET;
  const selectionAnchor = activeDoc?.aiSelectionAnchor ?? null;
  const selectedCount = selectedPages.size;
  const allSelected = totalPages > 0 && selectedCount === totalPages;

  // Click handler with shift-range support. Plain click toggles a
  // single page; shift+click extends from the most recent selection
  // anchor to the clicked page (matches the sidebar ThumbnailToc).
  // Anchor-less shift-click falls back to a single toggle — same
  // sane default as the sidebar picker.
  const handleTileClick = useCallback(
    (pageNum: number, shift: boolean) => {
      if (shift && selectionAnchor !== null) {
        selectAiPageRange(selectionAnchor, pageNum);
      } else {
        toggleAiPage(pageNum);
      }
    },
    [selectionAnchor, selectAiPageRange, toggleAiPage],
  );

  // Select-all gate. Reuses the wholeBook confirm copy from
  // ChatComposer (same warning about token cost on big books) so
  // users get a consistent dialog whichever entry point they use.
  const handleSelectAll = useCallback(async () => {
    if (!activeDoc || totalPages <= 0) return;
    const ok = await confirm({
      title: t("chat.composer.wholeBook.confirmTitle", {
        defaultValue: "Send the whole book?",
      }),
      body: t("chat.composer.wholeBook.confirmBody", {
        defaultValue:
          "All {{count}} pages of this document will be attached to the next message. Large books eat through your daily AI quota fast — review the selection in the TOC if unsure.",
        count: totalPages,
      }),
      confirmLabel: t("chat.composer.wholeBook.confirmLabel", {
        defaultValue: "Select all pages",
      }),
    });
    if (!ok) return;
    selectAllAiPages();
  }, [activeDoc, totalPages, confirm, selectAllAiPages, t]);

  // First-open auto-fill: if nothing is selected, seed with the
  // user's "surrounding pages" default — same UX as the sidebar
  // ThumbnailToc on entering selection mode. Without this, opening
  // the picker on a fresh book shows zero selected and the user has
  // to start from scratch every time.
  const autoSelectedRef = useRef(false);
  useEffect(() => {
    if (autoSelectedRef.current) return;
    if (selectedCount > 0) {
      autoSelectedRef.current = true;
      return;
    }
    if (!activeDoc || totalPages <= 0) return;
    selectAiPagesAround();
    autoSelectedRef.current = true;
  }, [activeDoc, totalPages, selectedCount, selectAiPagesAround]);

  // Scroll the current page roughly into view on first open so the
  // user lands near where they actually are in the book, not at
  // page 1 of a 600-page PDF.
  const scrollRef = useRef<HTMLDivElement>(null);
  const tileRefs = useRef<Map<number, HTMLButtonElement>>(new Map());
  const scrolledRef = useRef(false);
  useEffect(() => {
    if (scrolledRef.current) return;
    if (!scrollRef.current || totalPages <= 0) return;
    const el = tileRefs.current.get(currentPage);
    if (!el) return;
    el.scrollIntoView({
      behavior: "auto",
      inline: "center",
      block: "nearest",
    });
    scrolledRef.current = true;
  }, [currentPage, totalPages]);

  const documentOptions = useMemo(
    () => ({ cMapUrl: "/pdf-assets/cmaps/", cMapPacked: true }),
    [],
  );

  if (!meta) return null;

  return (
    <div className="border-t border-glass-border bg-bg-secondary/95 backdrop-blur-md">
      <div className="flex items-center justify-between gap-2 px-3 py-1.5">
        <span className="truncate text-2xs text-text-muted">
          {selectedCount > 0
            ? t("reader.aiChat.pickPagesSelected", { count: selectedCount })
            : t("reader.aiChat.pickPagesEmpty")}
        </span>
        <div className="flex items-center gap-0.5">
          {selectedCount > 0 && (
            <button
              type="button"
              onClick={() => clearAiPages()}
              className="rounded px-1.5 py-0.5 text-2xs text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
            >
              {t("common.clear", { defaultValue: "Clear" })}
            </button>
          )}
          <button
            type="button"
            onClick={() => void handleSelectAll()}
            disabled={allSelected}
            className="rounded px-1.5 py-0.5 text-2xs text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-text-muted"
            title={t("reader.sidebar.aiSelectAll", {
              defaultValue: "Select all pages",
            })}
          >
            {t("reader.sidebar.aiSelectAll", {
              defaultValue: "Select all",
            })}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
            aria-label={t("common.close", { defaultValue: "Close" })}
            title={t("common.close", { defaultValue: "Close" })}
          >
            <X size={12} />
          </button>
        </div>
      </div>
      <Document
        file={meta.fileUrl}
        options={documentOptions}
        loading={
          <div
            className="px-3 pb-3"
            style={{ height: THUMB_PLACEHOLDER_HEIGHT + 22 }}
          />
        }
        error={null}
      >
        {/* pt-2 leaves breathing room for the emerald selection ring on
            the first row of tiles — without it the ring's top edge was
            clipped against the header divider. */}
        <div
          ref={scrollRef}
          className="flex gap-2 overflow-x-auto overscroll-contain px-3 pb-3 pt-2"
        >
          {Array.from({ length: totalPages }, (_, i) => {
            const pageNum = i + 1;
            return (
              <PickerTile
                key={pageNum}
                pageNum={pageNum}
                isActive={currentPage === pageNum}
                isSelected={selectedPages.has(pageNum)}
                scrollContainerRef={scrollRef}
                registerRef={(el) => {
                  if (el) tileRefs.current.set(pageNum, el);
                  else tileRefs.current.delete(pageNum);
                }}
                onClick={(e) => handleTileClick(pageNum, e.shiftKey)}
              />
            );
          })}
        </div>
      </Document>
      {ConfirmModalElement}
    </div>
  );
}

const EMPTY_SET: ReadonlySet<number> = new Set();

/**
 * Lazy-mounted thumbnail tile. Same pattern as the sidebar
 * ThumbnailItem: stay placeholder until scrolled near, then mount the
 * react-pdf <Page> and keep it. The IntersectionObserver uses the
 * scroll container as its root so off-screen-to-the-right tiles
 * don't fire all at once on mount.
 */
function PickerTile({
  pageNum,
  isActive,
  isSelected,
  scrollContainerRef,
  registerRef,
  onClick,
}: {
  pageNum: number;
  isActive: boolean;
  isSelected: boolean;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  registerRef: (el: HTMLButtonElement | null) => void;
  onClick: (e: React.MouseEvent) => void;
}) {
  const localRef = useRef<HTMLButtonElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (mounted) return;
    const el = localRef.current;
    if (!el) return;
    const root = scrollContainerRef.current ?? null;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setMounted(true);
          observer.disconnect();
        }
      },
      // Overscan to the right so tiles look ready as the user scrolls.
      { root, rootMargin: "0px 400px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [mounted, scrollContainerRef]);

  return (
    <button
      ref={(el) => {
        localRef.current = el;
        registerRef(el);
      }}
      onClick={onClick}
      className={cn(
        "relative flex shrink-0 flex-col items-center gap-1 rounded-md p-1 transition-colors cursor-pointer",
        isSelected
          ? "ring-2 ring-success bg-success/10"
          : isActive
            ? "ring-1 ring-accent/60 bg-accent/5"
            : "hover:bg-glass-hover",
      )}
    >
      {isSelected && (
        <div
          className="absolute right-1 top-1 z-10 flex h-4 w-4 items-center justify-center rounded border border-success bg-success text-bg-primary"
          aria-hidden="true"
        >
          <Check size={10} strokeWidth={3} />
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
          "text-2xs",
          isActive ? "text-accent font-medium" : "text-text-muted",
        )}
      >
        {pageNum}
      </span>
    </button>
  );
}
