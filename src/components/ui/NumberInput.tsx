import { useId } from "react";
import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/cn";

interface NumberInputProps {
  value: number;
  onChange: (next: number) => void;
  /** Step for the +/- buttons. Defaults to 1. */
  step?: number;
  min?: number;
  max?: number;
  placeholder?: string;
  disabled?: boolean;
  /** Visible label rendered above the field. Optional. */
  label?: string;
  /** Helper text rendered below the field. */
  hint?: string;
  /** Suffix shown inside the field, right-aligned (e.g. "h", "min"). */
  suffix?: string;
  className?: string;
  inputClassName?: string;
  id?: string;
}

/**
 * Styled number input with custom +/- buttons. The native browser spinner
 * is hidden globally (see styles/index.css), so this component is the
 * canonical way to expose stepped numeric input that fits the dark theme.
 */
export function NumberInput({
  value,
  onChange,
  step = 1,
  min,
  max,
  placeholder,
  disabled,
  label,
  hint,
  suffix,
  className,
  inputClassName,
  id,
}: NumberInputProps) {
  const reactId = useId();
  const inputId = id ?? reactId;

  const clamp = (n: number): number => {
    let out = n;
    if (typeof min === "number") out = Math.max(min, out);
    if (typeof max === "number") out = Math.min(max, out);
    return out;
  };

  const handleStep = (delta: number) => {
    if (disabled) return;
    onChange(clamp(value + delta));
  };

  const handleType = (raw: string) => {
    if (raw === "" || raw === "-") {
      // Allow temporary empty/in-progress input — caller can decide
      // whether NaN matters by re-validating on blur.
      onChange(Number.NaN);
      return;
    }
    const parsed = Number.parseFloat(raw);
    if (!Number.isNaN(parsed)) onChange(clamp(parsed));
  };

  const atMin = typeof min === "number" && value <= min;
  const atMax = typeof max === "number" && value >= max;

  return (
    <div className={cn("block", className)}>
      {label && (
        <label
          htmlFor={inputId}
          className="block text-sm text-text-primary"
        >
          {label}
        </label>
      )}
      <div
        className={cn(
          "mt-1 flex items-center overflow-hidden rounded-md border border-glass-border bg-bg-secondary transition-colors focus-within:border-accent-purple",
          disabled && "opacity-50",
          label ? "" : "mt-0",
        )}
      >
        <button
          type="button"
          onClick={() => handleStep(-step)}
          disabled={disabled || atMin}
          aria-label="Decrease"
          className={cn(
            "flex h-full shrink-0 items-center justify-center px-2.5 text-text-secondary transition-colors",
            !disabled &&
              !atMin &&
              "hover:bg-glass-hover hover:text-text-primary cursor-pointer",
            atMin && "cursor-not-allowed opacity-40",
          )}
        >
          <Minus size={14} />
        </button>
        <input
          id={inputId}
          type="number"
          inputMode="decimal"
          value={Number.isNaN(value) ? "" : value}
          onChange={(e) => handleType(e.target.value)}
          onBlur={(e) => {
            // Recover from temporary NaN state by clamping the previous value.
            if (e.target.value === "" || e.target.value === "-") {
              onChange(clamp(Number.isFinite(value) ? value : (min ?? 0)));
            }
          }}
          step={step}
          min={min}
          max={max}
          placeholder={placeholder}
          disabled={disabled}
          className={cn(
            "min-w-0 flex-1 border-0 bg-transparent px-2 py-2 text-center text-sm text-text-primary outline-none [appearance:textfield] [-moz-appearance:textfield]",
            inputClassName,
          )}
        />
        {suffix && (
          <span className="px-2 text-xs text-text-muted">{suffix}</span>
        )}
        <button
          type="button"
          onClick={() => handleStep(step)}
          disabled={disabled || atMax}
          aria-label="Increase"
          className={cn(
            "flex h-full shrink-0 items-center justify-center px-2.5 text-text-secondary transition-colors",
            !disabled &&
              !atMax &&
              "hover:bg-glass-hover hover:text-text-primary cursor-pointer",
            atMax && "cursor-not-allowed opacity-40",
          )}
        >
          <Plus size={14} />
        </button>
      </div>
      {hint && (
        <p className="mt-1 text-xs text-text-muted">{hint}</p>
      )}
    </div>
  );
}
