import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  /** Extra classes on the outer wrapper (e.g. to control min-height). */
  className?: string;
}

/** Centered, muted empty/placeholder state: icon + one-line title +
 *  optional description + optional primary action. Shared across
 *  library/reader/chat/quizzes/vocabulary/streaks/settings so every
 *  "nothing here yet" screen looks the same. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center",
        className,
      )}
    >
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-glass-bg">
        <Icon size={26} strokeWidth={1.5} className="text-text-muted" />
      </div>
      <div>
        <p className="font-display text-base font-medium text-text-primary">
          {title}
        </p>
        {description && (
          <p className="mx-auto mt-1 max-w-sm text-sm text-text-muted">
            {description}
          </p>
        )}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
