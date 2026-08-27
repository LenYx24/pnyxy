import { Children, isValidElement, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "soft"
  | "danger";
export type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Stretch to the container width (common for modal / form CTAs). */
  fullWidth?: boolean;
  /** Busy state: swaps the leading icon (the first child, when it's an
   *  element rather than text) for a spinning Loader2, or prepends one
   *  when there's no leading icon, and disables the button. */
  loading?: boolean;
  children: ReactNode;
}

const variants: Record<ButtonVariant, string> = {
  // Text-on-desk fill: the one primary action on a surface (UI v2,
  // no accent needed, the fill itself is the emphasis).
  primary:
    "bg-text-primary text-bg-primary font-semibold hover:opacity-90",
  // Surface-2 fill, secondary actions that shouldn't compete.
  secondary: "bg-bg-tertiary text-text-primary hover:bg-surface-3",
  // Quiet: chromeless text action.
  ghost: "text-text-muted hover:bg-glass-hover hover:text-text-primary",
  // Tinted accent, the "quiet primary" (New, Generate…). Accent is
  // used at most once per screen, so prefer primary/secondary.
  soft: "bg-accent-soft hover:bg-accent/25 text-accent",
  // Tinted danger, destructive actions (delete, remove).
  danger: "bg-danger/15 hover:bg-danger/25 text-danger",
};

const sizes: Record<ButtonSize, string> = {
  sm: "gap-1.5 rounded-control px-3 py-1.5 text-xs",
  md: "gap-2 rounded-control px-4 py-2 text-sm",
  lg: "gap-2 rounded-control px-5 py-2.5 text-sm",
};

const spinnerSizes: Record<ButtonSize, number> = {
  sm: 13,
  md: 15,
  lg: 16,
};

export function Button({
  variant = "primary",
  size = "md",
  fullWidth = false,
  loading = false,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  const items = Children.toArray(children);
  const spinner = <Loader2 key="spinner" size={spinnerSizes[size]} className="animate-spin" />;
  const content = loading
    ? isValidElement(items[0])
      ? [spinner, ...items.slice(1)]
      : [spinner, ...items]
    : items;

  return (
    <button
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center font-medium",
        "transition-all duration-200 cursor-pointer",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        sizes[size],
        variants[variant],
        fullWidth && "w-full",
        className,
      )}
      {...props}
    >
      {content}
    </button>
  );
}
