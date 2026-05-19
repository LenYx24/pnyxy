import { streamChatResponse } from "@/lib/ai/ai-client";

/**
 * Shared pipeline for "ask the LLM for a JSON array, parse it, return
 * a typed list" features. Replaces the copy-paste pattern in
 * `extract-flashcards`, `extract-exam-questions`, `extract-exam-
 * topics`, and any future AI extractor that needs the same flow:
 *
 *   trim + length check → stream the model → strip ```json fences →
 *   JSON.parse → pluck the array from the wrapper object → coerce
 *   each entry into the domain type → drop nulls → slice to cap.
 *
 * The three pre-existing extractors each baked the same six steps
 * inline, which made adding a new field (e.g. abort signal, output
 * cap, language hint) a four-place change. This wrapper makes new
 * extractors a ~20-line declarative spec.
 *
 * Errors are thrown as plain `Error(`<label>:<reason>`)` to keep the
 * existing call-site failure messages identical — the UI's modal
 * "couldn't parse the response, try again" wording reads the label
 * prefix.
 */
export interface AiJsonExtractOptions<T> {
  /** Source text the model reads. Trimmed before length-check and
   *  before being sent. */
  passage: string;
  /** Full system prompt — what shape to output, what rules to follow.
   *  Caller owns the prompt; this wrapper is shape-agnostic. */
  systemPrompt: string;
  /** Minimum trimmed input length to bother prompting at all. Below
   *  this we early-return []. Defaults to 40 (the flashcard
   *  extractor's original threshold). */
  minPassageLength?: number;
  /** Provider-side max output token cap. Defaults to 1500, which
   *  comfortably covers 10–15 medium-sized JSON entries. */
  maxOutputTokens?: number;
  /** Pluck the array from the parsed root. Throw any Error if the
   *  shape doesn't match (the wrapper turns it into
   *  `<errorLabel>:bad-shape`). Typical body:
   *    `if (!parsed || typeof parsed !== "object") throw new Error();
   *     return (parsed as { items?: unknown }).items;`
   */
  pickArray: (parsed: unknown) => unknown;
  /** Convert one raw element into a domain entity, or return null to
   *  drop it. `index` is the position within the picked array — used
   *  e.g. by the exam-questions extractor to assign 1-based IDs. */
  coerce: (raw: unknown, index: number) => T | null;
  /** Hard cap on returned entries — useful when the model
   *  over-produces. Defaults to no cap (returns everything that
   *  passes `coerce`). */
  maxItems?: number;
  /** Label used in thrown error codes
   *  (`<label>:parse-failed`, `<label>:bad-shape`). Match the
   *  existing UI handling string the caller's surface already keys
   *  off of. */
  errorLabel: string;
}

function stripCodeFences(buf: string): string {
  return buf
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
}

export async function aiJsonExtract<T>(
  opts: AiJsonExtractOptions<T>,
): Promise<T[]> {
  const trimmed = opts.passage.trim();
  const minLen = opts.minPassageLength ?? 40;
  if (trimmed.length < minLen) return [];

  let buf = "";
  for await (const chunk of streamChatResponse(
    [{ role: "user", content: trimmed }],
    "",
    "",
    {
      systemPromptOverride: opts.systemPrompt,
      maxOutputTokens: opts.maxOutputTokens ?? 1500,
    },
  )) {
    buf += chunk.delta;
  }

  const cleaned = stripCodeFences(buf);

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`${opts.errorLabel}:parse-failed`);
  }

  let rawItems: unknown;
  try {
    rawItems = opts.pickArray(parsed);
  } catch {
    throw new Error(`${opts.errorLabel}:bad-shape`);
  }
  if (!Array.isArray(rawItems)) {
    throw new Error(`${opts.errorLabel}:bad-shape`);
  }

  const cap = opts.maxItems ?? Number.POSITIVE_INFINITY;
  const out: T[] = [];
  for (let i = 0; i < rawItems.length && out.length < cap; i++) {
    const coerced = opts.coerce(rawItems[i], i);
    if (coerced !== null) out.push(coerced);
  }
  return out;
}
