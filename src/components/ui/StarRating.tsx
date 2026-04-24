import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Star } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Read-only star display. Shows a compact "<avg> ★ · <count>" line.
 * When `count === 0`, renders a muted "not yet rated" hint instead
 * of empty stars so the UI isn't noisy on un-rated books.
 */
export function StarRatingDisplay({
  avg,
  count,
  size = 12,
  className,
}: {
  avg: number;
  count: number;
  size?: number;
  className?: string;
}) {
  const { t } = useTranslation();
  if (!count) {
    return (
      <span className={cn("text-[10px] text-text-muted", className)}>
        {t("ratings.notYetRated")}
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[11px] text-text-secondary",
        className,
      )}
    >
      <Star size={size} className="fill-yellow-400 text-yellow-400" />
      <span className="font-medium">{avg.toFixed(1)}</span>
      <span className="text-text-muted">·</span>
      <span className="text-text-muted">{count}</span>
    </span>
  );
}

/**
 * Interactive 5-star picker. Clicking a star sets the rating;
 * clicking the *same* star a second time clears the rating. Disabled
 * (grayed) when the user isn't signed in — the caller decides what
 * to render instead (e.g., a "Sign in to rate" link).
 */
export function StarRatingInput({
  value,
  onChange,
  onClear,
  disabled,
  size = 24,
  className,
}: {
  value: number | undefined;
  onChange: (stars: number) => void;
  onClear?: () => void;
  disabled?: boolean;
  size?: number;
  className?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const active = hover ?? value ?? 0;

  return (
    <div
      className={cn("flex items-center gap-1", className)}
      onMouseLeave={() => setHover(null)}
    >
      {[1, 2, 3, 4, 5].map((star) => {
        const filled = active >= star;
        return (
          <button
            key={star}
            type="button"
            disabled={disabled}
            onMouseEnter={() => setHover(star)}
            onFocus={() => setHover(star)}
            onClick={() => {
              if (disabled) return;
              // Re-click current value → clear
              if (value === star && onClear) onClear();
              else onChange(star);
            }}
            aria-label={`${star} star${star === 1 ? "" : "s"}`}
            className={cn(
              "rounded-md p-0.5 transition-transform",
              disabled
                ? "cursor-not-allowed opacity-40"
                : "cursor-pointer hover:scale-110",
            )}
          >
            <Star
              size={size}
              className={cn(
                "transition-colors",
                filled
                  ? "fill-yellow-400 text-yellow-400"
                  : "fill-transparent text-text-muted",
              )}
            />
          </button>
        );
      })}
    </div>
  );
}
