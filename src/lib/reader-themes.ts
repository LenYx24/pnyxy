/**
 * Reader-content themes — light / dark / sepia. Separate from the
 * UI-chrome theme system in `@/lib/themes` because:
 *   1. The reader background reads as part of the *document*, not the
 *      app — sepia text on app chrome looks weird, but sepia inside
 *      the reading surface is the canonical "page" colour.
 *   2. Themes here apply through three very different code paths
 *      (EPUB rendition CSS overrides, TextViewer inline styles, PDF
 *      gutter container). Colocating the palette here keeps those
 *      paths consistent — change the hex here, all three update.
 *
 * Hex choices come from the canonical Kindle / iOS Books palettes,
 * which is what most readers' eyes are trained on. Dark is slightly
 * warmer than pure #000 to keep contrast comfortable on OLED — full
 * black with full white text causes a "halo" effect during scroll.
 */

export type ReaderTheme = "light" | "dark" | "sepia";

export interface ReaderThemePalette {
  /** Page / iframe background colour. */
  background: string;
  /** Body text colour. */
  text: string;
  /** Heading / strong-emphasis text colour. */
  textStrong: string;
  /** Muted / secondary text (links, captions). */
  textMuted: string;
  /** Hex for the gutter around PDF pages (the space outside the page
   *  itself, which we can theme even though the rendered page is a
   *  raster). */
  pdfGutter: string;
  /**
   * Optional CSS `filter` value to apply to the PDF page canvas in
   * this theme. `null` = no filter (page renders as-is). Used to
   * approximate "dark mode" on raster PDF content where we can't
   * change ink colour directly.
   */
  pdfPageFilter: string | null;
}

export const READER_THEMES: Record<ReaderTheme, ReaderThemePalette> = {
  light: {
    background: "#ffffff",
    text: "#1a1a1a",
    textStrong: "#000000",
    textMuted: "#525252",
    pdfGutter: "#e5e5e5",
    pdfPageFilter: null,
  },
  dark: {
    background: "#1a1a1a",
    text: "#e0e0e0",
    textStrong: "#ffffff",
    textMuted: "#a3a3a3",
    pdfGutter: "#0d0d0d",
    // PDF pages are raster — there's no way to recolour their ink
    // without re-rasterising. invert + hue-rotate cheaply gets dark
    // pages with roughly-correct image colours, matching the
    // previous `pdfInvertColors` behaviour.
    pdfPageFilter: "invert(1) hue-rotate(180deg)",
  },
  sepia: {
    background: "#f4ecd8",
    text: "#5b4636",
    textStrong: "#3a2d22",
    textMuted: "#8c7660",
    pdfGutter: "#e8dfc6",
    // Don't filter the PDF page itself — sepia-filtering tints
    // diagrams / photos / coloured charts in a way readers find
    // worse than the original. The gutter alone carries the "this is
    // sepia mode" visual cue.
    pdfPageFilter: null,
  },
};

export const READER_THEME_IDS: readonly ReaderTheme[] = [
  "light",
  "dark",
  "sepia",
] as const;

export function getReaderPalette(theme: ReaderTheme): ReaderThemePalette {
  return READER_THEMES[theme] ?? READER_THEMES.light;
}
