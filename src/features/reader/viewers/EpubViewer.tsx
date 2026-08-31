import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Book, Contents, Rendition } from "epubjs";
import { AlertTriangle } from "lucide-react";
import { useReaderStore, useDocumentState } from "@/stores/reader-store";
import { useSearchStore } from "@/stores/search-store";
import { useSettingsStore } from "@/stores/settings-store";
import { getReaderPalette } from "@/lib/reader-themes";
import { logError } from "@/lib/logger";
import {
  EPUB_COLUMN_WIDTH_CSS,
  EPUB_FONT_FAMILY_CSS,
} from "@/lib/epub-typography";
import { AnnotationContextMenu } from "../popovers/AnnotationContextMenu";
import { CommentPopover } from "../popovers/CommentPopover";
import {
  EpubSelectionPopover,
  type EpubSelectionState,
} from "../popovers/EpubSelectionPopover";

interface EpubViewerProps {
  documentId?: string;
}

interface EpubAdapterLike {
  getBook?: () => Book | null;
}

/** Renders an EPUB via epubjs. Search jumps to the spine item holding the match. */
export function EpubViewer({ documentId }: EpubViewerProps) {
  const { t } = useTranslation();
  const activeDocumentId = useReaderStore((s) => s.activeDocumentId);
  const docId = documentId ?? activeDocumentId;
  const doc = useDocumentState(docId ?? "");
  const containerRef = useRef<HTMLDivElement>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const [renderError, setRenderError] = useState(false);

  const matches = useSearchStore((s) => s.matches);
  const currentIdx = useSearchStore((s) => s.currentIdx);
  const allowAnnotations = useSettingsStore(
    (s) => s.experimental_allowAnnotationsForAllFormats,
  );
  const epubFlow = useSettingsStore((s) => s.epubFlow);
  const epubFontScale = useSettingsStore((s) => s.epubFontScale);
  const epubLineHeight = useSettingsStore((s) => s.epubLineHeight);
  const epubFontFamily = useSettingsStore((s) => s.epubFontFamily);
  const epubColumnWidth = useSettingsStore((s) => s.epubColumnWidth);
  const readerTheme = useSettingsStore((s) => s.readerTheme);
  // survives the rendition re-mount on flow toggle so we don't snap back to chapter 1
  const lastCfiRef = useRef<string | null>(null);

  const [selection, setSelection] = useState<EpubSelectionState | null>(null);
  const dismissSelection = useCallback(() => setSelection(null), []);

  // remount rendition on Book or flow change; epubjs can't switch flow reactively
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !doc) return;
    setRenderError(false);
    const adapter = doc.adapter as EpubAdapterLike;
    const book = adapter.getBook?.();
    if (!book) {
      logError("epub:noBook", new Error(`epub adapter returned no book for ${doc.meta.id}`));
      setRenderError(true);
      return;
    }

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

    // track position on relocate; also persist the CFI (IndexedDB + cloud)
    const handleRelocated = (location: { start?: { cfi?: string } }) => {
      const cfi = location?.start?.cfi;
      if (typeof cfi === "string") {
        lastCfiRef.current = cfi;
        useReaderStore.getState().setCfi(cfi, doc.meta.id);
      }
      // scroll/page-turn invalidates the selection's viewport coords
      setSelection(null);
    };
    rendition.on("relocated", handleRelocated);

    // epubjs fires `selected` for selections inside a rendered iframe
    const handleSelected = (_cfiRange: string, contents: Contents) => {
      const win = contents.window;
      const sel = win?.getSelection?.();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
      const text = sel.toString().trim();
      if (!text) return;
      const range = sel.getRangeAt(0);
      const rangeRect = range.getBoundingClientRect();
      // rect is iframe-viewport coords; add the iframe's own offset for the outer viewport
      const frame = win.frameElement as HTMLIFrameElement | null;
      if (!frame) return;
      const frameRect = frame.getBoundingClientRect();
      setSelection({
        text,
        rect: {
          left: frameRect.left + rangeRect.left,
          top: frameRect.top + rangeRect.top,
          width: rangeRect.width,
          height: rangeRect.height,
        },
      });
    };
    rendition.on("selected", handleSelected);

    // apply typography + theme before first display to avoid a reflow/colour flash.
    // override(..., true) marks the rule !important to beat the EPUB's inline styles.
    rendition.themes.fontSize(`${Math.round(epubFontScale * 100)}%`);
    rendition.themes.override("line-height", String(epubLineHeight), true);
    applyEpubThemeColours(rendition, readerTheme);
    applyEpubLayout(rendition, {
      fontFamily: epubFontFamily,
      columnWidth: epubColumnWidth,
      flow: epubFlow,
    });

    // prefer the in-session ref, else the synced CFI for a fresh open
    rendition
      .display(lastCfiRef.current ?? doc.cfi ?? undefined)
      .catch((err: unknown) => {
        logError("epub:displayError", err);
        setRenderError(true);
      });

    return () => {
      try {
        rendition.off("relocated", handleRelocated);
        rendition.off("selected", handleSelected);
        rendition.destroy();
      } catch {
        // epubjs can throw on double-destroy
      }
      renditionRef.current = null;
      setSelection(null);
    };
    // font scale / line height applied live by the effect below, not deps here
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, epubFlow]);

  // live-apply typography (slider drags) without remounting
  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition) return;
    rendition.themes.fontSize(`${Math.round(epubFontScale * 100)}%`);
    rendition.themes.override("line-height", String(epubLineHeight), true);
  }, [epubFontScale, epubLineHeight]);

  // live-apply theme so scroll position survives a recolour
  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition) return;
    applyEpubThemeColours(rendition, readerTheme);
  }, [readerTheme]);

  // live-apply font-family / column-width presets
  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition) return;
    applyEpubLayout(rendition, {
      fontFamily: epubFontFamily,
      columnWidth: epubColumnWidth,
      flow: epubFlow,
    });
  }, [epubFontFamily, epubColumnWidth, epubFlow]);

  // jump to the active match's spine item
  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition) return;
    if (currentIdx < 0 || currentIdx >= matches.length) return;
    const match = matches[currentIdx];
    if (!match.spineHref) return;
    void rendition.display(match.spineHref);
  }, [matches, currentIdx]);

  if (!doc) return null;

  const palette = getReaderPalette(readerTheme);
  return (
    <div className="relative h-full w-full">
      <div
        ref={containerRef}
        data-active-viewer
        data-epub-viewer
        // also colours the paginated-flow gutter between spread and iframe edge
        style={{ backgroundColor: palette.background, color: palette.text }}
        className="h-full w-full overflow-auto"
      />
      {renderError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-bg-primary p-4 text-center text-text-secondary">
          <AlertTriangle size={24} className="text-warning" />
          <span className="text-sm">{t("reader.viewer.epubLoadFailed")}</span>
        </div>
      )}
      {allowAnnotations && (
        <>
          <AnnotationContextMenu />
          <CommentPopover />
        </>
      )}
      <EpubSelectionPopover
        selection={selection}
        onDismiss={dismissSelection}
      />
    </div>
  );
}

