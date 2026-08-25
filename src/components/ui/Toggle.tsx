import { cn } from "@/lib/cn";

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
}

export function Toggle({ checked, onChange, label, disabled }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors duration-200",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft",
        "disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-accent" : "bg-surface-3",
      )}
    >
      {label && <span className="sr-only">{label}</span>}
      <span
        className={cn(
          "pointer-events-none inline-block h-5 w-5 rounded-full bg-text-primary shadow-sm ring-0 transition-transform duration-200",
          checked ? "translate-x-5" : "translate-x-0.5",
          "mt-0.5",
        )}
      />
    </button>
  );
}
