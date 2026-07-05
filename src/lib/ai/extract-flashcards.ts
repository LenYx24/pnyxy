import { aiJsonExtract } from "@/lib/ai/ai-json-extract";

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
 * baked in, the UI can let the user click "try again".
 */
export async function extractFlashcards(
  passage: string,
): Promise<FlashcardDraft[]> {
  return aiJsonExtract<FlashcardDraft>({
    passage,
    systemPrompt: SYSTEM_PROMPT,
    minPassageLength: 40,
    // Typical extractor output for 8 cards lands well under 500
    // tokens; cap leaves headroom for a verbose model.
    maxOutputTokens: 800,
    errorLabel: "flashcard-extract",
    pickArray: (parsed) => {
      if (!parsed || typeof parsed !== "object") throw new Error();
      return (parsed as { cards?: unknown }).cards;
    },
    coerce: (raw) => {
      if (!raw || typeof raw !== "object") return null;
      const q = (raw as { question?: unknown }).question;
      const a = (raw as { answer?: unknown }).answer;
      if (typeof q !== "string" || typeof a !== "string") return null;
      const question = q.trim();
      const answer = a.trim();
      if (!question || !answer) return null;
      return { question, answer };
    },
  });
}
