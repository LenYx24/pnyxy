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
  // Chromeless square — the default toolbar icon affordance.
  ghost: "text-text-muted hover:bg-glass-hover hover:text-text-primary",
  // Glass-outlined square — sits on busy surfaces, reads as a control.
  secondary:
    "border border-glass-border bg-bg-primary/50 text-text-muted hover:bg-glass-hover hover:text-text-primary",
  // Tinted accent — quiet primary icon action.
  soft: "bg-accent/15 text-accent hover:bg-accent/25",
  // Tinted danger — destructive icon action.
  danger: "text-text-muted hover:bg-danger/15 hover:text-danger",
  // Pressed / on state — for toggles that are currently active.
  active: "border border-accent/50 bg-accent/15 text-accent",
};

const sizes: Record<IconButtonSize, string> = {
  sm: "h-7 w-7",
  md: "h-8 w-8",
};

/**
 * Square icon button — the toolbar/affordance counterpart to `Button`.
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
        "inline-flex shrink-0 items-center justify-center rounded-md transition-colors cursor-pointer",
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
