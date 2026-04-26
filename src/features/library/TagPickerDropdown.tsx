import type { RefObject } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/cn";
import { ALL_STATUS_TAGS, getTagLabel, getTagColor } from "@/components/ui/TagBadge";
import { FloatingMenu } from "@/components/ui";
import { useTagStore, bookKey } from "@/stores/tag-store";
import type { UnifiedLibraryItem } from "@/types/catalog";

interface TagPickerDropdownProps {
  item: UnifiedLibraryItem;
  onClose: () => void;
  /** Element the dropdown anchors to. Required so the picker can
   *  render via portal and escape any clipping ancestor (cards have
   *  `overflow: hidden`, the list container has `overflow-x-auto`). */
  anchorRef: RefObject<HTMLElement | null>;
}

export function TagPickerDropdown({
  item,
  onClose,
  anchorRef,
}: TagPickerDropdownProps) {
  const tagKey = bookKey(item);
  const tags = useTagStore((s) => s.bookTags.get(tagKey)) ?? [];
  const addTag = useTagStore((s) => s.addTag);
  const removeTag = useTagStore((s) => s.removeTag);

  const handleToggle = async (tag: typeof ALL_STATUS_TAGS[number]) => {
    if (tags.includes(tag)) {
      await removeTag(item, tag);
    } else {
      await addTag(item, tag);
    }
  };

  return (
    <FloatingMenu
      open={true}
      anchorRef={anchorRef}
      onClose={onClose}
      className="w-48"
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
              active
                ? "text-accent-purple"
                : "text-text-secondary hover:text-text-primary",
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
    </FloatingMenu>
  );
}
