/**
 * Parser for AI-emitted matrix blocks (```pnyxy-matrix fenced JSON).
 * Mirrors extract-quiz.ts: pure .ts module, silent about mid-stream
 * partial JSON, strips an UNTERMINATED fence so streaming never flashes
 * raw JSON. The prompt contract (MATRIX_SPEC) is always on, so the model
 * volunteers a matrix when it clearly reads better than inline numbers.
 */

export interface InlineMatrix {
  name: string;
  /** Rectangular grid; every row has the same length as the first. */
  rows: number[][];
}

interface ExtractMatrixResult {
  cleaned: string;
  matrix?: InlineMatrix;
  pending?: boolean;
}

const FENCE = /```pnyxy-matrix\s*([\s\S]*?)```/i;
const OPEN_FENCE = /```pnyxy-matrix\s*[\s\S]*$/i;

export { MATRIX_SPEC } from "./chat-prompts";

export function extractInlineMatrix(content: string): ExtractMatrixResult {
  const match = content.match(FENCE);
  if (match) {
    const cleaned = content.replace(FENCE, "").trim();
    try {
      const matrix = coerce(JSON.parse(match[1].trim()));
      return matrix ? { cleaned, matrix } : { cleaned };
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

function coerce(raw: unknown): InlineMatrix | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.rows) || r.rows.length === 0) return null;
  const rows: number[][] = [];
  let width = -1;
  for (const row of r.rows) {
    if (!Array.isArray(row)) return null;
    const cells = row.filter(
      (c): c is number => typeof c === "number" && Number.isFinite(c),
    );
    if (cells.length !== row.length) return null; // non-numeric cell
    if (width === -1) width = cells.length;
    if (cells.length !== width || width === 0) return null; // ragged/empty
    rows.push(cells);
  }
  if (rows.length === 0) return null;
  return {
    name: typeof r.name === "string" ? r.name.trim() : "",
    rows,
  };
}
