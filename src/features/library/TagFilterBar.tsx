import { useTranslation } from "react-i18next";
import { Heart } from "lucide-react";
import { cn } from "@/lib/cn";
import { ALL_STATUS_TAGS, getTagLabel, getTagColor } from "@/components/ui/TagBadge";
import { useSettingsStore } from "@/stores/settings-store";
import type { BookStatusTag } from "@/types/database";

interface TagFilterBarProps {
  activeTag: BookStatusTag | null;
  onTagChange: (tag: BookStatusTag | null) => void;
}

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
    <div className="mb-4 flex gap-1.5 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0">
      <button
        onClick={() => onTagChange(null)}
        className={cn(
          "rounded-full px-3 py-1 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap",
          activeTag === null
            ? "bg-accent/15 text-accent"
            : "bg-glass-bg text-text-muted hover:text-text-primary border border-glass-border",
        )}
      >
        {t("library.tagFilter.all")}
      </button>
      <button
        onClick={() => onTagChange(favoritesActive ? null : "favorites")}
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap",
          favoritesActive
            ? `${favoritesColors.bg} ${favoritesColors.text}`
            : "bg-glass-bg text-text-muted hover:text-text-primary border border-glass-border",
        )}
      >
        <Heart
          size={12}
          fill={favoritesActive ? "currentColor" : "none"}
        />
        {getTagLabel("favorites")}
      </button>
      <div className="mx-0.5 hidden w-px self-stretch bg-glass-border sm:block" />
      {secondaryTags.map((tag) => {
        const isActive = activeTag === tag;
        const colors = getTagColor(tag);
        return (
          <button
            key={tag}
            onClick={() => onTagChange(activeTag === tag ? null : tag)}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap",
              isActive
                ? `${colors.bg} ${colors.text}`
                : "bg-glass-bg text-text-muted hover:text-text-primary border border-glass-border",
            )}
          >
            {getTagLabel(tag)}
          </button>
        );
      })}
    </div>
  );
}
