/**
 * Inline matrix for ```pnyxy-matrix blocks in AI replies (parsed by
 * extract-matrix.ts). Renders the grid with the usual big square
 * brackets, monospace right-aligned numbers, and an optional name
 * (A =). Read-only; wraps in a horizontal scroller so a wide matrix
 * never breaks the bubble layout.
 */
import type { InlineMatrix } from "@/lib/ai/extract-matrix";

const fmtCell = (v: number): string => {
  const r = Math.round(v * 1000) / 1000;
  return String(r);
};

export function InlineMatrixCard({ matrix }: { matrix: InlineMatrix }) {
  return (
    <div className="mt-2 overflow-x-auto rounded-panel border border-glass-border bg-glass-bg p-3">
      <div className="flex items-center gap-2">
        {matrix.name && (
          <span className="font-mono text-sm text-text-primary">
            {matrix.name} =
          </span>
        )}
        {/* left bracket */}
        <span
          aria-hidden="true"
          className="self-stretch border-y-2 border-l-2 border-text-muted"
          style={{ width: 6 }}
        />
        <table className="border-separate" style={{ borderSpacing: "0.4rem 0.15rem" }}>
          <tbody>
            {matrix.rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td
                    key={c}
                    className="text-right font-mono text-sm tabular-nums text-text-primary"
                  >
                    {fmtCell(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {/* right bracket */}
        <span
          aria-hidden="true"
          className="self-stretch border-y-2 border-r-2 border-text-muted"
          style={{ width: 6 }}
        />
      </div>
    </div>
  );
}
