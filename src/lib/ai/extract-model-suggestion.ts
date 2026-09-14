/**
 * Parser for AI-emitted cross-model suggestion blocks
 * (```pnyxy-suggest-model fenced JSON). Mirrors extract-quiz.ts: pure
 * .ts module, silent about mid-stream partial JSON, and it strips an
 * UNTERMINATED fence so streaming never flashes raw JSON in the prose.
 *
 * On the free auto-routed tier a cheap model answers by default; when a
 * task clearly needs more capability the model may append this block to
 * offer redoing the answer on a stronger Pnyxy model. The prompt-side
 * contract lives server-owned in the ai-chat-proxy (the free route's
 * system prompt); this is only the client-side reader for the streamed
 * result. `model` is left lenient here, the renderer validates it
 * against the real pin list (PNYXY_MODEL_OPTIONS) and shows nothing for
 * an unknown id.
 */

export interface ModelSuggestion {
  /** Target Pnyxy model id to retry on (validated by the renderer). */
  model: string;
  /** One short sentence, in the user's language, on why it would help. */
  reason: string;
}

interface ExtractResult {
  cleaned: string;
  suggestion?: ModelSuggestion;
  /** An opened fence with no closer yet (still streaming). */
  pending?: boolean;
}

const FENCE = /```pnyxy-suggest-model\s*([\s\S]*?)```/i;
const OPEN_FENCE = /```pnyxy-suggest-model\s*[\s\S]*$/i;

export function extractModelSuggestion(content: string): ExtractResult {
  const match = content.match(FENCE);
  if (match) {
    const cleaned = content.replace(FENCE, "").trim();
    try {
      const suggestion = coerce(JSON.parse(match[1].trim()));
      return suggestion ? { cleaned, suggestion } : { cleaned };
    } catch {
      // malformed JSON in a closed fence: drop the block, keep the prose
      return { cleaned };
    }
  }
  const open = content.match(OPEN_FENCE);
  if (open) {
    return { cleaned: content.replace(OPEN_FENCE, "").trim(), pending: true };
  }
  return { cleaned: content };
}

function coerce(raw: unknown): ModelSuggestion | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const model = typeof r.model === "string" ? r.model.trim() : "";
  const reason = typeof r.reason === "string" ? r.reason.trim() : "";
  if (!model) return null;
  return { model, reason };
}
