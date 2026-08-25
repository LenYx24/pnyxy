import { useMemo, useState, type RefObject } from "react";
import { Check, Plus, X } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  ALL_STATUS_TAGS,
  CustomTagBadge,
  getTagLabel,
  getTagColor,
  getCustomTagColor,
} from "@/components/ui/TagBadge";
import { FloatingMenu } from "@/components/ui";
import { useTagStore, bookKey, CUSTOM_TAG_MAX_LENGTH } from "@/stores/tag-store";
import { useSettingsStore } from "@/stores/settings-store";
import type { UnifiedLibraryItem } from "@/types/catalog";

const EMPTY_LABELS: string[] = [];

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
  const customTags =
    useTagStore((s) => s.customTagsByBook.get(tagKey)) ?? EMPTY_LABELS;
  const addTag = useTagStore((s) => s.addTag);
  const removeTag = useTagStore((s) => s.removeTag);
  const addCustomTag = useTagStore((s) => s.addCustomTag);
  const removeCustomTag = useTagStore((s) => s.removeCustomTag);
  // Subscribe so chips repaint when a color changes in Settings > Tags
  useSettingsStore((s) => s.customTagColors);
  const customTagsByBook = useTagStore((s) => s.customTagsByBook);
  const customTagLibrary = useSettingsStore((s) => s.customTagLibrary);
  // Known labels not yet on this book: one-click suggestions.
  const suggestions = useMemo(() => {
    const all = new Set<string>(customTagLibrary);
    for (const list of customTagsByBook.values()) for (const l of list) all.add(l);
    const mine = new Set(customTags.map((l) => l.toLowerCase()));
    return Array.from(all)
      .filter((l) => !mine.has(l.toLowerCase()))
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
      .slice(0, 12);
  }, [customTagLibrary, customTagsByBook, customTags]);

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
      <div className="px-3 py-1.5 text-2xs font-semibold uppercase tracking-wider text-text-muted-2">
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
              "flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-surface-3 cursor-pointer",
              active
                ? "text-text-primary"
                : "text-text-secondary hover:text-text-primary",
            )}
          >
            <div
              className={cn(
                "flex h-4 w-4 shrink-0 items-center justify-center rounded transition-colors",
                active ? "bg-text-primary" : "bg-surface-3",
              )}
            >
              {active && <Check size={10} className="text-bg-primary" />}
            </div>
            {/* Colored dot */}
            <span
              className={cn("h-2 w-2 shrink-0 rounded-full", colors.dotClassName)}
              style={colors.dotStyle}
            />
            {getTagLabel(tag)}
          </button>
        );
      })}

      <div className="my-1 h-px bg-surface-3" />

      <div className="px-3 py-1.5 text-2xs font-semibold uppercase tracking-wider text-text-muted-2">
        Custom Tags
      </div>

      {customTags.length > 0 && (
        <div className="flex flex-wrap gap-1 px-3 pb-2">
          {customTags.map((label) => (
            <CustomTagBadge key={label} label={label} className="gap-1">
              <button
                onClick={() => removeCustomTag(item, label)}
                className="rounded-full p-0.5 opacity-70 transition-opacity hover:opacity-100 cursor-pointer"
                aria-label={`Remove tag ${label}`}
              >
                <X size={10} />
              </button>
            </CustomTagBadge>
          ))}
        </div>
      )}

      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1 px-3 pb-2">
          {suggestions.map((label) => {
            const style = getCustomTagColor(label);
            return (
              <button
                key={label}
                type="button"
                onClick={() => addCustomTag(item, label)}
                className="chip gap-1 px-2 py-0.5 cursor-pointer transition-colors hover:text-text-primary"
                title={`Add tag ${label}`}
              >
                <span
                  className={cn("h-1.5 w-1.5 rounded-full", style.dotClassName)}
                  style={style.dotStyle}
                />
                {label}
              </button>
            );
          })}
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
          className="field px-2 py-1 text-xs"
          maxLength={CUSTOM_TAG_MAX_LENGTH}
        />
        <button
          onClick={handleAddCustom}
          disabled={!draft.trim()}
          className="shrink-0 rounded-control bg-surface-3 p-1 text-text-secondary transition-colors hover:text-text-primary disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          aria-label="Add custom tag"
        >
          <Plus size={12} />
        </button>
      </div>
    </FloatingMenu>
  );
}
