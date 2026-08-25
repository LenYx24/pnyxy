import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

export type IconButtonVariant =
  | "ghost"
  | "secondary"
  | "soft"
  | "danger"
  | "active";
export type IconButtonSize = "sm" | "md";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  /** The icon (e.g. a lucide glyph). Square button, centered. */
  children: ReactNode;
}

const variants: Record<IconButtonVariant, string> = {
  // Chromeless square, the default toolbar icon affordance.
  ghost: "text-text-muted hover:bg-glass-hover hover:text-text-primary",
  // Surface-2 filled square, sits on busy surfaces, reads as a control.
  secondary:
    "bg-bg-tertiary text-text-muted hover:bg-surface-3 hover:text-text-primary",
  // Tinted accent, quiet primary icon action.
  soft: "bg-accent-soft text-accent hover:bg-accent/25",
  // Tinted danger, destructive icon action.
  danger: "text-text-muted hover:bg-danger/15 hover:text-danger",
  // Pressed / on state, for toggles that are currently active.
  active: "bg-bg-tertiary text-text-primary",
};

const sizes: Record<IconButtonSize, string> = {
  sm: "h-7 w-7",
  md: "h-9 w-9",
};

/**
 * Square icon button, the toolbar/affordance counterpart to `Button`.
 * Unifies the dozens of hand-rolled `h-8 w-8 rounded-md …` icon
 * buttons scattered across composers, toolbars and cards.
 */
export function IconButton({
  variant = "ghost",
  size = "md",
  className,
  children,
  ...props
}: IconButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-control transition-colors cursor-pointer",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft",
        "disabled:cursor-not-allowed disabled:opacity-40",
        sizes[size],
        variants[variant],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
