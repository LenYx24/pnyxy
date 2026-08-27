import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Search, X } from "lucide-react";
import {
  Button,
  IconButton,
  fieldSmClass,
  modalBackdropClass,
  modalSurfaceClass,
  segmentedGroupClass,
  segmentedItemActiveClass,
  segmentedItemClass,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import type { BindableEntity } from "./use-entity-names";
import { BINDING_KIND_ICONS } from "./binding-icons";
import { AI_CONTEXT_BINDING_KINDS, type AiContextBindingKind } from "./types";

interface BindingPickerModalProps {
  open: boolean;
  presetName: string;
  entities: Record<AiContextBindingKind, BindableEntity[]>;
  /** Entities already bound to this preset, to show a check. */
  boundIds: Record<AiContextBindingKind, Set<string>>;
  onPick: (kind: AiContextBindingKind, id: string) => void;
  onClose: () => void;
}

/** Type segmented control + search + list. Picking binds and closes. */
export function BindingPickerModal({
  open,
  presetName,
  entities,
  boundIds,
  onPick,
  onClose,
}: BindingPickerModalProps) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<AiContextBindingKind>("books");
  const [query, setQuery] = useState("");

  // clear the search on the way out so the next open starts fresh
  const close = useCallback(() => {
    setQuery("");
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const src = entities[kind];
    return q ? src.filter((e) => e.name.toLowerCase().includes(q)) : src;
  }, [entities, kind, query]);

  const kindLabels: Record<AiContextBindingKind, string> = {
    books: t("settings.aiContext.bindings.kindBook"),
    folders: t("settings.aiContext.bindings.kindFolder"),
    orgs: t("settings.aiContext.bindings.kindOrg"),
  };

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className={cn("absolute inset-0", modalBackdropClass)}
        onClick={close}
      />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          modalSurfaceClass,
          "relative flex w-full max-w-md flex-col p-5",
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-display text-[17px] font-semibold text-text-primary">
              {t("settings.aiContext.bindings.assignTitle")}
            </h3>
            <p className="truncate text-[13px] text-text-muted">{presetName}</p>
          </div>
          <IconButton
            size="sm"
            variant="ghost"
            onClick={close}
            aria-label={t("common.close")}
          >
            <X size={16} />
          </IconButton>
        </div>

        <div
          className={cn(segmentedGroupClass, "mt-4 self-start bg-bg-secondary")}
        >
          {AI_CONTEXT_BINDING_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={cn(
                segmentedItemClass,
                kind === k && segmentedItemActiveClass,
              )}
            >
              {kindLabels[k]}
            </button>
          ))}
        </div>

        <div
          className={cn(
            fieldSmClass,
            "mt-3 flex items-center gap-2 bg-bg-secondary",
          )}
        >
          <Search size={14} className="shrink-0 text-text-muted" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("settings.aiContext.bindings.search")}
            className="min-w-0 flex-1 bg-transparent text-xs text-text-primary outline-none placeholder:text-text-muted-2"
          />
        </div>

        <ul className="mt-2 max-h-72 space-y-0.5 overflow-y-auto">
          {list.length === 0 && (
            <li className="px-3 py-4 text-center text-xs text-text-muted">
              {t("settings.aiContext.bindings.empty")}
            </li>
          )}
          {list.map((e) => {
            const Icon = BINDING_KIND_ICONS[e.kind];
            const bound = boundIds[e.kind].has(e.id);
            return (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => {
                    onPick(e.kind, e.id);
                    close();
                  }}
                  className="flex w-full cursor-pointer items-center gap-2.5 rounded-control px-3 py-2 text-left transition-colors hover:bg-glass-hover"
                >
                  <Icon size={15} className="shrink-0 text-text-muted" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-text-primary">
                      {e.name}
                    </span>
                    {e.detail && (
                      <span className="block truncate text-2xs text-text-muted">
                        {e.detail}
                      </span>
                    )}
                  </span>
                  {bound && (
                    <span className="chip chip-active px-2 py-0.5 text-2xs">
                      {t("settings.aiContext.bindings.bound")}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>

        <div className="mt-4 flex justify-end">
          <Button variant="secondary" size="sm" onClick={close}>
            {t("common.cancel")}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
