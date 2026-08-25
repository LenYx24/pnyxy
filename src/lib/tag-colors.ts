import type { CSSProperties } from "react";
import type { BookStatusTag } from "@/types/database";

// Color palette (pure data, no store imports)

/** Named palette entries; these map to Tailwind classes. */
export type PaletteKey =
  | "blue"
  | "amber"
  | "green"
  | "red"
  | "gray"
  | "pink"
  | "purple"
  | "teal"
  | "orange"
  | "indigo";

/** Any tag color: a palette key or an arbitrary `#rrggbb` hex string. */
export type ColorKey = PaletteKey | `#${string}`;

export const COLOR_KEYS: PaletteKey[] = [
  "blue",
  "amber",
  "green",
  "red",
  "gray",
  "pink",
  "purple",
  "teal",
  "orange",
  "indigo",
];

export const COLOR_PALETTE: Record<PaletteKey, { bg: string; text: string; dot: string; hex: string }> = {
  blue:    { bg: "bg-blue-500/15",    text: "text-blue-400",    dot: "bg-blue-400",    hex: "#60a5fa" },
  amber:   { bg: "bg-amber-500/15",   text: "text-amber-400",   dot: "bg-amber-400",   hex: "#fbbf24" },
  green:   { bg: "bg-green-500/15",   text: "text-green-400",   dot: "bg-green-400",   hex: "#4ade80" },
  red:     { bg: "bg-red-500/15",     text: "text-red-400",     dot: "bg-red-400",     hex: "#f87171" },
  gray:    { bg: "bg-gray-500/15",    text: "text-gray-400",    dot: "bg-gray-400",    hex: "#9ca3af" },
  pink:    { bg: "bg-pink-500/15",    text: "text-pink-400",    dot: "bg-pink-400",    hex: "#f472b6" },
  purple:  { bg: "bg-purple-500/15",  text: "text-purple-400",  dot: "bg-purple-400",  hex: "#c084fc" },
  teal:    { bg: "bg-teal-500/15",    text: "text-teal-400",    dot: "bg-teal-400",    hex: "#2dd4bf" },
  orange:  { bg: "bg-orange-500/15",  text: "text-orange-400",  dot: "bg-orange-400",  hex: "#fb923c" },
  indigo:  { bg: "bg-indigo-500/15",  text: "text-indigo-400",  dot: "bg-indigo-400",  hex: "#818cf8" },
};

export const DEFAULT_TAG_COLORS: Record<BookStatusTag, PaletteKey> = {
  currently_reading: "blue",
  want_to_read: "amber",
  done: "green",
  abandoned: "red",
  hiatus: "gray",
  favorites: "pink",
};

export const TAG_LABELS: Record<BookStatusTag, string> = {
  currently_reading: "Reading",
  want_to_read: "Want to Read",
  done: "Done",
  abandoned: "Abandoned",
  hiatus: "Hiatus",
  favorites: "Favorite",
};

export const ALL_STATUS_TAGS: BookStatusTag[] = [
  "currently_reading",
  "want_to_read",
  "done",
  "abandoned",
  "hiatus",
  "favorites",
];

export function getTagLabel(tag: BookStatusTag): string {
  return TAG_LABELS[tag];
}

// ---- arbitrary hex support ----------------------------------------

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function isHexColor(value: string): value is `#${string}` {
  return HEX_RE.test(value);
}

export function isPaletteKey(value: string): value is PaletteKey {
  return (COLOR_KEYS as string[]).includes(value);
}

/** Expand `#abc` to `#aabbcc`, lower-cased. Returns null for junk. */
export function normalizeHex(value: string): `#${string}` | null {
  const v = value.trim();
  const withHash = v.startsWith("#") ? v : `#${v}`;
  if (!isHexColor(withHash)) return null;
  const body = withHash.slice(1);
  const full =
    body.length === 3
      ? body
          .split("")
          .map((c) => c + c)
          .join("")
      : body;
  return `#${full.toLowerCase()}`;
}

/** `#rrggbb` + alpha (0..1) as an 8-digit hex string. */
export function hexWithAlpha(hex: `#${string}`, alpha: number): string {
  const full = normalizeHex(hex) ?? "#9ca3af";
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, "0");
  return `${full}${a}`;
}

/** The solid hex behind any color key (palette keys map to their 400 tone). */
export function colorKeyToHex(color: ColorKey): `#${string}` {
  if (isPaletteKey(color)) return COLOR_PALETTE[color].hex as `#${string}`;
  return normalizeHex(color) ?? "#9ca3af";
}

/**
 * What a consumer needs to paint a tag chip or dot for any color key.
 * Palette keys keep the Tailwind classes (theme-aware); hex values are
 * painted inline: background at 18% alpha, text at full.
 */
export interface TagStyle {
  className: string;
  style?: CSSProperties;
  dotClassName: string;
  dotStyle?: CSSProperties;
}

export function resolveTagStyle(color: ColorKey): TagStyle {
  if (isPaletteKey(color)) {
    const p = COLOR_PALETTE[color];
    return { className: `${p.bg} ${p.text}`, dotClassName: p.dot };
  }
  const hex = colorKeyToHex(color);
  return {
    className: "",
    style: { backgroundColor: hexWithAlpha(hex, 0.18), color: hex },
    dotClassName: "",
    dotStyle: { backgroundColor: hex },
  };
}

/** Default color for a custom (free-text) tag with no explicit color. */
export const DEFAULT_CUSTOM_TAG_COLOR: PaletteKey = "gray";
