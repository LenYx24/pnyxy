import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/cn";

interface CheckboxProps {
  checked: boolean;
  /** When true, paints a "some-but-not-all" indicator (a horizontal bar)
   *  even though `checked` is false. The next click flips to fully
   *  checked, matching the OS checkbox convention. */
  indeterminate?: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}

export function Checkbox({
  checked,
  indeterminate = false,
  onChange,
  disabled,
  className,
}: CheckboxProps) {
  const visuallyOn = checked || indeterminate;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? "mixed" : checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border transition-all duration-150 cursor-pointer",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-purple focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary",
        "disabled:cursor-not-allowed disabled:opacity-50",
        visuallyOn
          ? "border-accent-purple bg-accent-purple text-white"
          : "border-glass-border bg-glass-bg text-transparent hover:border-accent-purple/50",
        className,
      )}
    >
      {indeterminate ? (
        <Minus size={12} strokeWidth={3} />
      ) : (
        <Check size={12} strokeWidth={3} />
      )}
    </button>
  );
}
