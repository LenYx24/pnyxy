import { useEffect, useMemo, useState } from "react";
import {
  Users,
  Crown,
  UserPlus,
  Activity,
  BookOpen,
  StickyNote,
  PencilRuler,
  GraduationCap,
  MessagesSquare,
  Loader2,
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Cell,
} from "recharts";
import { cn } from "@/lib/cn";
import { supabase } from "@/lib/supabase";
import { FormModal } from "@/components/ui/FormModal";
import {
  useAdminAnalyticsStore,
  type AdminOverview,
} from "@/stores/admin-analytics-store";

// Cost estimate
//
// We only store a per-day total token count (the worst-case quota
// charge: input + max_output), not a real input/output split, so any
// dollar figure here is a deliberately rough UPPER bound, blended
// $/1M-token rates per model, applied to the worst-case token count.
// Treat it as "ceiling on what this traffic could have cost," not the
// invoice. Good enough to compare models and spot trends.
const BLENDED_PRICE_PER_MTOK: Record<string, number> = {
  // current chain (2026-08 Gemini id rotation)
  "gemini-3.5-flash-lite": 0.2,
  "gemini-3.6-flash": 2.7,
  "gemini-3.7-flash": 3.0,
  // retired ids kept so history rows still price/color
  "gemini-2.5-flash-lite": 0.2,
  "gemini-2.5-flash": 0.6,
  "gemini-3-flash-preview": 0.8,
  "gpt-4o-mini": 0.4,
  "claude-haiku-4-5": 3.0,
  auto: 0.6,
};

const MODEL_COLOR: Record<string, string> = {
  "gemini-3.5-flash-lite": "#84cc16",
  "gemini-3.6-flash": "#22c55e",
  "gemini-3.7-flash": "#06b6d4",
  "gemini-2.5-flash-lite": "#a3e635",
  "gemini-2.5-flash": "#4ade80",
  "gemini-3-flash-preview": "#22d3ee",
  "gpt-4o-mini": "#3b82f6",
  "claude-haiku-4-5": "#a855f7",
  auto: "#6b7280",
};
const FALLBACK_COLORS = ["#ec4899", "#f59e0b", "#14b8a6", "#f43f5e"];

const RANGES = [1, 7, 30, 90];

// Sign-in provider labels/colors. Google is Gmail OAuth, email is
// email+password; anything else falls back to a neutral chip.
const PROVIDER_META: Record<string, { label: string; color: string }> = {
  google: { label: "Google (Gmail)", color: "#ea4335" },
  email: { label: "Email + password", color: "#3b82f6" },
};
const providerMeta = (p: string) =>
  PROVIDER_META[p] ?? { label: p, color: "#6b7280" };

const fmt = (n: number): string => {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${n}`;
};

const fmtBytes = (n: number): string => {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)} KB`;
  return `${n} B`;
};

const tickStyle = { fill: "#9ca3af", fontSize: 12 } as const;
const gridStroke = "rgba(148,163,184,0.12)";
const tooltipStyle = {
  background: "rgba(17,17,23,0.95)",
  border: "1px solid rgba(148,163,184,0.2)",
  borderRadius: 8,
  fontSize: 12,
} as const;

// small building blocks

