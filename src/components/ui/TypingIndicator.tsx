import { cn } from "@/lib/cn";

/**
 * Three bouncing dots, the "AI is thinking" indicator. Used inside
 * empty assistant bubbles while waiting for the first delta to land,
 * and in the standalone "thinking" pill on chat surfaces. Replaces
 * the older `animate-pulse` on an empty rounded rectangle, which on
 * mobile rendered as a tiny ~28px-tall sliver that didn't read as
 * "loading", just as misalignment.
 *
 * Inherits `currentColor` so the dots blend with whatever bubble
 * tone they're inside (assistant message vs. side-panel pill etc.).
 */
export function TypingIndicator({
  /** Optional label rendered after the dots, e.g. "Thinking…". */
  label,
  /** Dot size. `sm` for inline-in-bubble, `md` for the bigger
   *  standalone pill. Defaults to `sm`. */
  size = "sm",
  className,
}: {
  label?: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const dotSize = size === "md" ? "h-2 w-2" : "h-1.5 w-1.5";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5",
        // Min-height so an empty assistant bubble stays a comfortable
        // touch target on mobile instead of collapsing to <30 px.
        "min-h-[1.25rem]",
        className,
      )}
      role="status"
      aria-label={label ?? "Loading"}
    >
      <span className="inline-flex items-center gap-1">
        <span
          className={cn(
            dotSize,
            "rounded-full bg-current opacity-60 animate-bounce",
          )}
          style={{ animationDelay: "0ms" }}
        />
        <span
          className={cn(
            dotSize,
            "rounded-full bg-current opacity-60 animate-bounce",
          )}
          style={{ animationDelay: "150ms" }}
        />
        <span
          className={cn(
            dotSize,
            "rounded-full bg-current opacity-60 animate-bounce",
          )}
          style={{ animationDelay: "300ms" }}
        />
      </span>
      {label && <span className="text-xs">{label}</span>}
    </span>
  );
}
