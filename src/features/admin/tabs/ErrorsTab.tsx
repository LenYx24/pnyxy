import { useCallback, useEffect, useState } from "react";
import { Loader2, AlertTriangle, AlertCircle, MessageSquare, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { supabase } from "@/lib/supabase";

// Admin "Errors" tab: recent client-side crashes/errors/reports from
// migration 00076 (client_errors + admin_recent_errors RPC). Standalone
// (no shared admin store, unlike the other tabs) since this is a fresh
// concern and the existing admin stores are owned elsewhere. Follows the
// same untranslated, owner-only English UI as the rest of the admin
// panel (ReportsTab, AiUsageTab, …).

const RANGES = [1, 7, 30];
const PAGE_LIMIT = 200;

type ErrorKind = "crash" | "error" | "report";

interface ErrorRow {
  id: string;
  user_id: string | null;
  display_name: string | null;
  kind: ErrorKind;
  message: string | null;
  route: string | null;
  user_agent: string | null;
  context: unknown;
  created_at: string;
}

const KIND_META: Record<ErrorKind, { label: string; className: string; Icon: typeof AlertTriangle }> = {
  crash: { label: "Crash", className: "bg-danger/15 text-danger", Icon: AlertTriangle },
  error: { label: "Error", className: "bg-warning/15 text-warning", Icon: AlertCircle },
  report: { label: "Report", className: "bg-accent/15 text-accent", Icon: MessageSquare },
};

/** True for a "function does not exist" error, PostgREST's shape when
 *  the caller RPC hasn't been deployed to this database yet. */
function isMissingFunctionError(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  if (err.code === "42883" || err.code === "PGRST202") return true;
  return /function .*admin_recent_errors.* does not exist/i.test(err.message ?? "");
}

export function ErrorsTab() {
  const [rangeDays, setRangeDays] = useState(7);
  const [rows, setRows] = useState<ErrorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [needsDeploy, setNeedsDeploy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchErrors = useCallback(async (days: number) => {
    setLoading(true);
    setError(null);
    setNeedsDeploy(false);
    const { data, error: rpcError } = await supabase.rpc("admin_recent_errors", {
      p_days: days,
      p_limit: PAGE_LIMIT,
    });
    if (rpcError) {
      if (isMissingFunctionError(rpcError)) {
        setNeedsDeploy(true);
      } else {
        setError(rpcError.message);
      }
      setRows([]);
      setLoading(false);
      return;
    }
    setRows((data ?? []) as ErrorRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void fetchErrors(rangeDays);
  }, [fetchErrors, rangeDays]);

  const counts = rows.reduce(
    (acc, r) => {
      acc[r.kind] += 1;
      return acc;
    },
    { crash: 0, error: 0, report: 0 } as Record<ErrorKind, number>,
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">Client errors</h2>
          <p className="text-xs text-text-muted">
            Auto-captured crashes/errors and user-submitted bug reports.
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-glass-border bg-glass-bg p-1">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setRangeDays(r)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer",
                rangeDays === r
                  ? "bg-accent/15 text-accent"
                  : "text-text-secondary hover:bg-glass-hover hover:text-text-primary",
              )}
            >
              {r}d
            </button>
          ))}
        </div>
      </div>

      {needsDeploy && (
        <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
          Client error monitoring needs deploy: migration 00076 (client_errors,
          admin_recent_errors) hasn't been applied to this database yet.
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20 text-text-muted">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : needsDeploy || error ? null : rows.length === 0 ? (
        <p className="py-12 text-center text-text-muted">
          No crashes, errors, or reports in the last {rangeDays} day{rangeDays === 1 ? "" : "s"}.
        </p>
      ) : (
        <div className="space-y-3">
          <div className="flex gap-3 text-xs text-text-muted">
            <span>{counts.crash} crashes</span>
            <span>{counts.error} errors</span>
            <span>{counts.report} reports</span>
            <span>· {rows.length} total</span>
          </div>

          {rows.map((row) => {
            const meta = KIND_META[row.kind];
            const isExpanded = expandedId === row.id;
            const hasContext = row.context != null;
            return (
              <div
                key={row.id}
                className="rounded-xl border border-glass-border bg-glass-bg p-4 backdrop-blur-md"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
                        meta.className,
                      )}
                    >
                      <meta.Icon size={12} />
                      {meta.label}
                    </span>
                    <span className="truncate text-sm font-medium text-text-primary">
                      {row.display_name ?? (row.user_id ? "Unknown user" : "Signed out")}
                    </span>
                  </div>
                  <span className="shrink-0 text-xs text-text-muted">
                    {new Date(row.created_at).toLocaleString()}
                  </span>
                </div>

                <p className="mt-2 break-words text-sm text-text-secondary">
                  {row.message || <span className="text-text-muted">(no message)</span>}
                </p>

                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-muted">
                  {row.route && <span className="font-mono">{row.route}</span>}
                  {row.user_agent && <span className="truncate">{row.user_agent}</span>}
                </div>

                {hasContext && (
                  <div className="mt-2">
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : row.id)}
                      className="inline-flex cursor-pointer items-center gap-1 text-xs text-text-muted transition-colors hover:text-text-primary"
                    >
                      {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      Context
                    </button>
                    {isExpanded && (
                      <pre className="menu-scroll mt-1.5 max-h-64 overflow-auto rounded-lg bg-bg-primary/60 p-2.5 text-2xs text-text-secondary">
                        {JSON.stringify(row.context, null, 2)}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
