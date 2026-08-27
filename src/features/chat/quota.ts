/**
 * Pure helpers for the Pnyxy daily AI quota read-out (composer footer,
 * model picker, quota modal). Everything here mirrors the proxy's
 * routing (supabase/functions/ai-chat-proxy/index.ts) and the
 * `get_my_ai_usage_today` RPC row shape so the numbers the user sees
 * are the numbers the proxy bills against. No React, no I/O, so the
 * selection/formatting logic is unit-testable.
 */

/** One row of `get_my_ai_usage_today()`. Buckets reset at UTC midnight. */
export interface PnyxyQuotaRow {
  model: string;
  tokens_used: number;
  request_count: number;
  tokens_limit: number;
  request_limit: number;
}

// Free-tier models. Picking one pins the proxy to it instead of auto-routing.
// ids must match `_ai_usage_limits_for_model` on the SQL side.
export const PNYXY_MODEL_OPTIONS: ReadonlyArray<{
  id: string;
  label: string;
  costTier: "cheap" | "mid" | "premium";
  tagline: string;
}> = [
  {
    // quality-first auto route starts here (same model as the Gemini webapp)
    id: "gemini-3.7-flash",
    label: "Gemini 3.7 Flash",
    costTier: "mid",
    tagline: "Newest Google model · auto-route default",
  },
  {
    id: "gemini-3.6-flash",
    label: "Gemini 3.6 Flash",
    costTier: "cheap",
    tagline: "Step-down when 3.7 runs dry",
  },
  {
    id: "gemini-3.5-flash-lite",
    label: "Gemini 3.5 Flash-Lite",
    costTier: "cheap",
    tagline: "Cheap reserve · background tasks",
  },
  {
    id: "gpt-4o-mini",
    label: "GPT-4o mini",
    costTier: "mid",
    tagline: "General-purpose fallback",
  },
  {
    id: "claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    costTier: "premium",
    tagline: "Higher quality · used for quiz/roadmap",
  },
];

// Quota reference model when nothing is pinned: the quality-first auto
// route bills 3.7 Flash first in both modes. The footer has to read
// whichever row the proxy actually records or it sits permanently at 0.
export const QUOTA_AUTO_DEFAULT_MODEL = "gemini-3.7-flash";
export const QUOTA_AUTO_GROUNDED_MODEL = "gemini-3.7-flash";

/** The proxy's auto-route order (OPENAI_COMPATIBLE_PROVIDERS, then the
 *  Anthropic fallback). A bucket that is exhausted is skipped to the
 *  next one, so "questions left" on the auto route has to walk it. */
export const AUTO_ROUTE_CHAIN: ReadonlyArray<string> = [
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite",
  "gpt-4o-mini",
  "claude-haiku-4-5",
];

/** Rough tokens billed per turn when the user has no history today yet.
 *  The proxy pre-bills estimated input + maxOutputTokens (default 4096,
 *  see DEFAULT_MAX_OUTPUT_TOKENS in ai-client.ts and the proxy) and
 *  refunds the unused part after the stream, so the actual average is
 *  well under the ceiling; 2000 still reads as a reasonable per-turn
 *  estimate and is kept as-is. */
export const DEFAULT_TURN_TOKENS = 2000;

/** Model id the proxy will bill first for the next turn. */
export function predictBilledModel(pinnedModel: string | null): string {
  return pinnedModel ?? QUOTA_AUTO_DEFAULT_MODEL;
}

/** True when either bucket (tokens or requests) is at or over its cap. */
export function isRowExhausted(row: PnyxyQuotaRow): boolean {
  const tokensOut = row.tokens_limit > 0 && row.tokens_used >= row.tokens_limit;
  const requestsOut =
    row.request_limit > 0 && row.request_count >= row.request_limit;
  return tokensOut || requestsOut;
}

/** Higher of the two usage ratios, 0 when a limit is missing or zero
 *  (never NaN / Infinity). Clamped to [0, 1]. */
