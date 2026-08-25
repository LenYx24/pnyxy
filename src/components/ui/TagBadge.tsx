/* eslint-disable react-refresh/only-export-components -- this file
   intentionally re-exports tag-color helpers alongside the TagBadge
   component. The only downside is slightly coarser fast-refresh for
   consumers; runtime behavior is unaffected. */
import { cn } from "@/lib/cn";
import {
  TAG_LABELS,
  COLOR_PALETTE,
  DEFAULT_TAG_COLORS,
  DEFAULT_CUSTOM_TAG_COLOR,
  ALL_STATUS_TAGS,
  COLOR_KEYS,
  getTagLabel,
  resolveTagStyle,
  type ColorKey,
  type TagStyle,
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
  resolveTagStyle,
  type ColorKey,
  type TagStyle,
};

/** Resolved chip / dot styling for a status tag (palette or custom hex). */
export function getTagColor(tag: BookStatusTag): TagStyle {
  const customColors = useSettingsStore.getState().tagColors;
  const colorKey = customColors[tag] ?? DEFAULT_TAG_COLORS[tag];
  return resolveTagStyle(colorKey);
}

/** Resolved chip / dot styling for a free-text custom tag label. */
export function getCustomTagColor(label: string): TagStyle {
  const color =
    useSettingsStore.getState().customTagColors[label] ?? DEFAULT_CUSTOM_TAG_COLOR;
  return resolveTagStyle(color);
}

// Components

const badgeBase = "inline-flex items-center rounded-full font-medium";
const badgeSize = {
  sm: "px-2 py-0.5 text-2xs",
  md: "px-2.5 py-1 text-xs",
};

interface TagBadgeProps {
  tag: BookStatusTag;
  size?: "sm" | "md";
  onClick?: () => void;
}

export function TagBadge({ tag, size = "sm", onClick }: TagBadgeProps) {
  const customColorKey = useSettingsStore((s) => s.tagColors[tag]);
  const colorKey = customColorKey ?? DEFAULT_TAG_COLORS[tag];
  const style = resolveTagStyle(colorKey);

  return (
    <span
      onClick={onClick}
      style={style.style}
      className={cn(
        badgeBase,
        style.className,
        badgeSize[size],
        onClick && "cursor-pointer hover:opacity-80 transition-opacity",
      )}
    >
      {TAG_LABELS[tag]}
    </span>
  );
}

interface CustomTagBadgeProps {
  label: string;
  size?: "sm" | "md";
  className?: string;
  title?: string;
  children?: React.ReactNode;
}

/** Chip for a free-text custom tag, colored from Settings > Tags. */
export function CustomTagBadge({
  label,
  size = "sm",
  className,
  title,
  children,
}: CustomTagBadgeProps) {
  const colorKey = useSettingsStore(
    (s) => s.customTagColors[label] ?? DEFAULT_CUSTOM_TAG_COLOR,
  );
  const style = resolveTagStyle(colorKey);
  return (
    <span
      style={style.style}
      title={title}
      className={cn(badgeBase, style.className, badgeSize[size], className)}
    >
      {label}
      {children}
    </span>
  );
}
