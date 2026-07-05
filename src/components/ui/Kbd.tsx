import { formatShortcut } from "@/lib/keyboard-shortcuts";
import { cn } from "@/lib/cn";
import { useIsMobile } from "@/hooks/use-media-query";

interface KbdProps {
  /** Modifier + key combo. Omit a modifier by leaving it unset. */
  shortcut: { key: string; ctrl?: boolean; shift?: boolean; alt?: boolean };
  /** Additional classes; defaults render well on dark surfaces. */
  className?: string;
}

/**
 * Inline keyboard-shortcut hint. Renders the shortcut inside a `<kbd>`
 * element with consistent styling; auto-formats ⌘ vs Ctrl for Mac.
 * Renders nothing on phones, shortcuts are meaningless without a keyboard.
 */
export function Kbd({ shortcut, className }: KbdProps) {
  const isMobile = useIsMobile();
  if (isMobile) return null;
  return (
    <kbd
      className={cn(
        "inline-flex items-center rounded border border-glass-border bg-bg-primary/60 px-1 py-0.5 text-2xs font-mono text-text-secondary",
        className,
      )}
    >
      {formatShortcut(shortcut)}
    </kbd>
  );
}
