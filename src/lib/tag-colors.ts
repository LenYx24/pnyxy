import type { BookStatusTag } from "@/types/database";

// Color palette (pure data, no store imports)

export type ColorKey =
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

export const COLOR_KEYS: ColorKey[] = [
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

export const COLOR_PALETTE: Record<ColorKey, { bg: string; text: string; dot: string }> = {
  blue:    { bg: "bg-blue-500/15",    text: "text-blue-400",    dot: "bg-blue-400" },
  amber:   { bg: "bg-amber-500/15",   text: "text-amber-400",   dot: "bg-amber-400" },
  green:   { bg: "bg-green-500/15",   text: "text-green-400",   dot: "bg-green-400" },
  red:     { bg: "bg-red-500/15",     text: "text-red-400",     dot: "bg-red-400" },
  gray:    { bg: "bg-gray-500/15",    text: "text-gray-400",    dot: "bg-gray-400" },
  pink:    { bg: "bg-pink-500/15",    text: "text-pink-400",    dot: "bg-pink-400" },
  purple:  { bg: "bg-purple-500/15",  text: "text-purple-400",  dot: "bg-purple-400" },
  teal:    { bg: "bg-teal-500/15",    text: "text-teal-400",    dot: "bg-teal-400" },
  orange:  { bg: "bg-orange-500/15",  text: "text-orange-400",  dot: "bg-orange-400" },
  indigo:  { bg: "bg-indigo-500/15",  text: "text-indigo-400",  dot: "bg-indigo-400" },
};

export const DEFAULT_TAG_COLORS: Record<BookStatusTag, ColorKey> = {
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
