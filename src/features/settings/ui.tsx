import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { Slider, chipActiveClass, chipClass } from "@/components/ui";

/**
 * Pnyxy Neutral building blocks for the settings and profile pages.
 * A section is a caption (11 px caps, muted-2), an optional
 * Space Grotesk title + 13 px muted description, then a
 * `rounded-panel bg-bg-tertiary` block that holds the rows. No lines
 * anywhere: rows are separated by padding, groups by tone.
 */

export function SettingsSection({
  caption,
  title,
  description,
  actions,
  children,
  plain = false,
  className,
}: {
  /** 11 px caps label above the block. */
  caption?: string;
  /** Space Grotesk section title. */
  title?: string;
  description?: ReactNode;
  /** Right-aligned controls next to the title (e.g. a quiet button). */
  actions?: ReactNode;
  children?: ReactNode;
  /** Render children without the surface-2 block (for grids of cards). */
  plain?: boolean;
  className?: string;
}) {
  return (
    <section className={cn("space-y-3", className)}>
      {(caption || title || description) && (
        <div className="space-y-1 px-1">
          {caption && <SectionCaption>{caption}</SectionCaption>}
          {(title || actions) && (
            <div className="flex items-center justify-between gap-3">
              {title && (
                <h2 className="font-display text-[17px] font-semibold leading-tight text-text-primary">
                  {title}
                </h2>
              )}
              {actions}
            </div>
          )}
          {description && (
            <p className="text-[13px] leading-relaxed text-text-muted">
              {description}
            </p>
          )}
        </div>
      )}
      {children !== undefined &&
        children !== null &&
        (plain ? (
          children
        ) : (
          <div className="rounded-panel bg-bg-tertiary px-4 py-2 sm:px-5">
            {children}
          </div>
        ))}
    </section>
  );
}

export function SectionCaption({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "block text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted-2",
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * One setting: label + hint on the left, the control on the right.
 * Stacks vertically when `stacked` (sliders, text areas, chip groups).
 */
export function SettingRow({
  label,
  hint,
  control,
  stacked = false,
  children,
  className,
  htmlFor,
}: {
  label: ReactNode;
  hint?: ReactNode;
  /** Right-aligned control (Toggle, select, button). */
  control?: ReactNode;
  stacked?: boolean;
  /** Full-width content under the label (slider, chips, textarea). */
  children?: ReactNode;
  className?: string;
  htmlFor?: string;
}) {
  const LabelTag = htmlFor ? "label" : "p";
  return (
    <div className={cn("py-3", className)}>
      <div
        className={cn(
          "flex gap-4",
          stacked ? "flex-col" : "items-center justify-between",
        )}
      >
        <div className="min-w-0 flex-1">
          <LabelTag
            htmlFor={htmlFor}
            className="block text-[15px] font-medium leading-snug text-text-primary"
          >
            {label}
          </LabelTag>
          {hint && (
            <p className="mt-0.5 text-[13px] leading-relaxed text-text-muted">
              {hint}
            </p>
          )}
        </div>
        {control && <div className="flex shrink-0 items-center gap-2">{control}</div>}
      </div>
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}

/** Pill chip group for a single-choice option. */
export function OptionChips<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string; title?: string }[];
  onChange: (next: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          title={opt.title}
          aria-pressed={value === opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            value === opt.value ? chipActiveClass : chipClass,
            "cursor-pointer transition-colors hover:text-text-primary",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/** Collapsible "how it works" style block. Quiet, no chrome. */
export function Disclosure({
  title,
  children,
  defaultOpen = false,
  className,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={cn("rounded-panel bg-bg-tertiary", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center justify-between gap-2 px-4 py-3 text-left text-[13px] font-medium text-text-secondary transition-colors hover:text-text-primary sm:px-5"
      >
        <span>{title}</span>
        <ChevronDown
          size={16}
          className={cn("shrink-0 transition-transform", open && "rotate-180")}
        />
      </button>
      {open && <div className="px-4 pb-4 sm:px-5">{children}</div>}
    </div>
  );
}

/** Inline status line (success / warning / danger) under a control. */
export function StatusLine({
  tone,
  children,
}: {
  tone: "success" | "warning" | "danger" | "muted";
  children: ReactNode;
}) {
  const color = {
    success: "text-success",
    warning: "text-warning",
    danger: "text-danger",
    muted: "text-text-muted",
  }[tone];
  return <p className={cn("text-[13px]", color)}>{children}</p>;
}

/**
 * Slider + a small numeric `.field` next to it showing the exact value
 * with its unit. Two-way bound: dragging updates the field, typing a
 * number then Enter / blur commits (clamped to min/max, snapped to
 * step). Every slider in settings goes through this.
 */
export function SliderWithInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
  /** Digits after the decimal point in the field (default derived from step). */
  decimals,
  disabled,
  ariaLabel,
}: {
  value: number;
  onChange: (next: number) => void;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  decimals?: number;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const digits =
    decimals ??
    (Number.isInteger(step) ? 0 : Math.min(3, (String(step).split(".")[1] ?? "").length));
  const format = (n: number) => n.toFixed(digits);
  const [draft, setDraft] = useState(format(value));
  const [editing, setEditing] = useState(false);

  // keep the field in sync with the slider while the user is not typing
  useEffect(() => {
    if (!editing) setDraft(format(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, editing, digits]);

  const commit = () => {
    setEditing(false);
    const parsed = Number.parseFloat(draft.replace(",", "."));
    if (!Number.isFinite(parsed)) {
      setDraft(format(value));
      return;
    }
    const clamped = Math.min(max, Math.max(min, parsed));
    const snapped = Math.round((clamped - min) / step) * step + min;
    const next = Number(snapped.toFixed(digits));
    setDraft(format(next));
    if (next !== value) onChange(next);
  };

  return (
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <Slider
          value={value}
          onChange={onChange}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
        />
      </div>
      <label className="field flex w-[5.5rem] shrink-0 items-center gap-1 px-2 py-1 text-[13px]">
        <input
          type="text"
          inputMode="decimal"
          aria-label={ariaLabel}
          value={draft}
          disabled={disabled}
          onFocus={() => setEditing(true)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
              e.currentTarget.blur();
            } else if (e.key === "Escape") {
              setDraft(format(value));
              setEditing(false);
              e.currentTarget.blur();
            }
          }}
          className="w-full min-w-0 bg-transparent text-right font-mono text-[13px] text-text-primary outline-none disabled:opacity-50"
        />
        {unit && <span className="shrink-0 text-2xs text-text-muted">{unit}</span>}
      </label>
    </div>
  );
}