export function usageRatio(row: PnyxyQuotaRow | null | undefined): number {
  if (!row) return 0;
  const tokensRatio =
    row.tokens_limit > 0 ? row.tokens_used / row.tokens_limit : 0;
  const requestsRatio =
    row.request_limit > 0 ? row.request_count / row.request_limit : 0;
  const r = Math.max(tokensRatio, requestsRatio);
  return Number.isFinite(r) ? Math.min(1, Math.max(0, r)) : 0;
}

/**
 * How many more questions the row can take today. Both buckets bind:
 * the request cap directly, the token cap via the average tokens the
 * user's turns cost so far today (or DEFAULT_TURN_TOKENS before the
 * first turn).
 */
export function questionsLeft(row: PnyxyQuotaRow | null | undefined): number {
  if (!row) return 0;
  const requestsLeft = Math.max(0, row.request_limit - row.request_count);
  if (row.tokens_limit <= 0) return requestsLeft;
  const tokensLeft = Math.max(0, row.tokens_limit - row.tokens_used);
  if (tokensLeft <= 0) return 0;
  const perTurn =
    row.request_count > 0 && row.tokens_used > 0
      ? row.tokens_used / row.request_count
      : DEFAULT_TURN_TOKENS;
  const byTokens = Math.floor(tokensLeft / Math.max(1, perTurn));
  return Math.max(0, Math.min(requestsLeft, byTokens));
}

export interface QuotaSelection {
  /** The row the footer should show, or null when no row matches. */
  row: PnyxyQuotaRow | null;
  /** Model id of `row` (predicted model when no row exists). */
  model: string;
  /** True when the predicted bucket is exhausted and the auto-route
   *  would land on `model` instead. */
  fellThrough: boolean;
}

/**
 * Pick the quota row that governs the next turn. A pinned model never
 * falls through (the proxy narrows the chain to it). On the auto route
 * the predicted bucket is used while it has room; once it is exhausted
 * the proxy moves on to the next model in chain order, so we do too.
 */
export function selectQuotaRow(
  rows: ReadonlyArray<PnyxyQuotaRow>,
  opts: {
    pinnedModel: string | null;
    /** Model the proxy reported for the last served turn, if any. */
    servedModel?: string | null;
  },
): QuotaSelection {
  const predicted = predictBilledModel(opts.pinnedModel);
  const byModel = new Map(rows.map((r) => [r.model, r] as const));
  const predictedRow = byModel.get(predicted) ?? null;
  if (opts.pinnedModel) {
    return { row: predictedRow, model: predicted, fellThrough: false };
  }
  // the proxy told us where the last turn actually landed: trust it over
  // the prediction while that bucket still has room
  const served = opts.servedModel ?? null;
  if (served && served !== predicted) {
    const r = byModel.get(served);
    if (r && !isRowExhausted(r)) return { row: r, model: served, fellThrough: true };
  }
  if (!predictedRow || !isRowExhausted(predictedRow)) {
    return { row: predictedRow, model: predicted, fellThrough: false };
  }
  // predicted bucket is exhausted: walk the rest of the auto-route chain
  const order = [predicted, ...AUTO_ROUTE_CHAIN.filter((m) => m !== predicted)];
  for (const m of order) {
    const r = byModel.get(m);
    if (r && !isRowExhausted(r)) return { row: r, model: m, fellThrough: true };
  }
  return { row: predictedRow, model: predicted, fellThrough: false };
}

/** The RPC keys usage on `(now() AT TIME ZONE 'utc')::date`, so every
 *  bucket resets at the next UTC midnight, not the user's local one. */
export function nextUtcMidnight(now: Date = new Date()): Date {
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1,
      0,
      0,
      0,
      0,
    ),
  );
}

/** Display label for a model id (falls back to the raw id). */
export function modelLabel(modelId: string): string {
  return PNYXY_MODEL_OPTIONS.find((m) => m.id === modelId)?.label ?? modelId;
}
