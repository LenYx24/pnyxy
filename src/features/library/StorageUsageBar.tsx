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
  const isHigh = pct > 80;
  const tierLabel =
    tier === "premium"
      ? t("library.storage.tierPremium")
      : t("library.storage.tierFree");

  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex items-center justify-between text-xs">
        <span className="text-text-muted">
          {t("library.storage.used", {
            used: formatBytes(usedBytes),
            limit: formatBytes(limitBytes),
          })}
        </span>
        <span className="text-text-muted">{tierLabel}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-glass-border">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            isHigh ? "bg-danger" : "bg-accent",
          )}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
    </div>
  );
}
