import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useSettingsStore } from "@/stores/settings-store";
import { useTagStore, CUSTOM_TAG_MAX_LENGTH } from "@/stores/tag-store";
import {
  ALL_STATUS_TAGS,
  TAG_LABELS,
  DEFAULT_TAG_COLORS,
  CustomTagBadge,
  resolveTagStyle,
} from "@/components/ui/TagBadge";
import { DEFAULT_CUSTOM_TAG_COLOR } from "@/lib/tag-colors";
import { ConfirmModal, IconButton, PromptModal, Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { SettingsSection, StatusLine } from "../ui";
import { TagColorPicker } from "../TagColorPicker";

export function TagsTab() {
  const { t } = useTranslation();
  const tagColors = useSettingsStore((s) => s.tagColors);
  const setTagColor = useSettingsStore((s) => s.setTagColor);
  const customTagColors = useSettingsStore((s) => s.customTagColors);
  const setCustomTagColor = useSettingsStore((s) => s.setCustomTagColor);
  const customTagLibrary = useSettingsStore((s) => s.customTagLibrary);
  const setCustomTagLibrary = useSettingsStore((s) => s.setCustomTagLibrary);

  const customTagsByBook = useTagStore((s) => s.customTagsByBook);
  const renameEverywhere = useTagStore((s) => s.renameCustomTagEverywhere);
  const deleteEverywhere = useTagStore((s) => s.deleteCustomTagEverywhere);

  const [draft, setDraft] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // label -> number of books carrying it (0 = only in the library list)
  const customLabels = useMemo(() => {
    const counts = new Map<string, number>();
    for (const l of customTagLibrary) counts.set(l, 0);
    for (const list of customTagsByBook.values()) {
      for (const l of list) counts.set(l, (counts.get(l) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort(([a], [b]) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );
  }, [customTagLibrary, customTagsByBook]);

  const labelExists = (label: string, except?: string) =>
    customLabels.some(
      ([l]) => l !== except && l.toLowerCase() === label.toLowerCase(),
    );

  const handleCreate = () => {
    const label = draft.trim();
    if (!label || labelExists(label)) return;
    setCustomTagLibrary([...customTagLibrary, label]);
    setDraft("");
  };

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="space-y-8">
      <SettingsSection description={t("settings.tagsSection.description")}>
        {ALL_STATUS_TAGS.map((tag) => {
          const activeColor = tagColors[tag] ?? DEFAULT_TAG_COLORS[tag];
          const style = resolveTagStyle(activeColor);
          return (
            <div
              key={tag}
              className="flex flex-col gap-3 py-3 sm:flex-row sm:items-start"
            >
              <span
                style={style.style}
                className={cn(
                  "inline-flex w-28 shrink-0 items-center self-start rounded-chip px-2.5 py-1 text-xs font-medium",
                  style.className,
                )}
              >
                {TAG_LABELS[tag]}
              </span>
              <TagColorPicker
                value={activeColor}
                onChange={(color) => setTagColor(tag, color)}
              />
            </div>
          );
        })}
      </SettingsSection>

      <SettingsSection
        title={t("settings.tagsSection.customHeading")}
        description={t("settings.tagsSection.customDescription")}
      >
        <div className="flex items-center gap-2 py-3">
          <input
            value={draft}
            onChange={(e) =>
              setDraft(e.target.value.slice(0, CUSTOM_TAG_MAX_LENGTH))
            }
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleCreate();
              }
            }}
            maxLength={CUSTOM_TAG_MAX_LENGTH}
            placeholder={t("settings.tagsSection.newPlaceholder")}
            aria-label={t("settings.tagsSection.newPlaceholder")}
            className="field max-w-xs py-1.5 text-[13px]"
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={handleCreate}
            disabled={!draft.trim() || labelExists(draft.trim())}
          >
            <Plus size={14} />
            {t("settings.tagsSection.create")}
          </Button>
        </div>

        {customLabels.length === 0 ? (
          <p className="pb-3 text-[13px] text-text-muted">
            {t("settings.tagsSection.customEmpty")}
          </p>
        ) : (
          customLabels.map(([label, count]) => (
            <div
              key={label}
              className="flex flex-col gap-3 py-3 sm:flex-row sm:items-start"
            >
              <div className="flex w-full shrink-0 items-center gap-1 sm:w-48">
                <CustomTagBadge
                  label={label}
                  size="md"
                  className="min-w-0 max-w-full truncate"
                  title={label}
                />
                <span className="ml-auto text-2xs text-text-muted-2 sm:ml-0">
                  {t("settings.tagsSection.bookCount", { count })}
                </span>
              </div>
              <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
                <TagColorPicker
                  value={customTagColors[label] ?? DEFAULT_CUSTOM_TAG_COLOR}
                  onChange={(color) => setCustomTagColor(label, color)}
                />
                <div className="flex shrink-0 items-center gap-1">
                  <IconButton
                    size="sm"
                    onClick={() => setRenaming(label)}
                    aria-label={t("settings.tagsSection.rename")}
                    title={t("settings.tagsSection.rename")}
                  >
                    <Pencil size={14} />
                  </IconButton>
                  <IconButton
                    size="sm"
                    variant="danger"
                    onClick={() => setDeleting(label)}
                    aria-label={t("settings.tagsSection.delete")}
                    title={t("settings.tagsSection.delete")}
                  >
                    <Trash2 size={14} />
                  </IconButton>
                </div>
              </div>
            </div>
          ))
        )}
        {error && (
          <div className="pb-3">
            <StatusLine tone="danger">{error}</StatusLine>
          </div>
        )}
      </SettingsSection>

      <PromptModal
        open={renaming !== null}
        title={t("settings.tagsSection.renameTitle")}
        defaultValue={renaming ?? ""}
        confirmLabel={t("settings.tagsSection.rename")}
        validate={(value) => {
          const v = value.trim();
          if (!v) return t("settings.tagsSection.errEmpty");
          if (v.length > CUSTOM_TAG_MAX_LENGTH) return t("settings.tagsSection.errLong");
          if (labelExists(v, renaming ?? undefined)) return t("settings.tagsSection.errExists");
          return null;
        }}
        onClose={() => setRenaming(null)}
        onSubmit={(value) => {
          const from = renaming;
          setRenaming(null);
          if (from) void run(() => renameEverywhere(from, value.trim()));
        }}
      />
      <ConfirmModal
        open={deleting !== null}
        title={t("settings.tagsSection.deleteTitle")}
        body={t("settings.tagsSection.deleteBody", { label: deleting ?? "" })}
        confirmLabel={t("settings.tagsSection.delete")}
        danger
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          const label = deleting;
          setDeleting(null);
          if (label) void run(() => deleteEverywhere(label));
        }}
      />
    </div>
  );
}
