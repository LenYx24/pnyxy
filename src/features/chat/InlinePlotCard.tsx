/**
 * Inline function plot for ```pnyxy-plot blocks in AI replies. The model
 * samples the function into (x, y) points (parsed by extract-plot.ts);
 * this draws them with Recharts (already a dependency, shared with the
 * admin analytics charts). Read-only, works in the narrow reader side
 * panel too (responsive container, no fixed width).
 */
import { useTranslation } from "react-i18next";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { InlinePlot } from "@/lib/ai/extract-plot";

// Distinct series colours that read on both light and dark chat surfaces.
const SERIES_COLORS = ["#7c9cff", "#4ade80", "#f0abfc"];
const AXIS = "#94a3b8";
const GRID = "rgba(148,163,184,0.18)";

const fmtNum = (v: number): string => {
  if (!Number.isFinite(v)) return "";
  const r = Math.round(v * 1000) / 1000;
  return String(r);
};

export function InlinePlotCard({ plot }: { plot: InlinePlot }) {
  const { t } = useTranslation();

  // Merge the series into one row-per-x dataset so a shared X axis lines
  // up; each series contributes its own y-keyed column.
  const byX = new Map<number, Record<string, number>>();
  plot.series.forEach((s, i) => {
    const key = `y${i}`;
    for (const p of s.points) {
      const row = byX.get(p.x) ?? { x: p.x };
      row[key] = p.y;
      byX.set(p.x, row);
    }
  });
  const data = Array.from(byX.values()).sort((a, b) => a.x - b.x);

  return (
    <figure className="mt-2 rounded-panel border border-glass-border bg-glass-bg p-3">
      {plot.title && (
        <figcaption className="mb-2 text-sm font-medium text-text-primary">
          {plot.title}
        </figcaption>
      )}
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={data} margin={{ top: 8, right: 12, left: -8, bottom: 4 }}>
          <CartesianGrid stroke={GRID} />
          <XAxis
            dataKey="x"
            type="number"
            domain={["dataMin", "dataMax"]}
            tick={{ fill: AXIS, fontSize: 11 }}
            tickFormatter={(v) => fmtNum(Number(v))}
            label={
              plot.xLabel
                ? { value: plot.xLabel, position: "insideBottomRight", offset: -2, fill: AXIS, fontSize: 11 }
                : undefined
            }
          />
          <YAxis
            tick={{ fill: AXIS, fontSize: 11 }}
            width={40}
            tickFormatter={(v) => fmtNum(Number(v))}
          />
          <Tooltip
            contentStyle={{
              background: "rgba(17,17,23,0.95)",
              border: "1px solid rgba(148,163,184,0.2)",
              borderRadius: 8,
              fontSize: 12,
            }}
            labelStyle={{ color: "#e5e7eb" }}
            labelFormatter={(v) => `${plot.xLabel || "x"} = ${fmtNum(Number(v))}`}
            formatter={(value, name) => [fmtNum(Number(value)), String(name)]}
          />
          {plot.series.map((s, i) => (
            <Line
              key={i}
              type="monotone"
              dataKey={`y${i}`}
              name={s.name}
              stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      {plot.series.length > 1 && (
        <div className="mt-1.5 flex flex-wrap gap-3">
          {plot.series.map((s, i) => (
            <span key={i} className="inline-flex items-center gap-1.5 text-2xs text-text-muted">
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }}
              />
              {s.name}
            </span>
          ))}
        </div>
      )}
      <span className="sr-only">{t("chat.inlinePlot.title")}</span>
    </figure>
  );
}
