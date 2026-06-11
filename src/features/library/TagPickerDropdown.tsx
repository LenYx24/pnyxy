import { useState, type RefObject } from "react";
import { Check, Plus, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { ALL_STATUS_TAGS, getTagLabel, getTagColor } from "@/components/ui/TagBadge";
import { FloatingMenu } from "@/components/ui";
import { useTagStore, bookKey, CUSTOM_TAG_MAX_LENGTH } from "@/stores/tag-store";
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
  const customTags = useTagStore((s) => s.customTagsByBook.get(tagKey)) ?? [];
  const addTag = useTagStore((s) => s.addTag);
  const removeTag = useTagStore((s) => s.removeTag);
  const addCustomTag = useTagStore((s) => s.addCustomTag);
  const removeCustomTag = useTagStore((s) => s.removeCustomTag);

  const [draft, setDraft] = useState("");

  const handleToggle = async (tag: typeof ALL_STATUS_TAGS[number]) => {
    if (tags.includes(tag)) {
      await removeTag(item, tag);
    } else {
      await addTag(item, tag);
    }
  };

  const handleAddCustom = async () => {
    const value = draft.trim();
    if (!value) return;
    await addCustomTag(item, value);
    setDraft("");
  };

  return (
    <FloatingMenu
      open={true}
      anchorRef={anchorRef}
      onClose={onClose}
      className="w-56"
    >
      <div className="px-3 py-1.5 text-2xs font-semibold uppercase tracking-wider text-text-muted">
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
                ? "text-accent"
                : "text-text-secondary hover:text-text-primary",
            )}
          >
            <div
              className={cn(
                "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
                active
                  ? "border-accent bg-accent"
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

      <div className="my-1 border-t border-glass-border" />

      <div className="px-3 py-1.5 text-2xs font-semibold uppercase tracking-wider text-text-muted">
        Custom Tags
      </div>

      {customTags.length > 0 && (
        <div className="flex flex-wrap gap-1 px-3 pb-2">
          {customTags.map((label) => (
            <span
              key={label}
              className="inline-flex items-center gap-1 rounded-full border border-glass-border bg-glass-bg px-2 py-0.5 text-xs text-text-secondary"
            >
              {label}
              <button
                onClick={() => removeCustomTag(item, label)}
                className="rounded-full p-0.5 text-text-muted transition-colors hover:bg-danger/10 hover:text-danger cursor-pointer"
                aria-label={`Remove tag ${label}`}
              >
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center gap-1 px-3 pb-2">
        <input
          value={draft}
          onChange={(e) =>
            setDraft(e.target.value.slice(0, CUSTOM_TAG_MAX_LENGTH))
          }
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleAddCustom();
            }
          }}
          placeholder="Add tag…"
          className="w-full rounded-md border border-glass-border bg-bg-primary/50 px-2 py-1 text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-accent/50"
          maxLength={CUSTOM_TAG_MAX_LENGTH}
        />
        <button
          onClick={handleAddCustom}
          disabled={!draft.trim()}
          className="shrink-0 rounded-md bg-accent/15 p-1 text-accent transition-colors hover:bg-accent/25 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          aria-label="Add custom tag"
        >
          <Plus size={12} />
        </button>
      </div>
    </FloatingMenu>
  );
}
