import { useTranslation } from "react-i18next";
import { Heart } from "lucide-react";
import { cn } from "@/lib/cn";
import { chipActiveClass, chipClass } from "@/components/ui/classes";
import { ALL_STATUS_TAGS, getTagLabel, getTagColor } from "@/components/ui/TagBadge";
import { useSettingsStore } from "@/stores/settings-store";
import type { BookStatusTag } from "@/types/database";

interface TagFilterBarProps {
  activeTag: BookStatusTag | null;
  onTagChange: (tag: BookStatusTag | null) => void;
}

/**
 * Tag chips for the library filter row. Renders a fragment of chips
 * (no wrapper) so the parent row can lay them out inline with the
 * type chips and share one gap / wrap rule.
 */
export function TagFilterBar({ activeTag, onTagChange }: TagFilterBarProps) {
  const { t } = useTranslation();
  // Subscribe so we re-render when tagColors change
  useSettingsStore((s) => s.tagColors);

  // Favorites is promoted to the front as a built-in-category chip with
  // a heart icon; the rest of the status tags follow.
  const secondaryTags = ALL_STATUS_TAGS.filter((t) => t !== "favorites");
  const favoritesActive = activeTag === "favorites";
  const favoritesColors = getTagColor("favorites");

  return (
    <>
      <button
        onClick={() => onTagChange(null)}
        data-filter="tag"
        aria-pressed={activeTag === null}
        className={cn(
          "font-medium transition-colors cursor-pointer hover:text-text-primary",
          activeTag === null ? chipActiveClass : chipClass,
        )}
      >
        {t("library.tagFilter.all")}
      </button>
      <button
        onClick={() => onTagChange(favoritesActive ? null : "favorites")}
        data-filter="tag"
        aria-pressed={favoritesActive}
        style={favoritesActive ? favoritesColors.style : undefined}
        className={cn(
          chipClass,
          "font-medium transition-colors cursor-pointer hover:text-text-primary",
          favoritesActive && favoritesColors.className,
        )}
      >
        <Heart
          size={14}
          strokeWidth={1.5}
          fill={favoritesActive ? "currentColor" : "none"}
        />
        {getTagLabel("favorites")}
      </button>
      {secondaryTags.map((tag) => {
        const isActive = activeTag === tag;
        const colors = getTagColor(tag);
        return (
          <button
            key={tag}
            onClick={() => onTagChange(activeTag === tag ? null : tag)}
            data-filter="tag"
            aria-pressed={isActive}
            style={isActive ? colors.style : undefined}
            className={cn(
              chipClass,
              "font-medium transition-colors cursor-pointer hover:text-text-primary",
              isActive && colors.className,
            )}
          >
            {getTagLabel(tag)}
          </button>
        );
      })}
    </>
  );
}
