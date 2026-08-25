import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";

interface StorageUsageBarProps {
  usedBytes: number;
  limitBytes: number;
  tier: string;
  className?: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(1)} GB`;
}

export function StorageUsageBar({
  usedBytes,
  limitBytes,
  tier,
  className,
}: StorageUsageBarProps) {
  const { t } = useTranslation();
  const pct = limitBytes > 0 ? (usedBytes / limitBytes) * 100 : 0;
  // Three-step escalation instead of a single accent→danger flip: an
  // amber warning band gives the user a heads-up before they hit the
  // wall, and `over` (at/above the limit) surfaces an explicit label.
  const isOver = pct >= 100;
  const isHigh = pct > 80;
  const isWarn = pct > 65;
  // Neutral fill by default: the accent is reserved for reading progress.
  const barColor = isHigh || isOver ? "bg-danger" : isWarn ? "bg-warning" : "bg-text-muted";
  const tierLabel =
    tier === "premium"
      ? t("library.storage.tierPremium")
      : t("library.storage.tierFree");
  const usedLabel = t("library.storage.used", {
    used: formatBytes(usedBytes),
    limit: formatBytes(limitBytes),
  });

  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex items-center justify-between text-xs">
        <span className={cn(isOver ? "text-danger" : "text-text-muted-2")}>
          {isOver
            ? `${t("library.storage.overLimit")} · ${usedLabel}`
            : usedLabel}
        </span>
        <span className="text-text-muted-2">{tierLabel}</span>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3"
        role="progressbar"
        aria-valuenow={Math.round(Math.min(pct, 100))}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={usedLabel}
      >
        <div
          className={cn("h-full rounded-full transition-all", barColor)}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
    </div>
  );
}
