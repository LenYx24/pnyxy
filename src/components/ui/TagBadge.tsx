/* eslint-disable react-refresh/only-export-components -- this file
   intentionally re-exports tag-color helpers alongside the TagBadge
   component. The only downside is slightly coarser fast-refresh for
   consumers; runtime behavior is unaffected. */
import { cn } from "@/lib/cn";
import {
  TAG_LABELS,
  COLOR_PALETTE,
  DEFAULT_TAG_COLORS,
  ALL_STATUS_TAGS,
  COLOR_KEYS,
  getTagLabel,
  type ColorKey,
} from "@/lib/tag-colors";
import { useSettingsStore } from "@/stores/settings-store";
import type { BookStatusTag } from "@/types/database";

// Re-export everything consumers expect from this module
export {
  TAG_LABELS,
  COLOR_PALETTE,
  DEFAULT_TAG_COLORS,
  ALL_STATUS_TAGS,
  COLOR_KEYS,
  getTagLabel,
  type ColorKey,
};

export function getTagColor(tag: BookStatusTag): { bg: string; text: string; dot: string } {
  const customColors = useSettingsStore.getState().tagColors;
  const colorKey = customColors[tag] ?? DEFAULT_TAG_COLORS[tag];
  return COLOR_PALETTE[colorKey];
}

// ─── Component ──────────────────────────────────────────────

interface TagBadgeProps {
  tag: BookStatusTag;
  size?: "sm" | "md";
  onClick?: () => void;
}

export function TagBadge({ tag, size = "sm", onClick }: TagBadgeProps) {
  const customColorKey = useSettingsStore((s) => s.tagColors[tag]);
  const colorKey = customColorKey ?? DEFAULT_TAG_COLORS[tag];
  const colors = COLOR_PALETTE[colorKey];

  return (
    <span
      onClick={onClick}
      className={cn(
        "inline-flex items-center rounded-full font-medium",
        colors.bg,
        colors.text,
        size === "sm" ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs",
        onClick && "cursor-pointer hover:opacity-80 transition-opacity",
      )}
    >
      {TAG_LABELS[tag]}
    </span>
  );
}
