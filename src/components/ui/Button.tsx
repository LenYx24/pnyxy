import type { ButtonHTMLAttributes, ReactNode } from "react";
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

export function Button({
  variant = "primary",
  size = "md",
  fullWidth = false,
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
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
      {children}
    </button>
  );
}
