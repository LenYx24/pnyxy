import { cn } from "@/lib/cn";
import { ALL_STATUS_TAGS, getTagLabel, getTagColor } from "@/components/ui/TagBadge";
import { useSettingsStore } from "@/stores/settings-store";
import type { BookStatusTag } from "@/types/database";

interface TagFilterBarProps {
  activeTag: BookStatusTag | null;
  onTagChange: (tag: BookStatusTag | null) => void;
}

export function TagFilterBar({ activeTag, onTagChange }: TagFilterBarProps) {
  // Subscribe so we re-render when tagColors change
  useSettingsStore((s) => s.tagColors);

  return (
    <div className="mb-4 flex gap-1.5 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0">
      <button
        onClick={() => onTagChange(null)}
        className={cn(
          "rounded-full px-3 py-1 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap",
          activeTag === null
            ? "bg-accent-purple/15 text-accent-purple"
            : "bg-glass-bg text-text-muted hover:text-text-primary border border-glass-border",
        )}
      >
        All
      </button>
      {ALL_STATUS_TAGS.map((tag) => {
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
