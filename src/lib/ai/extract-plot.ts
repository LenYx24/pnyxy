/**
 * Parser for AI-emitted function-plot blocks (```pnyxy-plot fenced JSON).
 * Mirrors extract-quiz.ts: pure .ts module, silent about mid-stream
 * partial JSON, strips an UNTERMINATED fence so streaming never flashes
 * raw JSON in the prose (the card shows a "plotting…" hint from
 * `pending` instead).
 *
 * The model samples the function itself into (x, y) points, there is NO
 * client-side expression evaluation, so a plot can never run arbitrary
 * math the model wrote. The prompt contract (PLOT_SPEC) is always on,
 * like the quiz spec, so the model volunteers a plot when it clearly
 * helps (a function, a data trend).
 */

export interface PlotSeries {
  name: string;
  /** Sampled points, ascending x. */
  points: Array<{ x: number; y: number }>;
}

export interface InlinePlot {
  title: string;
  xLabel: string;
  yLabel: string;
  series: PlotSeries[];
}

interface ExtractPlotResult {
  cleaned: string;
  plot?: InlinePlot;
  pending?: boolean;
}

const FENCE = /```pnyxy-plot\s*([\s\S]*?)```/i;
const OPEN_FENCE = /```pnyxy-plot\s*[\s\S]*$/i;

/** Prompt-side contract, appended to the default chat prompts (the proxy
 *  carries its own copy for the free route, keep in sync). */
export const PLOT_SPEC = `When a function or a numeric trend would be clearer as a chart than as prose (plotting y = f(x), comparing curves, showing how a quantity changes), draw it as a fenced code block tagged \`pnyxy-plot\` containing ONLY JSON in this exact shape:
\`\`\`pnyxy-plot
{"title": "…", "xLabel": "x", "yLabel": "y", "series": [{"name": "sin(x)", "points": [{"x": 0, "y": 0}, {"x": 1.57, "y": 1}]}]}
\`\`\`
Sample the function YOURSELF into 20-60 ascending (x, y) points per series (there is no formula evaluation on the client); use 1-3 series. Keep numbers finite. Briefly say in the prose what the plot shows; put no other text inside the block. Only plot when it genuinely aids understanding, most replies need no plot.`;

export function extractInlinePlot(content: string): ExtractPlotResult {
  const match = content.match(FENCE);
  if (match) {
    const cleaned = content.replace(FENCE, "").trim();
    try {
      const plot = coerce(JSON.parse(match[1].trim()));
      return plot ? { cleaned, plot } : { cleaned };
    } catch {
      return { cleaned };
    }
  }
  const open = content.match(OPEN_FENCE);
  if (open) {
    return { cleaned: content.replace(OPEN_FENCE, "").trim(), pending: true };
  }
  return { cleaned: content };
}

function coerce(raw: unknown): InlinePlot | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.series)) return null;
  const series: PlotSeries[] = [];
  for (const entry of r.series) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    if (!Array.isArray(e.points)) continue;
    const points: Array<{ x: number; y: number }> = [];
    for (const p of e.points) {
      // accept both {x,y} objects and [x,y] tuples
      let x: unknown;
      let y: unknown;
      if (Array.isArray(p)) {
        [x, y] = p;
      } else if (p && typeof p === "object") {
        x = (p as Record<string, unknown>).x;
        y = (p as Record<string, unknown>).y;
      }
      if (
        typeof x === "number" &&
        typeof y === "number" &&
        Number.isFinite(x) &&
        Number.isFinite(y)
      ) {
        points.push({ x, y });
      }
    }
    if (points.length < 2) continue;
    series.push({
      name: typeof e.name === "string" && e.name.trim() ? e.name.trim() : "y",
      points,
    });
  }
  if (series.length === 0) return null;
  return {
    title: typeof r.title === "string" ? r.title.trim() : "",
    xLabel: typeof r.xLabel === "string" ? r.xLabel.trim() : "x",
    yLabel: typeof r.yLabel === "string" ? r.yLabel.trim() : "y",
    series,
  };
}
