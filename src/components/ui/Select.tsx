import { useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Check, ChevronDown } from "lucide-react";
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
}

/**
 * `.field`-styled trigger + a `FloatingMenu` listbox. The app-wide
 * replacement for native `<select>`, never use the browser's own
 * dropdown: it doesn't take the app's dark theme and its positioning
 * and keyboard behaviour vary by platform.
 *
 * Focus model follows the ARIA listbox pattern: the trigger opens the
 * menu and focus moves onto the listbox itself; arrow keys move the
 * active option (tracked via `aria-activedescendant`, not real DOM
 * focus per row), Enter/Space selects it, Escape closes and returns
 * focus to the trigger.
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
}: SelectProps<T>) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [triggerWidth, setTriggerWidth] = useState<number | undefined>();
  const baseId = useId();

  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null;
  const SelectedIcon = selected?.icon;

  const openMenu = () => {
    if (disabled || options.length === 0) return;
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    setTriggerWidth(triggerRef.current?.offsetWidth);
    setOpen(true);
    // the listbox itself takes focus once FloatingMenu has positioned it
    requestAnimationFrame(() => listRef.current?.focus());
  };

  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  };

  const choose = (index: number) => {
    const option = options[index];
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

  const onListKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (options.length === 0) return;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % options.length);
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + options.length) % options.length);
        break;
      case "Home":
        e.preventDefault();
        setActiveIndex(0);
        break;
      case "End":
        e.preventDefault();
        setActiveIndex(options.length - 1);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        choose(activeIndex);
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
        <div
          ref={listRef}
          role="listbox"
          tabIndex={-1}
          aria-label={ariaLabel}
          aria-activedescendant={
            options[activeIndex] ? `${baseId}-opt-${activeIndex}` : undefined
          }
          onKeyDown={onListKeyDown}
          className="outline-none"
          style={{ minWidth: triggerWidth }}
        >
          {options.map((option, i) => {
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
          })}
        </div>
      </FloatingMenu>
    </>
  );
}