/** Push reader-theme colours into every spine iframe (!important to beat EPUB inline styles). */
function applyEpubThemeColours(
  rendition: Rendition,
  themeId: "light" | "dark" | "sepia",
): void {
  const palette = getReaderPalette(themeId);
  rendition.themes.override("background", palette.background, true);
  rendition.themes.override("background-color", palette.background, true);
  rendition.themes.override("color", palette.text, true);
  rendition.themes.override("--reader-text-strong", palette.textStrong, true);
  rendition.themes.override("--reader-text-muted", palette.textMuted, true);
}

/**
 * Body-level font-family and max-width overrides.
 * max-width is skipped in paginated flow: epub.js derives column widths from the
 * body's natural width, so capping it there breaks column layout and the page counter.
 */
function applyEpubLayout(
  rendition: Rendition,
  opts: {
    fontFamily: keyof typeof EPUB_FONT_FAMILY_CSS;
    columnWidth: keyof typeof EPUB_COLUMN_WIDTH_CSS;
    flow: "scrolled" | "paginated";
  },
): void {
  const fontFamilyCss = EPUB_FONT_FAMILY_CSS[opts.fontFamily];
  if (fontFamilyCss) {
    rendition.themes.override("font-family", fontFamilyCss, true);
  } else {
    // clear explicitly, else the old inline rule keeps overriding the EPUB's font
    rendition.themes.override("font-family", "", true);
  }

  const maxWidthCss = EPUB_COLUMN_WIDTH_CSS[opts.columnWidth];
  if (maxWidthCss && opts.flow === "scrolled") {
    rendition.themes.override("max-width", maxWidthCss, true);
    rendition.themes.override("margin-left", "auto", true);
    rendition.themes.override("margin-right", "auto", true);
  } else {
    rendition.themes.override("max-width", "", true);
    rendition.themes.override("margin-left", "", true);
    rendition.themes.override("margin-right", "", true);
  }
}
