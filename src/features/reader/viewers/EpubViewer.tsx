import { useCallback, useEffect, useRef, useState } from "react";
import type { Book, Contents, Rendition } from "epubjs";
import { useReaderStore, useDocumentState } from "@/stores/reader-store";
import { useSearchStore } from "@/stores/search-store";
import { useSettingsStore } from "@/stores/settings-store";
import { getReaderPalette } from "@/lib/reader-themes";
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
  const epubFontFamily = useSettingsStore((s) => s.epubFontFamily);
  const epubColumnWidth = useSettingsStore((s) => s.epubColumnWidth);
  const readerTheme = useSettingsStore((s) => s.readerTheme);
  // Survives across the rendition re-mount that fires when the user
  // toggles flow modes — without this the reader would snap back to
  // chapter 1 on every toggle.
  const lastCfiRef = useRef<string | null>(null);

  const [selection, setSelection] = useState<EpubSelectionState | null>(null);
  const dismissSelection = useCallback(() => setSelection(null), []);

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
    // re-mount) can restore where the reader was. Also pipes the CFI
    // into the reader-store so it gets persisted (IndexedDB + cloud)
    // and survives a different-device reopen.
    const handleRelocated = (location: { start?: { cfi?: string } }) => {
      const cfi = location?.start?.cfi;
      if (typeof cfi === "string") {
        lastCfiRef.current = cfi;
        useReaderStore.getState().setCfi(cfi, doc.meta.id);
      }
      // Page-turn or scroll invalidates the selection's viewport coords.
      setSelection(null);
    };
    rendition.on("relocated", handleRelocated);

    // epubjs emits `selected` whenever a selection settles inside any
    // rendered iframe. Without this hook, EPUB text selection is a
    // black hole — the user selects, the OS shows native handles, and
    // nothing app-side ever knows.
    const handleSelected = (_cfiRange: string, contents: Contents) => {
      const win = contents.window;
      const sel = win?.getSelection?.();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
      const text = sel.toString().trim();
      if (!text) return;
      const range = sel.getRangeAt(0);
      const rangeRect = range.getBoundingClientRect();
      // Selection rect is in iframe-viewport coords; translate into the
      // outer viewport by adding the iframe element's own position.
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

    // Apply typography + theme before the first display so the initial
    // paint already uses the user's preferences — avoids a visible
    // reflow / colour flash. `override(..., true)` makes the rule
    // `!important` so it wins over the EPUB's own inline styles.
    rendition.themes.fontSize(`${Math.round(epubFontScale * 100)}%`);
    rendition.themes.override("line-height", String(epubLineHeight), true);
    applyEpubThemeColours(rendition, readerTheme);
    applyEpubLayout(rendition, {
      fontFamily: epubFontFamily,
      columnWidth: epubColumnWidth,
      flow: epubFlow,
    });

    // Initial position: prefer the local ref (set during a flow-mode
    // toggle remount in this same session), fall back to the cloud-/
    // local-synced CFI on the document state for a fresh open.
    void rendition.display(lastCfiRef.current ?? doc.cfi ?? undefined);

    return () => {
      try {
        rendition.off("relocated", handleRelocated);
        rendition.off("selected", handleSelected);
        rendition.destroy();
      } catch {
        // epubjs may throw on double-destroy; safe to swallow.
      }
      renditionRef.current = null;
      setSelection(null);
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

  // Live-apply theme changes the same way — switching light → sepia
  // recolours all already-rendered spine items without a re-mount, so
  // the user's scroll position survives.
  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition) return;
    applyEpubThemeColours(rendition, readerTheme);
  }, [readerTheme]);

  // Live-apply font-family / column-width preset changes.
  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition) return;
    applyEpubLayout(rendition, {
      fontFamily: epubFontFamily,
      columnWidth: epubColumnWidth,
      flow: epubFlow,
    });
  }, [epubFontFamily, epubColumnWidth, epubFlow]);

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

  const palette = getReaderPalette(readerTheme);
  return (
    <div className="relative h-full w-full">
      <div
        ref={containerRef}
        data-active-viewer
        data-epub-viewer
        // Background also colours the gutter that appears in paginated
        // flow between the spread and the iframe edge; without this it
        // shows through as the app-chrome bg, breaking the illusion of
        // a page on sepia / light.
        style={{ backgroundColor: palette.background, color: palette.text }}
        className="h-full w-full overflow-auto"
      />
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

/**
 * Push the active reader-theme colours into the rendition. epub.js's
 * `themes.override(prop, val, important)` writes a CSS rule into every
 * spine iframe — `important` to beat the EPUB's own inline styles
 * (which often set background-color on `<body>` or text colour on
 * paragraphs). Headings get the strong-emphasis colour so they pop in
 * sepia / dark modes where the body text is intentionally low-contrast.
 */
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
 * Body-level layout overrides — font-family and max-width — written
 * via the same `themes.override` path the rest of the viewer uses.
 * epub.js's `override` ultimately calls `body.style.setProperty(...)`
 * inside each rendered iframe, so these land as inline body styles
 * with `!important`.
 *
 * Skipped in paginated flow because epub.js computes column widths
 * from the body's natural width; capping `max-width` here would tell
 * it to lay out columns inside a 65ch slab and the page counter
 * would go wrong. Padding stays untouched for the same reason — epub.js
 * sets it for column gaps in paginated mode and overriding fights
 * the pagination math.
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
    // Reverting from a preset back to "default" needs an explicit
    // clear — leaving the previous inline body rule in place would
    // keep overriding the EPUB's own font choices.
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
