import { Tag } from "lucide-react";
import { useSettingsStore } from "@/stores/settings-store";
import {
  ALL_STATUS_TAGS,
  TAG_LABELS,
  COLOR_KEYS,
  COLOR_PALETTE,
  DEFAULT_TAG_COLORS,
} from "@/components/ui/TagBadge";
import { cn } from "@/lib/cn";

export function TagsTab() {
  const tagColors = useSettingsStore((s) => s.tagColors);
  const setTagColor = useSettingsStore((s) => s.setTagColor);

  return (
    <section className="space-y-4 rounded-xl border border-glass-border bg-glass-bg/50 p-4 sm:p-6">
      <div className="flex items-center gap-2">
        <Tag size={18} className="text-text-secondary" />
        <h2 className="text-lg font-semibold text-text-primary">Tags</h2>
      </div>
      <p className="text-xs text-text-muted">
        Customize the color for each reading status tag.
      </p>

      <div className="space-y-4">
        {ALL_STATUS_TAGS.map((tag) => {
          const activeColor = tagColors[tag] ?? DEFAULT_TAG_COLORS[tag];
          const colors = COLOR_PALETTE[activeColor];
          return (
            <div key={tag} className="flex items-center gap-3">
              {/* Tag label with current color */}
              <span
                className={cn(
                  "inline-flex w-28 shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-medium",
                  colors.bg,
                  colors.text,
                )}
              >
                {TAG_LABELS[tag]}
              </span>

              {/* Color swatches */}
              <div className="flex flex-wrap gap-1.5">
                {COLOR_KEYS.map((colorKey) => {
                  const isActive = activeColor === colorKey;
                  return (
                    <button
                      key={colorKey}
                      onClick={() => setTagColor(tag, colorKey)}
                      className={cn(
                        "h-5 w-5 rounded-full transition-all cursor-pointer",
                        COLOR_PALETTE[colorKey].dot,
                        isActive
                          ? "ring-2 ring-offset-2 ring-offset-bg-secondary ring-text-primary scale-110"
                          : "hover:scale-110 opacity-60 hover:opacity-100",
                      )}
                      title={colorKey}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
