// Reader-content themes (light/dark/sepia). Kept separate from the UI-chrome
// themes in @/lib/themes: this palette applies through three paths (EPUB
// rendition CSS, TextViewer inline styles, PDF gutter) so hex lives in one place.
// Dark bg is warmer than pure #000 to avoid the OLED halo effect during scroll.

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
  /** Gutter around PDF pages. */
  pdfGutter: string;
  /** CSS filter for the PDF page canvas, or null to render as-is. */
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
    // invert + hue-rotate fakes dark pages while keeping image colours roughly right
    pdfPageFilter: "invert(1) hue-rotate(180deg)",
  },
  sepia: {
    background: "#f4ecd8",
    text: "#5b4636",
    textStrong: "#3a2d22",
    textMuted: "#8c7660",
    pdfGutter: "#e8dfc6",
    // no page filter: sepia-tinting diagrams/photos looks worse than the original
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
