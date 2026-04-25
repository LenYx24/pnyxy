import { useEffect, useRef } from "react";
import type { Book, Rendition } from "epubjs";
import { useReaderStore, useDocumentState } from "@/stores/reader-store";
import { useSearchStore } from "@/stores/search-store";
import { useSettingsStore } from "@/stores/settings-store";
import { AnnotationContextMenu } from "./AnnotationContextMenu";
import { CommentPopover } from "./CommentPopover";

interface EpubViewerProps {
  documentId?: string;
}

interface EpubAdapterLike {
  getBook?: () => Book | null;
}

/**
 * Renders an EPUB using `epubjs`' paginated/scrolled rendition. Search
 * navigation happens by displaying the spine item that contains the
 * currently-selected match.
 */
export function EpubViewer({ documentId }: EpubViewerProps) {
  const activeDocumentId = useReaderStore((s) => s.activeDocumentId);
  const docId = documentId ?? activeDocumentId;
  const doc = useDocumentState(docId ?? "");
  const containerRef = useRef<HTMLDivElement>(null);
  const renditionRef = useRef<Rendition | null>(null);

  const matches = useSearchStore((s) => s.matches);
  const currentIdx = useSearchStore((s) => s.currentIdx);
  const allowAnnotations = useSettingsStore(
    (s) => s.experimental_allowAnnotationsForAllFormats,
  );
  const epubFlow = useSettingsStore((s) => s.epubFlow);
  const epubFontScale = useSettingsStore((s) => s.epubFontScale);
  const epubLineHeight = useSettingsStore((s) => s.epubLineHeight);
  // Survives across the rendition re-mount that fires when the user
  // toggles flow modes — without this the reader would snap back to
  // chapter 1 on every toggle.
  const lastCfiRef = useRef<string | null>(null);

  // Mount the rendition whenever the underlying Book instance — or the
  // user's flow preference — changes. Switching flow requires a full
  // tear-down and re-create; epubjs doesn't reactively update it.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !doc) return;
    const adapter = doc.adapter as EpubAdapterLike;
    const book = adapter.getBook?.();
    if (!book) return;

    // "scrolled" → all spine items in one continuous scroll (closer to
    // a web page; preferred on desktop). "paginated" → discrete pages
    // with swipe-to-flip (preferred on mobile and for prose).
    const rendition =
      epubFlow === "paginated"
        ? book.renderTo(el, {
            width: "100%",
            height: "100%",
            flow: "paginated",
            manager: "default",
          })
        : book.renderTo(el, {
            width: "100%",
            height: "100%",
            flow: "scrolled-continuous",
            manager: "continuous",
          });
    renditionRef.current = rendition;

    // Capture position on every relocation so a flow toggle (or future
    // re-mount) can restore where the reader was.
    const handleRelocated = (location: { start?: { cfi?: string } }) => {
      const cfi = location?.start?.cfi;
      if (typeof cfi === "string") lastCfiRef.current = cfi;
    };
    rendition.on("relocated", handleRelocated);

    // Apply typography before the first display so the initial paint
    // already uses the user's preferred size — avoids a visible reflow.
    rendition.themes.fontSize(`${Math.round(epubFontScale * 100)}%`);
    rendition.themes.override("line-height", String(epubLineHeight), true);

    void rendition.display(lastCfiRef.current ?? undefined);

    return () => {
      try {
        rendition.off("relocated", handleRelocated);
        rendition.destroy();
      } catch {
        // epubjs may throw on double-destroy; safe to swallow.
      }
      renditionRef.current = null;
    };
    // epubFontScale / epubLineHeight are intentionally not deps — the
    // separate effect below applies them live without a re-mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, epubFlow]);

  // Live-apply typography changes (slider drags) without remounting.
  // epub.js's themes API patches CSS in the rendered iframe(s) directly.
  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition) return;
    rendition.themes.fontSize(`${Math.round(epubFontScale * 100)}%`);
    rendition.themes.override("line-height", String(epubLineHeight), true);
  }, [epubFontScale, epubLineHeight]);

  // When the active match changes, jump the rendition to its spine item.
  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition) return;
    if (currentIdx < 0 || currentIdx >= matches.length) return;
    const match = matches[currentIdx];
    if (!match.spineHref) return;
    void rendition.display(match.spineHref);
  }, [matches, currentIdx]);

  if (!doc) return null;

  return (
    <div className="relative h-full w-full">
      <div
        ref={containerRef}
        data-active-viewer
        data-epub-viewer
        className="h-full w-full overflow-auto bg-bg-primary text-text-primary"
      />
      {allowAnnotations && (
        <>
          <AnnotationContextMenu />
          <CommentPopover />
        </>
      )}
    </div>
  );
}
