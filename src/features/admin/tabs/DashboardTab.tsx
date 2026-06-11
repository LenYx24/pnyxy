import { useEffect } from "react";
import { Users, AlertTriangle, BookOpen, ShieldBan, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { useAdminStore } from "@/stores/admin-store";

const cards = [
  { key: "totalUsers" as const, label: "Total Users", Icon: Users, color: "text-blue-400" },
  { key: "pendingReports" as const, label: "Pending Reports", Icon: AlertTriangle, color: "text-warning" },
  { key: "pendingBooks" as const, label: "Pending Books", Icon: BookOpen, color: "text-success" },
  { key: "activeBans" as const, label: "Active Bans", Icon: ShieldBan, color: "text-danger" },
];

export function DashboardTab() {
  const { stats, statsLoading, fetchStats } = useAdminStore();

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  if (statsLoading && !stats) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {cards.map(({ key, label, Icon, color }) => (
        <div
          key={key}
          className="rounded-xl border border-glass-border bg-glass-bg p-6 backdrop-blur-md"
        >
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "flex h-10 w-10 items-center justify-center rounded-lg bg-glass-hover",
                color,
              )}
            >
              <Icon size={20} />
            </div>
            <div>
              <p className="text-2xl font-bold text-text-primary">
                {stats?.[key] ?? 0}
              </p>
              <p className="text-sm text-text-muted">{label}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
