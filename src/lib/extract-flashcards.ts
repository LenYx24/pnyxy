import { streamChatResponse } from "@/lib/ai-client";

/**
 * One Q/A pair the user can save as a short-answer quiz question.
 * Kept in this lightweight shape so the UI can edit + drop entries
 * before they hit the quiz store.
 */
export interface FlashcardDraft {
  question: string;
  answer: string;
}

const SYSTEM_PROMPT = `You extract study flashcards from a passage of text.

Output ONLY valid JSON in this exact shape, no preamble, no markdown fence, no commentary:

{ "cards": [ { "question": "…", "answer": "…" }, … ] }

Rules:
- 3 to 8 cards.
- Question: short, specific, answerable from the passage. Avoid yes/no.
- Answer: concise (one sentence or fewer), in the user's reading language.
- Skip cards if the passage is too short or has no testable content — return { "cards": [] }.
- Each card stands alone (no "the above" / "according to the text").`;

/**
 * Run the assistant message through an extractor LLM call and return
 * a structured list of flashcards. Fails-loudly on JSON parse errors
 * (callers show an error state); a retry helper is intentionally not
 * baked in — the UI can let the user click "try again".
 */
export async function extractFlashcards(
  passage: string,
): Promise<FlashcardDraft[]> {
  const trimmed = passage.trim();
  if (trimmed.length < 40) return [];

  let buf = "";
  for await (const chunk of streamChatResponse(
    [{ role: "user", content: trimmed }],
    "",
    "",
    {
      systemPromptOverride: SYSTEM_PROMPT,
      // Cap so a chatty model can't run away — typical extractor
      // output for 8 cards lands well under 500 tokens.
      maxOutputTokens: 800,
    },
  )) {
    buf += chunk.delta;
  }

  // Some models still wrap the response in ```json … ``` despite the
  // instruction. Strip a leading fence if present.
  const cleaned = buf
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error("flashcard-extract:parse-failed");
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !Array.isArray((parsed as { cards?: unknown }).cards)
  ) {
    throw new Error("flashcard-extract:bad-shape");
  }

  const cards = (parsed as { cards: unknown[] }).cards
    .map((c): FlashcardDraft | null => {
      if (!c || typeof c !== "object") return null;
      const q = (c as { question?: unknown }).question;
      const a = (c as { answer?: unknown }).answer;
      if (typeof q !== "string" || typeof a !== "string") return null;
      const question = q.trim();
      const answer = a.trim();
      if (!question || !answer) return null;
      return { question, answer };
    })
    .filter((c): c is FlashcardDraft => c !== null);

  return cards;
}
