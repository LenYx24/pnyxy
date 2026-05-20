/**
 * Typography options for the EPUB reader. Kept categorical (not raw
 * numbers / CSS strings) so the UI is a small button group rather
 * than a freeform input and the persisted shape stays
 * forward-compatible — adding a new font preset later just appends
 * a key here and a row in the picker.
 *
 * Mapped to CSS only inside the viewer; the store stays string-only.
 */

export type EpubFontFamily = "default" | "serif" | "sans" | "mono";

export type EpubColumnWidth = "full" | "wide" | "comfortable" | "narrow";

/**
 * Resolved CSS `font-family` value for each preset. `null` for
 * `default` because we want to *not override* in that case — the
 * EPUB's own typography choices should win when the user hasn't
 * picked a preset.
 *
 * Stacks lead with the platform-native flavour and fall back to
 * widely-bundled equivalents so nothing has to be downloaded.
 */
export const EPUB_FONT_FAMILY_CSS: Record<EpubFontFamily, string | null> = {
  default: null,
  serif: 'Georgia, "Iowan Old Style", "Palatino Linotype", "Book Antiqua", serif',
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Helvetica, Arial, sans-serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
};

/**
 * Resolved CSS `max-width` for each column preset. `null` for `full`
 * because that means "no override, let the iframe fill the
 * container" — the pre-feature behaviour for everyone, so existing
 * users who haven't picked a column width see no change.
 *
 * `ch` is the right unit here: it scales with font size, so the
 * column stays the same number of characters wide whether the user
 * is at 100% or 130% font scale. Comfortable (65ch) is the modern
 * typography rule-of-thumb for prose.
 */
export const EPUB_COLUMN_WIDTH_CSS: Record<EpubColumnWidth, string | null> = {
  full: null,
  wide: "90ch",
  comfortable: "65ch",
  narrow: "50ch",
};

export const EPUB_FONT_FAMILY_IDS: readonly EpubFontFamily[] = [
  "default",
  "serif",
  "sans",
  "mono",
] as const;

export const EPUB_COLUMN_WIDTH_IDS: readonly EpubColumnWidth[] = [
  "full",
  "wide",
  "comfortable",
  "narrow",
] as const;
