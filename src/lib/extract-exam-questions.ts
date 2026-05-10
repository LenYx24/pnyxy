import { streamChatResponse } from "@/lib/ai-client";

export interface ExtractedQuestion {
  /** 1-based position in the exam — handy for "Question N of M" UI. */
  id: number;
  text: string;
}

/** Soft cap. Exams are usually 5–12 questions; pull a few extra so the
 *  practice flow has enough material before re-extracting. */
const MAX_QUESTIONS = 15;

const SYSTEM_PROMPT = `You read an exam paper and extract its distinct questions for a student practice session.

Output ONLY valid JSON in this exact shape — no prose, no markdown fences, no commentary:

{ "questions": [ "question 1 text", "question 2 text", … ] }

Rules:
- 3 to ${MAX_QUESTIONS} questions.
- Each entry is the FULL question text the student needs to answer. Combine multi-part stems (a, b, c) into ONE entry only if they share the same setup; otherwise list them separately.
- For multiple-choice items, KEEP the question stem AND list the options in the same string (so the student can answer "B" or write reasoning).
- Use the SAME LANGUAGE as the exam.
- Skip pure boilerplate (instructions like "use a pencil", point allocations, question numbers).
- If the document has no clear questions, return { "questions": [] }.`;

/**
 * Pulls a flat list of questions out of the exam text. Mirrors the
 * `extract-flashcards.ts` shape: streamed completion → JSON parse →
 * shape-validate → return. The caller handles errors as a one-shot
 * "couldn't parse the exam, want to retry?" surface.
 */
export async function extractExamQuestions(
  examText: string,
): Promise<ExtractedQuestion[]> {
  const trimmed = examText.trim();
  if (trimmed.length < 80) return [];

  let buf = "";
  for await (const chunk of streamChatResponse(
    [{ role: "user", content: trimmed }],
    "",
    "",
    {
      systemPromptOverride: SYSTEM_PROMPT,
      maxOutputTokens: 1500,
    },
  )) {
    buf += chunk.delta;
  }

  const cleaned = buf
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error("exam-questions:parse-failed");
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !Array.isArray((parsed as { questions?: unknown }).questions)
  ) {
    throw new Error("exam-questions:bad-shape");
  }
  return (parsed as { questions: unknown[] }).questions
    .map((q, i): ExtractedQuestion | null => {
      if (typeof q !== "string") return null;
      const text = q.trim();
      if (!text) return null;
      return { id: i + 1, text };
    })
    .filter((q): q is ExtractedQuestion => q !== null)
    .slice(0, MAX_QUESTIONS);
}