function ChartCard({
  title,
  subtitle,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-glass-border bg-glass-bg p-5 backdrop-blur-md",
        className,
      )}
    >
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
        {subtitle && <p className="mt-0.5 text-xs text-text-muted">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

interface KpiDef {
  key: keyof AdminOverview;
  label: string;
  Icon: typeof Users;
  color: string;
  suffix?: (o: AdminOverview) => string;
}

const KPIS: KpiDef[] = [
  { key: "total_users", label: "Total users", Icon: Users, color: "text-blue-400" },
  {
    key: "premium_users",
    label: "Premium",
    Icon: Crown,
    color: "text-warning",
    suffix: (o) =>
      o.total_users > 0
        ? ` (${Math.round((o.premium_users / o.total_users) * 100)}%)`
        : "",
  },
  { key: "new_users_30d", label: "New (30d)", Icon: UserPlus, color: "text-success" },
  { key: "active_users_7d", label: "Active (7d)", Icon: Activity, color: "text-cyan-400" },
  { key: "total_books", label: "Books", Icon: BookOpen, color: "text-success" },
  { key: "total_notes", label: "Notes", Icon: StickyNote, color: "text-warning" },
  { key: "total_whiteboards", label: "Whiteboards", Icon: PencilRuler, color: "text-purple-400" },
  { key: "total_quizzes", label: "Quizzes", Icon: GraduationCap, color: "text-pink-400" },
  { key: "total_conversations", label: "Chats", Icon: MessagesSquare, color: "text-indigo-400" },
];

// New-users list (behind the clickable "New" KPI)

interface NewUser {
  id: string;
  display_name: string | null;
  email: string;
  provider: string;
  created_at: string;
}

function NewUsersModal({
  open,
  onClose,
  rangeDays,
}: {
  open: boolean;
  onClose: () => void;
  rangeDays: number;
}) {
  const [rows, setRows] = useState<NewUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    supabase
      .rpc("admin_new_users", { p_days: rangeDays })
      .then(({ data, error: rpcError }) => {
        if (cancelled) return;
        if (rpcError) {
          setError(rpcError.message);
          setRows([]);
        } else {
          setRows(
            ((data ?? []) as Record<string, unknown>[]).map((r) => ({
              id: String(r.id),
              display_name: r.display_name ? String(r.display_name) : null,
              email: String(r.email),
              provider: String(r.provider),
              created_at: String(r.created_at),
            })),
          );
        }
      })
      .then(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, rangeDays]);

  const rangeLabel =
    rangeDays === 1 ? "today" : `the last ${rangeDays} days`;

  return (
    <FormModal
      open={open}
      onClose={onClose}
      title={`New users · ${rangeLabel}`}
      icon={UserPlus}
      size="lg"
      resizeStorageKey="admin:new-users"
    >
      {loading ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-accent" />
        </div>
      ) : error ? (
        <div className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
          {error}
        </div>
      ) : rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-text-muted">
          No new sign-ups in {rangeLabel}.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-text-muted">
                <th className="pb-2 font-medium">User</th>
                <th className="pb-2 font-medium">Sign-in</th>
                <th className="pb-2 text-right font-medium">Registered</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => {
                const { label, color } = providerMeta(u.provider);
                return (
                  <tr key={u.id} className="border-t border-glass-border">
                    <td className="py-2">
                      <div className="text-text-primary">
                        {u.display_name || "(no name)"}
                      </div>
                      <div className="text-xs text-text-muted">{u.email}</div>
                    </td>
                    <td className="py-2">
                      <span className="inline-flex items-center gap-1.5 text-xs text-text-secondary">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ background: color }}
                        />
                        {label}
                      </span>
                    </td>
                    <td className="py-2 text-right text-text-muted">
                      {new Date(u.created_at).toLocaleString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </FormModal>
  );
}

// main tab

export function AnalyticsTab() {
  const {
    rangeDays,
    loading,
    error,
    overview,
    signups,
    tokensDaily,
    distribution,
    topUsers,
    booksHistogram,
    featureUsage,
    providers,
    activation,
    retention,
    activeDaily,
    storage,
    fetchAll,
  } = useAdminAnalyticsStore();

  const [showNewUsers, setShowNewUsers] = useState(false);

  const providerTotal = providers.reduce((sum, p) => sum + p.users, 0);
  // New sign-ups within the selected range. The daily signups series is
  // generate_series-backed over the same window, so this sum equals the
  // length of the admin_new_users list the modal shows.
  const newInRange = signups.reduce((sum, p) => sum + p.signups, 0);

  useEffect(() => {
    fetchAll(rangeDays);
    // Intentionally only on mount + explicit range change (below).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pivot the (day, model) token rows into one row per day with a
  // column per model, for the stacked area chart.
  const { tokenSeries, models, estCost } = useMemo(() => {
    const modelSet = new Set<string>();
    const byDay = new Map<string, Record<string, string | number>>();
    let cost = 0;
    for (const r of tokensDaily) {
      modelSet.add(r.model);
      const row = byDay.get(r.day) ?? { day: r.day };
      row[r.model] = Number(row[r.model] ?? 0) + r.tokens;
      byDay.set(r.day, row);
      const price = BLENDED_PRICE_PER_MTOK[r.model] ?? 0.6;
      cost += (r.tokens / 1_000_000) * price;
    }
    return {
      tokenSeries: Array.from(byDay.values()).sort((a, b) =>
        String(a.day).localeCompare(String(b.day)),
      ),
      models: Array.from(modelSet).sort(),
      estCost: cost,
    };
  }, [tokensDaily]);

  const colorFor = (model: string, i: number) =>
    MODEL_COLOR[model] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length];

  return (
    <div className="space-y-5">
      {/* Range selector */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-text-muted">
          {distribution
            ? `${distribution.users_active} active user(s) in the last ${rangeDays} days`
            : " "}
        </p>
        <div className="flex gap-1 rounded-lg border border-glass-border bg-glass-bg p-1">
          {RANGES.map((d) => (
            <button
              key={d}
              onClick={() => fetchAll(d)}
              className={cn(
                "cursor-pointer rounded-md px-3 py-1 text-xs font-medium transition-colors",
                rangeDays === d
                  ? "bg-accent/15 text-accent"
                  : "text-text-secondary hover:bg-glass-hover hover:text-text-primary",
              )}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
          {error}
        </div>
      )}

      {loading && !overview ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-accent" />
        </div>
      ) : (
        <>
          {/* KPI cards */}
          {overview && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {KPIS.map(({ key, label, Icon, color, suffix }) => {
                // The "New" card is range-aware (sum over the selected
                // range, not the fixed 30d overview figure) and opens the
                // who-are-they list on click.
                const isNew = key === "new_users_30d";
                const value = isNew ? newInRange : overview[key];
                const displayLabel = isNew ? `New (${rangeDays}d)` : label;
                const body = (
                  <>
                    <div className="flex items-center gap-2">
                      <Icon size={16} className={color} />
                      <span className="text-xs text-text-muted">
                        {displayLabel}
                      </span>
                    </div>
                    <p className="mt-2 text-xl font-bold text-text-primary">
                      {value.toLocaleString()}
                      {suffix && (
                        <span className="text-sm font-normal text-text-muted">
                          {suffix(overview)}
                        </span>
                      )}
                    </p>
                    {isNew && (
                      <span className="mt-1 block text-2xs text-accent">
                        View who →
                      </span>
                    )}
                  </>
                );
                const cardClass =
                  "rounded-xl border border-glass-border bg-glass-bg p-4 text-left backdrop-blur-md";
                return isNew ? (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setShowNewUsers(true)}
                    className={cn(
                      cardClass,
                      "cursor-pointer transition-colors hover:border-accent/40 hover:bg-glass-hover",
                    )}
                  >
                    {body}
                  </button>
                ) : (
                  <div key={key} className={cardClass}>
                    {body}
                  </div>
                );
              })}
            </div>
          )}

          {/* Sign-in method breakdown (Google vs email+password) */}
          {providers.length > 0 && (
            <ChartCard title="Sign-in method" subtitle="How registered users authenticate">
              <div className="space-y-3">
                {providers.map((p) => {
                  const { label, color } = providerMeta(p.provider);
                  const pct =
                    providerTotal > 0
                      ? Math.round((p.users / providerTotal) * 100)
                      : 0;
                  return (
                    <div key={p.provider}>
                      <div className="mb-1 flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ background: color }}
                          />
                          <span className="text-text-primary">{label}</span>
                        </div>
                        <span className="text-text-muted">
                          {p.users.toLocaleString()} ({pct}%)
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-glass-hover">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${pct}%`, background: color }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </ChartCard>
          )}

          {/* Signups + token cost side by side */}
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="New signups" subtitle={`Daily, last ${rangeDays} days`}>
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={signups} margin={{ top: 5, right: 8, left: -16, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gSignups" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.5} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={gridStroke} vertical={false} />
                  <XAxis dataKey="day" tick={tickStyle} tickFormatter={(d) => String(d).slice(5)} minTickGap={24} />
                  <YAxis tick={tickStyle} allowDecimals={false} width={36} />
                  <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: "#e5e7eb" }} />
                  <Area type="monotone" dataKey="signups" stroke="#3b82f6" fill="url(#gSignups)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard
              title="LLM token usage by model"
              subtitle={`Worst-case tokens · est. ceiling ≈ $${estCost.toFixed(2)} over ${rangeDays}d`}
            >
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={tokenSeries} margin={{ top: 5, right: 8, left: -8, bottom: 0 }}>
                  <CartesianGrid stroke={gridStroke} vertical={false} />
                  <XAxis dataKey="day" tick={tickStyle} tickFormatter={(d) => String(d).slice(5)} minTickGap={24} />
                  <YAxis tick={tickStyle} width={44} tickFormatter={(v) => fmt(Number(v))} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    labelStyle={{ color: "#e5e7eb" }}
                    formatter={(v, name) => [fmt(Number(v)), String(name)]}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {models.map((m, i) => (
                    <Area
                      key={m}
                      type="monotone"
                      dataKey={m}
                      stackId="tok"
                      stroke={colorFor(m, i)}
                      fill={colorFor(m, i)}
                      fillOpacity={0.35}
                      strokeWidth={1.5}
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          {/* Active users trend */}
          <ChartCard
            title="Active users"
            subtitle={`Distinct users who used AI per day · last ${rangeDays} days`}
          >
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={activeDaily} margin={{ top: 5, right: 8, left: -16, bottom: 0 }}>
                <defs>
                  <linearGradient id="gActive" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.5} />
                    <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={gridStroke} vertical={false} />
                <XAxis dataKey="day" tick={tickStyle} tickFormatter={(d) => String(d).slice(5)} minTickGap={24} />
                <YAxis tick={tickStyle} allowDecimals={false} width={36} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: "#e5e7eb" }} />
                <Area type="monotone" dataKey="active_users" stroke="#06b6d4" fill="url(#gActive)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* Activation funnel + retention */}
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Activation funnel" subtitle="How far new users get">
              {activation && (
                <div className="space-y-3">
                  {[
                    { label: "Registered", value: activation.registered },
                    { label: "Onboarded", value: activation.onboarded },
                    { label: "Added a book", value: activation.with_book },
                    { label: "Started a chat", value: activation.with_chat },
                  ].map((step) => {
                    const base = activation.registered || 1;
                    const pct = Math.round((step.value / base) * 100);
                    return (
                      <div key={step.label}>
                        <div className="mb-1 flex items-center justify-between text-sm">
                          <span className="text-text-primary">{step.label}</span>
                          <span className="text-text-muted">
                            {step.value.toLocaleString()} ({pct}%)
                          </span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-glass-hover">
                          <div
                            className="h-full rounded-full bg-accent"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </ChartCard>

            <ChartCard title="Retention" subtitle="Do new users come back?">
              {retention && (
                <div className="grid grid-cols-2 gap-3">
                  {[
                    {
                      label: "Next-day (D1)",
                      retained: retention.d1_retained,
                      eligible: retention.d1_eligible,
                    },
                    {
                      label: "Week-1 (D7)",
                      retained: retention.d7_retained,
                      eligible: retention.d7_eligible,
                    },
                  ].map((r) => {
                    const pct =
                      r.eligible > 0 ? Math.round((r.retained / r.eligible) * 100) : 0;
                    return (
                      <div key={r.label} className="rounded-lg bg-glass-hover p-4 text-center">
                        <p className="text-2xl font-bold text-text-primary">{pct}%</p>
                        <p className="mt-1 text-xs text-text-muted">{r.label}</p>
                        <p className="mt-0.5 text-2xs text-text-muted-2">
                          {r.retained}/{r.eligible} users
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </ChartCard>
          </div>

          {/* Token distribution stats */}
          {distribution && (
            <ChartCard
              title="Per-user token distribution"
              subtitle={`Across ${distribution.users_active} active users · last ${rangeDays} days. The gap between median and p99 is the heavy tail.`}
            >
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {[
                  { label: "Avg", value: distribution.avg_tokens },
                  { label: "Median", value: distribution.median_tokens },
                  { label: "p90", value: distribution.p90_tokens },
                  { label: "p95", value: distribution.p95_tokens },
                  { label: "p99", value: distribution.p99_tokens },
                  { label: "Max", value: distribution.max_tokens },
                ].map(({ label, value }) => (
                  <div key={label} className="rounded-lg bg-glass-hover p-3 text-center">
                    <p className="text-lg font-bold text-text-primary">{fmt(value)}</p>
                    <p className="text-xs text-text-muted">{label}</p>
                  </div>
                ))}
              </div>
            </ChartCard>
          )}

          {/* Heavy users + books histogram */}
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Heavy users" subtitle={`Top token burners · last ${rangeDays} days`}>
              {topUsers.length === 0 ? (
                <p className="py-8 text-center text-sm text-text-muted">No usage yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-text-muted">
                        <th className="pb-2 font-medium">User</th>
                        <th className="pb-2 font-medium">Tier</th>
                        <th className="pb-2 text-right font-medium">Tokens</th>
                        <th className="pb-2 text-right font-medium">Reqs</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topUsers.map((u) => (
                        <tr key={u.user_id} className="border-t border-glass-border">
                          <td className="py-2 text-text-primary">
                            {u.display_name || `${u.user_id.slice(0, 8)}…`}
                          </td>
                          <td className="py-2">
                            <span
                              className={cn(
                                "rounded px-1.5 py-0.5 text-xs",
                                u.tier === "premium"
                                  ? "bg-warning/15 text-warning"
                                  : "bg-glass-hover text-text-muted",
                              )}
                            >
                              {u.tier}
                            </span>
                          </td>
                          <td className="py-2 text-right font-medium text-text-primary">{fmt(u.tokens)}</td>
                          <td className="py-2 text-right text-text-muted">{u.requests}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </ChartCard>

            <ChartCard title="Books per user" subtitle="How many books users keep in their library">
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={booksHistogram} margin={{ top: 5, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid stroke={gridStroke} vertical={false} />
                  <XAxis dataKey="bucket" tick={tickStyle} />
                  <YAxis tick={tickStyle} allowDecimals={false} width={36} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    labelStyle={{ color: "#e5e7eb" }}
                    cursor={{ fill: "rgba(148,163,184,0.08)" }}
                    formatter={(v) => [`${Number(v)} users`, "Users"]}
                  />
                  <Bar dataKey="users" radius={[4, 4, 0, 0]} fill="#22c55e" />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          {/* Feature adoption */}
          <ChartCard title="Feature adoption" subtitle="Distinct users who created at least one item per feature">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={featureUsage} margin={{ top: 5, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid stroke={gridStroke} vertical={false} />
                <XAxis dataKey="feature" tick={tickStyle} />
                <YAxis tick={tickStyle} allowDecimals={false} width={36} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelStyle={{ color: "#e5e7eb" }}
                  cursor={{ fill: "rgba(148,163,184,0.08)" }}
                  formatter={(v, _n, item) => [
                    `${Number(v)} users · ${fmt(
                      ((item?.payload as FeatureUsageRowLike)?.total_items) ?? 0,
                    )} items`,
                    "Adoption",
                  ]}
                />
                <Bar dataKey="users_with" radius={[4, 4, 0, 0]}>
                  {featureUsage.map((_, i) => (
                    <Cell key={i} fill={FALLBACK_COLORS[i % FALLBACK_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* Storage usage */}
          <ChartCard
            title="Storage usage"
            subtitle={`Total ${fmtBytes(storage?.total_bytes ?? 0)} across all users · top by footprint`}
          >
            {storage && storage.top.length > 0 ? (
              <div className="space-y-2">
                {storage.top.map((u) => {
                  const max = storage.top[0]?.bytes || 1;
                  const pct = Math.round((u.bytes / max) * 100);
                  return (
                    <div key={u.user_id}>
                      <div className="mb-1 flex items-center justify-between text-sm">
                        <span className="truncate text-text-primary">
                          {u.display_name || `${u.user_id.slice(0, 8)}…`}
                        </span>
                        <span className="text-text-muted">{fmtBytes(u.bytes)}</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-glass-hover">
                        <div
                          className="h-full rounded-full bg-purple-400"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="py-8 text-center text-sm text-text-muted">No stored files yet.</p>
            )}
          </ChartCard>
        </>
      )}

      <NewUsersModal
        open={showNewUsers}
        onClose={() => setShowNewUsers(false)}
        rangeDays={rangeDays}
      />
    </div>
  );
}

type FeatureUsageRowLike = { total_items?: number };
