import {
  formatShortcut,
  shortcutParts,
  type ShortcutSpec,
} from "@/lib/keyboard-shortcuts";
import { cn } from "@/lib/cn";
import { useIsMobile, useMediaQuery } from "@/hooks/use-media-query";

interface KbdProps {
  /** Modifier + key combo. Omit a modifier by leaving it unset. */
  shortcut: ShortcutSpec;
  /** `single`: one <kbd> with "Ctrl + O". `chips`: one small chip per
   *  part ("Ctrl" "Shift" "O"), for tooltips and the shortcuts list. */
  variant?: "single" | "chips";
  /** Additional classes; defaults render well on dark surfaces. */
  className?: string;
}

const chipClass =
  "inline-flex items-center rounded-md bg-surface-3 px-1 py-0.5 text-2xs font-mono text-text-secondary";

/**
 * Inline keyboard-shortcut hint. Renders the shortcut inside a `<kbd>`
 * element with consistent styling; auto-formats ⌘ vs Ctrl for Mac.
 * Renders nothing on phones or coarse-pointer (touch) devices, shortcuts
 * are meaningless without a keyboard.
 */
export function Kbd({ shortcut, variant = "single", className }: KbdProps) {
  const isMobile = useIsMobile();
  const coarse = useMediaQuery("(pointer: coarse)");
  if (isMobile || coarse) return null;
  if (variant === "chips") {
    return (
      <span className={cn("inline-flex items-center gap-0.5", className)}>
        {shortcutParts(shortcut).map((part, i) => (
          <kbd key={i} className={cn(chipClass, "min-w-[1.25rem] justify-center")}>
            {part}
          </kbd>
        ))}
      </span>
    );
  }
  return (
    <kbd className={cn(chipClass, className)}>{formatShortcut(shortcut)}</kbd>
  );
}
