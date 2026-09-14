import { useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { FloatingMenu } from "./FloatingMenu";
import { fieldClass, fieldSmClass } from "./classes";
import { cn } from "@/lib/cn";

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  icon?: LucideIcon;
  description?: string;
}

interface SelectProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: SelectOption<T>[];
  placeholder?: string;
  disabled?: boolean;
  size?: "sm" | "md";
  ariaLabel?: string;
  className?: string;
  /** Show a filter box at the top of the listbox. Handy for long option
   *  lists (languages, timezones). Off by default. */
  searchable?: boolean;
  /** Placeholder for the filter box; only used when `searchable`. */
  searchPlaceholder?: string;
  /** Shown in the list when the filter matches nothing. */
  noResultsLabel?: string;
}

/**
 * `.field`-styled trigger + a `FloatingMenu` listbox. The app-wide
 * replacement for native `<select>`, never use the browser's own
 * dropdown: it doesn't take the app's dark theme and its positioning
 * and keyboard behaviour vary by platform.
 *
 * Focus model follows the ARIA listbox pattern: the trigger opens the
 * menu and focus moves onto the listbox itself (or the filter box when
 * `searchable`); arrow keys move the active option (tracked via
 * `aria-activedescendant`, not real DOM focus per row), Enter/Space
 * selects it, Escape closes and returns focus to the trigger.
 */
export function Select<T extends string>({
  value,
  onChange,
  options,
  placeholder,
  disabled = false,
  size = "md",
  ariaLabel,
  className,
  searchable = false,
  searchPlaceholder,
  noResultsLabel,
}: SelectProps<T>) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [triggerWidth, setTriggerWidth] = useState<number | undefined>();
  const [query, setQuery] = useState("");
  const baseId = useId();

  const selected = options.find((o) => o.value === value) ?? null;
  const SelectedIcon = selected?.icon;

  // The rows the listbox actually shows (filtered when searching).
  const visible = useMemo(() => {
    if (!searchable || !query.trim()) return options;
    const q = query.trim().toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [searchable, query, options]);

  const openMenu = () => {
    if (disabled || options.length === 0) return;
    setQuery("");
    const selIdx = options.findIndex((o) => o.value === value);
    setActiveIndex(selIdx >= 0 ? selIdx : 0);
    setTriggerWidth(triggerRef.current?.offsetWidth);
    setOpen(true);
    // Focus the filter box when searchable, otherwise the listbox itself,
    // once FloatingMenu has positioned the popover.
    requestAnimationFrame(() =>
      (searchable ? searchRef.current : listRef.current)?.focus(),
    );
  };

  const close = (returnFocus: boolean) => {
    setOpen(false);
    setQuery("");
    if (returnFocus) triggerRef.current?.focus();
  };

  const choose = (index: number) => {
    const option = visible[index];
    if (!option) return;
    onChange(option.value);
    close(true);
  };

  const onTriggerKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled || open) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      openMenu();
    }
  };

  // Shared arrow/enter/escape handling for both the listbox (non-searchable)
  // and the filter input (searchable). Indices are into `visible`.
  const onNavKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (visible.length > 0)
          setActiveIndex((i) => (i + 1) % visible.length);
        break;
      case "ArrowUp":
        e.preventDefault();
        if (visible.length > 0)
          setActiveIndex((i) => (i - 1 + visible.length) % visible.length);
        break;
      case "Home":
        e.preventDefault();
        setActiveIndex(0);
        break;
      case "End":
        e.preventDefault();
        setActiveIndex(visible.length - 1);
        break;
      case "Enter":
        e.preventDefault();
        choose(activeIndex);
        break;
      case " ":
        // Space types into the filter box; only select on Space when not
        // searchable (matches the ARIA listbox pattern).
        if (!searchable) {
          e.preventDefault();
          choose(activeIndex);
        }
        break;
      case "Escape":
        e.preventDefault();
        close(true);
        break;
      case "Tab":
        close(false);
        break;
      default:
        break;
    }
  };

  const iconSize = size === "sm" ? 13 : 14;
  const activeId = visible[activeIndex]
    ? `${baseId}-opt-${activeIndex}`
    : undefined;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => (open ? close(false) : openMenu())}
        onKeyDown={onTriggerKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        className={cn(
          size === "sm" ? fieldSmClass : fieldClass,
          "flex items-center justify-between gap-2 text-left cursor-pointer disabled:cursor-not-allowed",
          className,
        )}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          {SelectedIcon && (
            <SelectedIcon
              size={iconSize}
              strokeWidth={1.5}
              className="shrink-0 text-text-muted"
            />
          )}
          <span className={cn("truncate", !selected && "text-text-muted-2")}>
            {selected?.label ?? placeholder ?? ""}
          </span>
        </span>
        <ChevronDown
          size={size === "sm" ? 14 : 16}
          strokeWidth={1.5}
          className={cn(
            "shrink-0 text-text-muted transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      <FloatingMenu open={open} anchorRef={triggerRef} onClose={() => close(false)}>
        <div style={{ minWidth: triggerWidth }}>
          {searchable && (
            <div className="flex items-center gap-1.5 border-b border-glass-border px-2.5 py-1.5">
              <Search size={13} strokeWidth={1.5} className="shrink-0 text-text-muted" />
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActiveIndex(0);
                }}
                onKeyDown={onNavKeyDown}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder ?? ariaLabel}
                aria-controls={`${baseId}-list`}
                aria-activedescendant={activeId}
                className="min-w-0 flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted-2 outline-none"
              />
            </div>
          )}
          <div
            ref={listRef}
            id={`${baseId}-list`}
            role="listbox"
            tabIndex={searchable ? undefined : -1}
            aria-label={ariaLabel}
            aria-activedescendant={activeId}
            onKeyDown={searchable ? undefined : onNavKeyDown}
            className="max-h-64 overflow-y-auto outline-none"
          >
            {visible.length === 0 ? (
              <div className="px-3 py-2 text-sm text-text-muted-2">
                {noResultsLabel ?? "—"}
              </div>
            ) : (
              visible.map((option, i) => {
                const Icon = option.icon;
                const isSelected = option.value === value;
                const isActive = i === activeIndex;
                return (
                  <div
                    key={option.value}
                    id={`${baseId}-opt-${i}`}
                    role="option"
                    aria-selected={isSelected}
                    onMouseEnter={() => setActiveIndex(i)}
                    onClick={() => choose(i)}
                    className={cn(
                      "flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm transition-colors",
                      isActive
                        ? "bg-surface-3 text-text-primary"
                        : "text-text-secondary hover:bg-surface-3 hover:text-text-primary",
                    )}
                  >
                    {Icon && (
                      <Icon
                        size={14}
                        strokeWidth={1.5}
                        className="shrink-0 text-text-muted"
                      />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{option.label}</span>
                      {option.description && (
                        <span className="block truncate text-2xs text-text-muted">
                          {option.description}
                        </span>
                      )}
                    </span>
                    {isSelected && (
                      <Check size={14} strokeWidth={1.5} className="shrink-0" />
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </FloatingMenu>
    </>
  );
}
