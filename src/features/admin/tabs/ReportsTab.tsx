import { useEffect, useState } from "react";
import { Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/Button";
import { useAdminStore } from "@/stores/admin-store";
import type { ReportStatus } from "@/types/database";

const PAGE_SIZE = 20;

export function ReportsTab() {
  const {
    reports,
    reportsLoading,
    reportsTotal,
    fetchReports,
    resolveReport,
    banUser,
  } = useAdminStore();
  const [page, setPage] = useState(0);
  const [tempBanDays, setTempBanDays] = useState<Record<string, number>>({});
  const [actionNotes, setActionNotes] = useState<Record<string, string>>({});
  const [acting, setActing] = useState<string | null>(null);

  useEffect(() => {
    fetchReports(page);
  }, [fetchReports, page]);

  const totalPages = Math.ceil(reportsTotal / PAGE_SIZE);

  const handleAction = async (
    reportId: string,
    reportedUserId: string,
    status: ReportStatus,
  ) => {
    setActing(reportId);
    try {
      const note = actionNotes[reportId] || "";
      await resolveReport(reportId, status, note);

      if (status === "temp_banned") {
        const days = tempBanDays[reportId] ?? 7;
        await banUser(reportedUserId, note || "Banned via report", days);
      } else if (status === "permabanned") {
        await banUser(reportedUserId, note || "Permanently banned via report", null);
      }
    } finally {
      setActing(null);
    }
  };

  if (reportsLoading && reports.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
      </div>
    );
  }

  if (reports.length === 0) {
    return (
      <p className="py-12 text-center text-text-muted">No reports found.</p>
    );
  }

  return (
    <div className="space-y-4">
      {reports.map((report) => {
        const isPending = report.status === "pending";
        return (
          <div
            key={report.id}
            className="rounded-xl border border-glass-border bg-glass-bg p-5 backdrop-blur-md"
          >
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
              <div className="text-sm">
                <span className="text-text-muted">Reporter: </span>
                <span className="font-medium text-text-primary">
                  {report.reporter?.display_name ?? "Unknown"}
                </span>
                <span className="mx-2 text-text-muted">&rarr;</span>
                <span className="text-text-muted">Reported: </span>
                <span className="font-medium text-text-primary">
                  {report.reported_user?.display_name ?? "Unknown"}
                </span>
              </div>
              <span
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-xs font-medium",
                  isPending
                    ? "bg-warning/15 text-warning"
                    : "bg-glass-hover text-text-muted",
                )}
              >
                {report.status}
              </span>
            </div>

            <div className="mb-3 flex flex-wrap gap-1.5">
              {report.reasons.map((reason) => (
                <span
                  key={reason}
                  className="rounded-full border border-glass-border bg-glass-hover px-2.5 py-0.5 text-xs text-text-secondary"
                >
                  {reason.replace(/_/g, " ")}
                </span>
              ))}
            </div>

            {report.message && (
              <p className="mb-3 text-sm text-text-secondary">
                {report.message}
              </p>
            )}

            <p className="mb-3 text-xs text-text-muted">
              {new Date(report.created_at).toLocaleString()}
            </p>

            {isPending && (
              <div className="space-y-3 border-t border-glass-border pt-3">
                <input
                  type="text"
                  placeholder="Admin note (optional)"
                  value={actionNotes[report.id] ?? ""}
                  onChange={(e) =>
                    setActionNotes((prev) => ({
                      ...prev,
                      [report.id]: e.target.value,
                    }))
                  }
                  className="w-full rounded-lg border border-glass-border bg-glass-bg px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
                />

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="ghost"
                    disabled={acting === report.id}
                    onClick={() =>
                      handleAction(report.id, report.reported_user_id, "dismissed")
                    }
                  >
                    Dismiss
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={acting === report.id}
                    onClick={() =>
                      handleAction(report.id, report.reported_user_id, "warned")
                    }
                  >
                    Warn
                  </Button>

                  <div className="flex items-center gap-1">
                    <Button
                      variant="secondary"
                      disabled={acting === report.id}
                      onClick={() =>
                        handleAction(
                          report.id,
                          report.reported_user_id,
                          "temp_banned",
                        )
                      }
                    >
                      Temp Ban
                    </Button>
                    <input
                      type="number"
                      min={1}
                      max={365}
                      value={tempBanDays[report.id] ?? 7}
                      onChange={(e) =>
                        setTempBanDays((prev) => ({
                          ...prev,
                          [report.id]: Number(e.target.value),
                        }))
                      }
                      className="w-16 rounded-lg border border-glass-border bg-glass-bg px-2 py-1.5 text-center text-sm text-text-primary focus:border-accent focus:outline-none"
                    />
                    <span className="text-xs text-text-muted">days</span>
                  </div>

                  <Button
                    variant="primary"
                    disabled={acting === report.id}
                    onClick={() =>
                      handleAction(
                        report.id,
                        report.reported_user_id,
                        "permabanned",
                      )
                    }
                  >
                    Permaban
                  </Button>

                  {acting === report.id && (
                    <Loader2 size={16} className="animate-spin text-accent" />
                  )}
                </div>
              </div>
            )}

            {report.admin_action && (
              <p className="mt-2 text-xs text-text-muted">
                Admin note: {report.admin_action}
              </p>
            )}
          </div>
        );
      })}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 pt-2">
          <button
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
            className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary disabled:opacity-40"
          >
            <ChevronLeft size={18} />
          </button>
          <span className="text-sm text-text-secondary">
            {page + 1} / {totalPages}
          </span>
          <button
            disabled={page >= totalPages - 1}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary disabled:opacity-40"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      )}
    </div>
  );
}
