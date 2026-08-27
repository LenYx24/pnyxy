import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown, Plus, Search, Star } from "lucide-react";
import { FloatingMenu, fieldSmClass } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { AiContextPreset } from "./types";

interface PresetComboboxProps {
  presets: readonly AiContextPreset[];
  selectedId: string | null;
  defaultId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  className?: string;
}

const rowClass =
  "flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary";

/** `.field` trigger + searchable FloatingMenu list with keyboard navigation. */
export function PresetCombobox({
  presets,
  selectedId,
  defaultId,
  onSelect,
  onCreate,
  className,
}: PresetComboboxProps) {
  const { t } = useTranslation();
  const anchorRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [rawCursor, setCursor] = useState(0);

  const selected = presets.find((p) => p.id === selectedId) ?? null;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return presets;
    return presets.filter((p) => p.name.toLowerCase().includes(q));
  }, [presets, query]);
  // rows = filtered presets, then the "new" row
  const rowCount = filtered.length + 1;
  // clamp instead of syncing in an effect: the list shrinks while typing
  const cursor = Math.min(rawCursor, rowCount - 1);

  const openMenu = () => {
    setQuery("");
    const idx = presets.findIndex((p) => p.id === selectedId);
    setCursor(idx >= 0 ? idx : 0);
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  const choose = (index: number) => {
    if (index < filtered.length) onSelect(filtered[index].id);
    else onCreate();
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => (c + 1) % rowCount);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => (c - 1 + rowCount) % rowCount);
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(cursor);
    }
  };

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openMenu())}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          "field flex cursor-pointer items-center justify-between gap-2 text-left",
          className,
        )}
      >
        <span className={cn("truncate", !selected && "text-text-muted-2")}>
          {selected?.name ?? t("settings.aiContext.presets.pick")}
        </span>
        <ChevronDown size={16} className="shrink-0 text-text-muted" />
      </button>
      <FloatingMenu
        open={open}
        anchorRef={anchorRef}
        onClose={() => setOpen(false)}
        className="w-72 py-0"
      >
        <div className="p-2">
          <div
            className={cn(
              fieldSmClass,
              "flex items-center gap-2 bg-bg-secondary",
            )}
          >
            <Search size={14} className="shrink-0 text-text-muted" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setCursor(0);
              }}
              onKeyDown={onKeyDown}
              placeholder={t("settings.aiContext.presets.search")}
              className="min-w-0 flex-1 bg-transparent text-xs text-text-primary outline-none placeholder:text-text-muted-2"
            />
          </div>
        </div>
        <ul role="listbox" className="max-h-64 overflow-y-auto pb-1">
          {filtered.length === 0 && (
            <li className="px-3 py-2 text-xs text-text-muted">
              {t("settings.aiContext.presets.noMatch")}
            </li>
          )}
          {filtered.map((p, i) => (
            <li key={p.id} role="option" aria-selected={p.id === selectedId}>
              <button
                type="button"
                onMouseEnter={() => setCursor(i)}
                onClick={() => choose(i)}
                className={cn(
                  rowClass,
                  cursor === i && "bg-glass-hover text-text-primary",
                )}
              >
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                {p.id === defaultId && (
                  <Star
                    size={12}
                    className="shrink-0 text-text-muted"
                    aria-label="default"
                  />
                )}
                {p.id === selectedId && (
                  <Check size={14} className="shrink-0" />
                )}
              </button>
            </li>
          ))}
          <li className="mt-1 border-t border-surface-3/60 pt-1">
            <button
              type="button"
              onMouseEnter={() => setCursor(filtered.length)}
              onClick={() => choose(filtered.length)}
              className={cn(
                rowClass,
                cursor === filtered.length &&
                  "bg-glass-hover text-text-primary",
              )}
            >
              <Plus size={14} />
              {t("settings.aiContext.presets.new")}
            </button>
          </li>
        </ul>
      </FloatingMenu>
    </>
  );
}
