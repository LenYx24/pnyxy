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
  // Solid accent, the one primary action on a surface.
  primary: "bg-accent hover:bg-accent/80 text-white shadow-lg shadow-accent/25",
  // Glass outline, secondary actions that shouldn't compete.
  secondary:
    "bg-glass-bg border border-glass-border hover:bg-glass-hover text-text-primary backdrop-blur-md",
  // Chromeless, tertiary / toolbar-ish text actions.
  ghost: "hover:bg-glass-hover text-text-secondary hover:text-text-primary",
  // Tinted accent, the very common "quiet primary" (New, Generate…).
  soft: "bg-accent/15 hover:bg-accent/25 text-accent",
  // Tinted danger, destructive actions (delete, remove).
  danger: "bg-danger/15 hover:bg-danger/25 text-danger",
};

const sizes: Record<ButtonSize, string> = {
  sm: "gap-1.5 rounded-md px-3 py-1.5 text-xs",
  md: "gap-2 rounded-lg px-4 py-2 text-sm",
  lg: "gap-2 rounded-lg px-5 py-2.5 text-sm",
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
