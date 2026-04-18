import { useRef, useEffect } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/cn";
import { ALL_STATUS_TAGS, getTagLabel, getTagColor } from "@/components/ui/TagBadge";
import { useTagStore, bookKey } from "@/stores/tag-store";
import type { UnifiedLibraryItem } from "@/types/catalog";

interface TagPickerDropdownProps {
  item: UnifiedLibraryItem;
  onClose: () => void;
}

export function TagPickerDropdown({ item, onClose }: TagPickerDropdownProps) {
  const ref = useRef<HTMLDivElement>(null);
  const tagKey = bookKey(item);
  const tags = useTagStore((s) => s.bookTags.get(tagKey)) ?? [];
  const addTag = useTagStore((s) => s.addTag);
  const removeTag = useTagStore((s) => s.removeTag);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  const handleToggle = async (tag: typeof ALL_STATUS_TAGS[number]) => {
    if (tags.includes(tag)) {
      await removeTag(item, tag);
    } else {
      await addTag(item, tag);
    }
  };

  return (
    <div
      ref={ref}
      className="absolute right-0 top-8 z-30 w-48 max-w-[calc(100vw-1rem)] rounded-lg border border-glass-border bg-bg-secondary/95 py-1 shadow-lg backdrop-blur-xl"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
        Reading Status
      </div>
      {ALL_STATUS_TAGS.map((tag) => {
        const active = tags.includes(tag);
        const colors = getTagColor(tag);
        return (
          <button
            key={tag}
            onClick={() => handleToggle(tag)}
            className={cn(
              "flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-glass-hover cursor-pointer",
              active ? "text-accent-purple" : "text-text-secondary hover:text-text-primary",
            )}
          >
            <div
              className={cn(
                "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
                active
                  ? "border-accent-purple bg-accent-purple"
                  : "border-glass-border",
              )}
            >
              {active && <Check size={10} className="text-white" />}
            </div>
            {/* Colored dot */}
            <span className={cn("h-2 w-2 shrink-0 rounded-full", colors.dot)} />
            {getTagLabel(tag)}
          </button>
        );
      })}
    </div>
  );
}
