import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  SHORTCUT_CATALOG,
  SHORTCUT_GROUP_ORDER,
  formatShortcut,
  isMac,
} from "@/lib/keyboard-shortcuts";
import { IconButton } from "./IconButton";
import { useShortcutsSheet } from "./shortcuts-sheet-store";
import { Kbd } from "./Kbd";
import { fieldSmClass, modalBackdropClass, modalSurfaceClass } from "./classes";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keyboard shortcuts cheat sheet: every catalog binding grouped by
 * surface (Global / Library / Chat / Reader), a search field that filters
 * by label or by the keys themselves. Esc closes, Tab is trapped inside.
 * Mounted once in AppLayout; opened by Ctrl+/ or "?".
 */
export function ShortcutsSheet() {
  const { t } = useTranslation();
  const open = useShortcutsSheet((s) => s.open);
  const setOpen = useShortcutsSheet((s) => s.setOpen);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = () => {
    setQuery("");
    setOpen(false);
  };

  // Esc closes; Tab cycles inside the sheet (focus trap like the other modals).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setQuery("");
        setOpen(false);
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const nodes = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
      );
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;
      if (
        e.shiftKey &&
        (active === first || !panelRef.current.contains(active))
      ) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    // focus the search on open, restore the trigger on close
    const previous = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [open, setOpen]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return SHORTCUT_GROUP_ORDER.map((group) => {
      const items = SHORTCUT_CATALOG.filter((s) => s.group === group)
        .map((s) => ({ ...s, label: t(`shortcuts.items.${s.labelKey}`) }))
        .filter((s) => {
          if (!q) return true;
          const keys = formatShortcut(s).toLowerCase();
          return s.label.toLowerCase().includes(q) || keys.includes(q);
        });
      return { group, items };
    }).filter((g) => g.items.length > 0);
  }, [query, t]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <div
        className={cn("absolute inset-0", modalBackdropClass)}
        onClick={close}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-sheet-title"
        className={cn(
          modalSurfaceClass,
          "relative flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden",
        )}
      >
        <div className="flex items-start justify-between gap-3 px-5 pt-5">
          <div className="min-w-0">
            <h2
              id="shortcuts-sheet-title"
              className="font-display text-[17px] font-semibold leading-tight text-text-primary"
            >
              {t("shortcuts.sheet.title")}
            </h2>
            <p className="mt-0.5 text-[13px] text-text-muted">
              {isMac() ? t("shortcuts.modifierMac") : t("shortcuts.modifierPc")}
            </p>
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
          className={cn(
            fieldSmClass,
            "mx-5 mt-3 flex items-center gap-2 bg-bg-secondary",
          )}
        >
          <Search size={14} className="shrink-0 text-text-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("shortcuts.sheet.search")}
            aria-label={t("shortcuts.sheet.search")}
            className="min-w-0 flex-1 bg-transparent text-xs text-text-primary outline-none placeholder:text-text-muted-2"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-2">
          {groups.length === 0 ? (
            <p className="py-8 text-center text-[13px] text-text-muted">
              {t("shortcuts.sheet.empty")}
            </p>
          ) : (
            <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
              {groups.map(({ group, items }) => (
                <section key={group} className="min-w-0">
                  <h3 className="mb-1 text-2xs font-semibold uppercase tracking-wider text-text-muted-2">
                    {t(`shortcuts.groups.${group}`)}
                  </h3>
                  <ul>
                    {items.map((s) => (
                      <li
                        key={s.id}
                        className="flex items-center justify-between gap-4 py-1.5"
                      >
                        <span className="min-w-0 truncate text-[13px] text-text-primary">
                          {s.label}
                        </span>
                        <Kbd
                          shortcut={s}
                          variant="chips"
                          className="shrink-0"
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>

        <p className="bg-bg-secondary px-5 py-2 text-2xs text-text-muted">
          {t("shortcuts.sheet.hint")}
        </p>
      </div>
    </div>,
    document.body,
  );
}
