import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Copy, Link2, Pencil, Star, Trash2, X } from "lucide-react";
import {
  Button,
  ConfirmModal,
  IconButton,
  chipAccentClass,
  chipClass,
} from "@/components/ui";
import { MarkdownEditor } from "@/components/editor/MarkdownEditor";
import { useSettingsStore } from "@/stores/settings-store";
import { cn } from "@/lib/cn";
import { PresetCombobox } from "./PresetCombobox";
import { BindingPickerModal } from "./BindingPickerModal";
import { BINDING_KIND_ICONS } from "./binding-icons";
import { useBindableEntities } from "./use-entity-names";
import {
  AI_CONTEXT_BINDING_KINDS,
  AI_CONTEXT_BODY_MAX_CHARS,
  type AiContextBindingKind,
} from "./types";

/**
 * "Context for the AI" section body: preset picker + default toggle +
 * rename / duplicate / delete, the markdown editor bound to the selected
 * preset, and the list of places (book / folder / org) it applies to.
 */
export function AiContextPresetsPanel() {
  const { t } = useTranslation();
  const presets = useSettingsStore((s) => s.aiContexts);
  const defaultId = useSettingsStore((s) => s.aiDefaultContextId);
  const bindings = useSettingsStore((s) => s.aiContextBindings);
  const createAiContext = useSettingsStore((s) => s.createAiContext);
  const updateAiContext = useSettingsStore((s) => s.updateAiContext);
  const duplicateAiContext = useSettingsStore((s) => s.duplicateAiContext);
  const deleteAiContext = useSettingsStore((s) => s.deleteAiContext);
  const setAiDefaultContextId = useSettingsStore(
    (s) => s.setAiDefaultContextId,
  );
  const bindAiContext = useSettingsStore((s) => s.bindAiContext);

  const [pickedId, setSelectedId] = useState<string | null>(
    () => defaultId ?? presets[0]?.id ?? null,
  );
  // derive a valid selection when the picked preset disappears (delete, remote hydrate)
  const selected =
    presets.find((p) => p.id === pickedId) ??
    presets.find((p) => p.id === defaultId) ??
    presets[0] ??
    null;
  const selectedId = selected?.id ?? null;

  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState("");
  const renameRef = useRef<HTMLInputElement>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  // the editor reports the count on mount (it is keyed by preset id) and on every edit
  const [chars, setChars] = useState(selected?.body.length ?? 0);

  // Autosave status: "saving" while the editor debounce is pending, "saved"
  // for a second after the store took the change, then nothing.
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">(
    "idle",
  );
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markSaved = () => {
    setSaveState("saved");
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaveState("idle"), 1000);
  };
  useEffect(
    () => () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    },
    [],
  );

  // No presets yet: the editor is shown anyway, bound to a draft preset that
  // becomes real (created + set as default) on the first non-empty change.
  // The editor stays mounted across that promotion (same key) so the caret
  // and focus survive the transition.
  const [promotedId, setPromotedId] = useState<string | null>(null);
  const draftPresetName = t("settings.aiContext.presets.defaultName", {
    defaultValue: "Default",
  });
  const editorKey =
    selectedId && promotedId === selectedId ? "draft" : (selectedId ?? "draft");
  const handleEditorChange = (md: string) => {
    if (selected) {
      updateAiContext(selected.id, { body: md });
      markSaved();
      return;
    }
    if (!md.trim()) return;
    const id = createAiContext(draftPresetName, md);
    setAiDefaultContextId(id);
    setPromotedId(id);
    setSelectedId(id);
    markSaved();
  };
  const handleLengthChange = (n: number) => {
    setChars(n);
    // the editor reports on mount too; only a real edit (length differs from
    // what the store holds) flips the status to "saving"
    if (n !== (selected?.body.length ?? 0)) setSaveState("saving");
  };

  const { entities, nameOf } = useBindableEntities();

  const newName = (base: string) => {
    const taken = new Set(presets.map((p) => p.name));
    if (!taken.has(base)) return base;
    let n = 2;
    while (taken.has(`${base} ${n}`)) n++;
    return `${base} ${n}`;
  };
  const handleCreate = () => {
    const id = createAiContext(
      newName(
        t("settings.aiContext.presets.untitled", {
          defaultValue: "New context",
        }),
      ),
    );
    setSelectedId(id);
    setDraftName(
      useSettingsStore.getState().aiContexts.find((p) => p.id === id)?.name ??
        "",
    );
    setRenaming(true);
  };
  const startRename = () => {
    if (!selected) return;
    setDraftName(selected.name);
    setRenaming(true);
  };
  useEffect(() => {
    if (renaming) renameRef.current?.select();
  }, [renaming]);
  const commitRename = () => {
    if (selected && draftName.trim())
      updateAiContext(selected.id, { name: draftName.trim() });
    setRenaming(false);
  };
  const handleDuplicate = () => {
    if (!selected) return;
    const id = duplicateAiContext(
      selected.id,
      newName(
        t("settings.aiContext.presets.copyName", {
          defaultValue: "{{name}} (copy)",
          name: selected.name,
        }),
      ),
    );
    if (id) setSelectedId(id);
  };

  const myBindings = useMemo(() => {
    if (!selected) return [] as { kind: AiContextBindingKind; id: string }[];
    return AI_CONTEXT_BINDING_KINDS.flatMap((kind) =>
      Object.entries(bindings[kind])
        .filter(([, pid]) => pid === selected.id)
        .map(([id]) => ({ kind, id })),
    );
  }, [bindings, selected]);
  const boundIds = useMemo(() => {
    const out = {
      books: new Set<string>(),
      folders: new Set<string>(),
      orgs: new Set<string>(),
    };
    for (const b of myBindings) out[b.kind].add(b.id);
    return out;
  }, [myBindings]);

  const isDefault = !!selected && selected.id === defaultId;

  const hasPresets = presets.length > 0;

  return (
    <div className="space-y-4 py-3">
      {/* picker row (only once there is something to pick from) */}
      {hasPresets && (
        <div className="flex flex-wrap items-center gap-2">
          {renaming && selected ? (
            <input
              ref={renameRef}
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") setRenaming(false);
              }}
              onBlur={commitRename}
              aria-label={t("settings.aiContext.presets.rename", {
                defaultValue: "Rename",
              })}
              className={cn("field min-w-0 flex-1 basis-48 bg-bg-secondary")}
            />
          ) : (
            <PresetCombobox
              presets={presets}
              selectedId={selectedId}
              defaultId={defaultId}
              onSelect={setSelectedId}
              onCreate={handleCreate}
              className="min-w-0 flex-1 basis-48 bg-bg-secondary"
            />
          )}
          <button
            type="button"
            onClick={() =>
              selected && setAiDefaultContextId(isDefault ? null : selected.id)
            }
            aria-pressed={isDefault}
            title={t("settings.aiContext.presets.defaultHint", {
              defaultValue:
                "Used wherever no book, folder or organization binding applies.",
            })}
            className={cn(
              isDefault ? chipAccentClass : chipClass,
              "cursor-pointer transition-colors hover:text-text-primary",
            )}
          >
            <Star size={12} className={cn(isDefault && "fill-current")} />
            {t("settings.aiContext.presets.default", {
              defaultValue: "Default",
            })}
          </button>
          <div className="flex items-center gap-0.5">
            <IconButton
              size="sm"
              variant="ghost"
              onClick={startRename}
              aria-label={t("settings.aiContext.presets.rename", {
                defaultValue: "Rename",
              })}
              title={t("settings.aiContext.presets.rename", {
                defaultValue: "Rename",
              })}
            >
              <Pencil size={15} />
            </IconButton>
            <IconButton
              size="sm"
              variant="ghost"
              onClick={handleDuplicate}
              aria-label={t("settings.aiContext.presets.duplicate", {
                defaultValue: "Duplicate",
              })}
              title={t("settings.aiContext.presets.duplicate", {
                defaultValue: "Duplicate",
              })}
            >
              <Copy size={15} />
            </IconButton>
            <IconButton
              size="sm"
              variant="ghost"
              onClick={() => setConfirmDelete(true)}
              aria-label={t("common.delete")}
              title={t("common.delete")}
              className="hover:text-danger"
            >
              <Trash2 size={15} />
            </IconButton>
          </div>
        </div>
      )}

      {/* editor: always live, no extra click needed */}
      <div className="space-y-1.5">
        {!hasPresets && (
          <p className="px-1 text-[13px] text-text-muted">
            {t("settings.aiContext.presets.emptyState", {
              defaultValue:
                "No context yet. Tell the AI who you are and how it should help, it is prepended to every conversation.",
            })}
          </p>
        )}
        <MarkdownEditor
          key={editorKey}
          value={selected?.body ?? ""}
          onChange={handleEditorChange}
          onLengthChange={handleLengthChange}
          placeholder={t("settings.aiContext.customPlaceholder")}
          className="bg-bg-secondary"
        />
        <div className="flex items-start justify-between gap-3 px-1">
          <p className="text-2xs leading-relaxed text-text-muted">
            {t("settings.aiContext.presets.injectHint", {
              defaultValue:
                "Prepended to every AI conversation where this context applies.",
            })}
          </p>
          <span className="flex shrink-0 items-center gap-2 font-mono text-2xs tabular-nums">
            <span
              role="status"
              aria-live="polite"
              className={cn(
                "transition-opacity",
                saveState === "idle" ? "opacity-0" : "opacity-100",
                saveState === "saved" ? "text-success" : "text-text-muted-2",
              )}
            >
              {saveState === "saving"
                ? t("common.saving")
                : t("settings.aiContext.presets.saved", {
                    defaultValue: "Saved",
                  })}
            </span>
            <span
              className={cn(
                chars > AI_CONTEXT_BODY_MAX_CHARS
                  ? "text-warning"
                  : "text-text-muted-2",
              )}
            >
              {chars.toLocaleString()} /{" "}
              {AI_CONTEXT_BODY_MAX_CHARS.toLocaleString()}
            </span>
          </span>
        </div>
      </div>

      {/* where it applies */}
      {selected && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[13px] font-medium text-text-primary">
              {t("settings.aiContext.bindings.heading", {
                defaultValue: "Where it applies",
              })}
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPickerOpen(true)}
            >
              <Link2 size={14} />
              {t("settings.aiContext.bindings.assign", {
                defaultValue: "Assign",
              })}
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {isDefault && (
              <span className={cn(chipClass, "text-text-muted")}>
                <Star size={11} />
                {t("settings.aiContext.bindings.everywhereElse", {
                  defaultValue: "Everywhere else (default)",
                })}
              </span>
            )}
            {myBindings.map((b) => {
              const Icon = BINDING_KIND_ICONS[b.kind];
              const name = nameOf(b.kind, b.id);
              return (
                <span
                  key={`${b.kind}:${b.id}`}
                  className={cn(
                    chipClass,
                    "max-w-full pr-1",
                    !name && "text-text-muted-2",
                  )}
                  title={name ?? b.id}
                >
                  <Icon size={11} className="shrink-0" />
                  <span className="truncate">
                    {name ??
                      t("settings.aiContext.bindings.unknown", {
                        defaultValue: "Unknown item",
                      })}
                  </span>
                  <button
                    type="button"
                    onClick={() => bindAiContext(b.kind, b.id, null)}
                    aria-label={t("common.remove")}
                    className="ml-0.5 cursor-pointer rounded-full p-0.5 text-text-muted transition-colors hover:bg-surface-3 hover:text-text-primary"
                  >
                    <X size={11} />
                  </button>
                </span>
              );
            })}
            {!isDefault && myBindings.length === 0 && (
              <p className="text-2xs text-text-muted">
                {t("settings.aiContext.bindings.none", {
                  defaultValue:
                    "Not applied anywhere yet. Mark it as default or assign it.",
                })}
              </p>
            )}
          </div>
        </div>
      )}

      <BindingPickerModal
        open={pickerOpen}
        presetName={selected?.name ?? ""}
        entities={entities}
        boundIds={boundIds}
        onPick={(kind, id) => selected && bindAiContext(kind, id, selected.id)}
        onClose={() => setPickerOpen(false)}
      />
      <ConfirmModal
        open={confirmDelete}
        danger
        title={t("settings.aiContext.presets.deleteTitle", {
          defaultValue: "Delete this context?",
        })}
        body={t("settings.aiContext.presets.deleteBody", {
          defaultValue:
            '"{{name}}" and its assignments are removed. Conversations that used it fall back to the next matching context.',
          name: selected?.name ?? "",
        })}
        confirmLabel={t("common.delete")}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => {
          if (selected) deleteAiContext(selected.id);
          setPromotedId(null);
          setConfirmDelete(false);
        }}
      />
    </div>
  );
}
