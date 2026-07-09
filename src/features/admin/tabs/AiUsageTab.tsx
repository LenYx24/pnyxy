import { useEffect } from "react";
import { Loader2, Users, Ban, Zap, ShieldAlert } from "lucide-react";
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
import { useAdminQuotaStore } from "@/stores/admin-quota-store";

const RANGES = [7, 30, 90];
const ACTIVE_MINS = [5, 20, 50];

const fmt = (n: number): string => {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${n}`;
};

const dayTick = (d: string): string => (d.length >= 10 ? d.slice(5) : d);
const pct = (n: number, d: number): number =>
  d > 0 ? Math.round((n / d) * 100) : 0;

const tickStyle = { fill: "#9ca3af", fontSize: 12 } as const;
const gridStroke = "rgba(148,163,184,0.12)";
const tooltipStyle = {
  background: "rgba(17,17,23,0.95)",
  border: "1px solid rgba(148,163,184,0.2)",
  borderRadius: 8,
  fontSize: 12,
} as const;

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

function StatTile({
  label,
  value,
  sub,
  Icon,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  Icon: typeof Users;
  color: string;
}) {
  return (
    <div className="rounded-xl border border-glass-border bg-glass-bg p-4 backdrop-blur-md">
      <div className="flex items-center gap-2">
        <Icon size={16} className={color} />
        <span className="text-xs text-text-muted">{label}</span>
      </div>
      <p className="mt-2 text-2xl font-bold text-text-primary">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-text-muted">{sub}</p>}
    </div>
  );
}

function TierBar({
  label,
  capped,
  active,
}: {
  label: string;
  capped: number;
  active: number;
}) {
  const p = pct(capped, active);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-text-secondary">{label}</span>
        <span className="text-text-muted">
          {capped}/{active} · {p}%
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-glass-border">
        <div
          className="h-full rounded-full bg-accent"
          style={{ width: `${p}%` }}
        />
      </div>
    </div>
  );
}

export function AiUsageTab() {
  const {
    rangeDays,
    activeMin,
    loading,
    error,
    daily,
    summary,
    histogram,
    fetchQuota,
  } = useAdminQuotaStore();

  useEffect(() => {
    void fetchQuota();
    // fetchQuota is stable (zustand action); run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const capRateAll = summary ? pct(summary.capped_users, summary.active_users) : 0;
  const capRatePower = summary
    ? pct(summary.power_capped_users, summary.power_users)
    : 0;

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">
            AI quota usage
          </h2>
          <p className="text-xs text-text-muted">
            How hard users push against their daily AI limits. “Bumped the
            ceiling” = reached ≥90% of a token or request cap on some model
            that day (cap-hits aren’t logged, so this is derived from usage).
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-glass-border bg-glass-bg p-1">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => void fetchQuota({ days: r })}
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

      {error && (
        <div className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20 text-text-muted">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        <>
          {/* Headline tiles */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile
              label={`Active users (${rangeDays}d)`}
              value={fmt(summary?.active_users ?? 0)}
              sub="≥1 AI request in range"
              Icon={Users}
              color="text-cyan-400"
            />
            <StatTile
              label="Bumped the ceiling"
              value={`${capRateAll}%`}
              sub={`${summary?.capped_users ?? 0} of ${summary?.active_users ?? 0} active`}
              Icon={Ban}
              color="text-warning"
            />
            <StatTile
              label={`Power users (≥${activeMin} req)`}
              value={fmt(summary?.power_users ?? 0)}
              sub="the heavy-use cohort"
              Icon={Zap}
              color="text-accent"
            />
            <StatTile
              label="Power users at ceiling"
              value={`${capRatePower}%`}
              sub={`${summary?.power_capped_users ?? 0} of ${summary?.power_users ?? 0} power users`}
              Icon={ShieldAlert}
              color="text-danger"
            />
          </div>

          {/* Power-user threshold selector */}
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <span>Power user = at least</span>
            <div className="flex items-center gap-1 rounded-lg border border-glass-border bg-glass-bg p-0.5">
              {ACTIVE_MINS.map((n) => (
                <button
                  key={n}
                  onClick={() => void fetchQuota({ activeMin: n })}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer",
                    activeMin === n
                      ? "bg-accent/15 text-accent"
                      : "text-text-secondary hover:bg-glass-hover hover:text-text-primary",
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
            <span>requests in range</span>
          </div>

          {/* Daily: active vs ceiling-bumping users */}
          <ChartCard
            title="Active vs. ceiling-bumping users, per day"
            subtitle="How many active users hit ≥90% of a cap each day."
          >
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={daily} margin={{ left: -12, right: 8, top: 4 }}>
                <defs>
                  <linearGradient id="qActive" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#06b6d4" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#06b6d4" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="qCapped" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#fbbf24" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="#fbbf24" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={gridStroke} vertical={false} />
                <XAxis
                  dataKey="day"
                  tick={tickStyle}
                  tickFormatter={dayTick}
                  minTickGap={24}
                />
                <YAxis tick={tickStyle} allowDecimals={false} width={44} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area
                  type="monotone"
                  dataKey="active_users"
                  name="Active"
                  stroke="#06b6d4"
                  fill="url(#qActive)"
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="capped_users"
                  name="At ceiling"
                  stroke="#fbbf24"
                  fill="url(#qCapped)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Daily: average usage per active user */}
            <ChartCard
              title="Average usage per active user, per day"
              subtitle="Mean tokens & requests across users active that day."
            >
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={daily} margin={{ left: -12, right: 8, top: 4 }}>
                  <defs>
                    <linearGradient id="qTok" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#22c55e" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={gridStroke} vertical={false} />
                  <XAxis
                    dataKey="day"
                    tick={tickStyle}
                    tickFormatter={dayTick}
                    minTickGap={24}
                  />
                  <YAxis
                    tick={tickStyle}
                    width={44}
                    tickFormatter={fmt}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(value) => fmt(Number(value ?? 0))}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Area
                    type="monotone"
                    dataKey="avg_tokens"
                    name="Avg tokens"
                    stroke="#22c55e"
                    fill="url(#qTok)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>

            {/* Distribution: how close users get to their ceiling */}
            <ChartCard
              title="How close users get to their ceiling"
              subtitle="Active users by peak quota utilisation in range."
            >
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={histogram} margin={{ left: -12, right: 8, top: 4 }}>
                  <CartesianGrid stroke={gridStroke} vertical={false} />
                  <XAxis dataKey="bucket" tick={tickStyle} />
                  <YAxis tick={tickStyle} allowDecimals={false} width={44} />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(148,163,184,0.08)" }} />
                  <Bar dataKey="users" name="Users" radius={[4, 4, 0, 0]}>
                    {histogram.map((b) => (
                      <Cell
                        key={b.bucket}
                        fill={b.sort_order === 5 ? "#f87171" : "#0891b2"}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          {/* By tier */}
          <ChartCard
            title="Ceiling-bumping by tier"
            subtitle="Share of each tier’s active users that hit a cap in range."
          >
            <div className="space-y-3">
              <TierBar
                label="Free"
                capped={summary?.free_capped ?? 0}
                active={summary?.free_active ?? 0}
              />
              <TierBar
                label="Premium"
                capped={summary?.premium_capped ?? 0}
                active={summary?.premium_active ?? 0}
              />
            </div>
          </ChartCard>
        </>
      )}
    </div>
  );
}
