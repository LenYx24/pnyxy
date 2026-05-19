import { streamChatResponse, AiProviderError } from "@/lib/ai/ai-client";
import type { QuizQuestionDraft } from "@/types/quiz";

export const MIN_QUIZ_QUESTIONS = 1;
export const MAX_QUIZ_QUESTIONS = 15;
export const MAX_SOURCE_CHARS = 16_000;

function buildQuizSystemPrompt(count: number): string {
  return `You generate multiple-choice quiz questions from a source text.

Output EXACTLY a JSON array — no prose, no markdown fences, no commentary.

Each element must be an object with these keys and only these keys:
- "question_text": string (the question itself, no leading numbering)
- "option_a": string
- "option_b": string
- "option_c": string
- "option_d": string
- "correct_index": integer, 0..3 (0 = option_a, 1 = option_b, 2 = option_c, 3 = option_d)
- "explanation": string (one sentence on why the correct answer is right)

Rules:
- Produce exactly ${count} question(s).
- Every question must be answerable from the source text alone.
- Vary which option is correct; don't let the answer always be option A.
- Keep the four options roughly similar in length and grammatical form.
- Wrong options should be plausible distractors, not obviously absurd.
- Do not include metadata, markdown, headings, or explanatory text outside the JSON array.`;
}

function buildFlashcardSystemPrompt(count: number): string {
  return `You generate short-answer study flashcards from a source text.

Output EXACTLY a JSON array — no prose, no markdown fences, no commentary.

Each element must be an object with these keys and only these keys:
- "question_text": string (the question itself, no leading numbering)
- "correct_text": string (the short, specific answer — one sentence or fewer)
- "explanation": string OR omitted (optional context one sentence long)

Rules:
- Produce exactly ${count} card(s).
- Each card stands alone — no "the above" / "as in the passage".
- Avoid yes/no questions.
- Answers must be directly supported by the source text.
- Do not include any field other than the three above.`;
}

function buildQuizUserPrompt(sourceText: string): string {
  return `Source text:\n\n---\n${sourceText}\n---`;
}

/** One question in the raw LLM response, before validation. */
interface RawQuestion {
  question_text?: unknown;
  option_a?: unknown;
  option_b?: unknown;
  option_c?: unknown;
  option_d?: unknown;
  correct_index?: unknown;
  correct_text?: unknown;
  explanation?: unknown;
}

/** Generator output kind. "mcq4" → 4-option multi-choice; "short_answer"
 *  → flashcard-style Q/A pair (free-form short answer). */
export type GenerateKind = "mcq4" | "short_answer";

export type QuizGenerationErrorKind =
  | "empty_source"
  | "count_out_of_range"
  | "no_response"
  | "parse_failed"
  | "shape_invalid"
  | "provider_error";

export class QuizGenerationError extends Error {
  readonly kind: QuizGenerationErrorKind;
  readonly cause?: unknown;

  constructor(message: string, kind: QuizGenerationErrorKind, cause?: unknown) {
    super(message);
    this.name = "QuizGenerationError";
    this.kind = kind;
    this.cause = cause;
  }
}

function stripCodeFences(text: string): string {
  let out = text.trim();
  // Model sometimes wraps output in ```json … ``` despite being told not to.
  if (out.startsWith("```")) {
    out = out.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  }
  // If there's any prose around the array, try to slice from the first `[`
  // to the matching final `]`.
  const first = out.indexOf("[");
  const last = out.lastIndexOf("]");
  if (first !== -1 && last !== -1 && last > first) {
    out = out.slice(first, last + 1);
  }
  return out.trim();
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function validateQuestions(
  raw: unknown,
  kind: GenerateKind,
): QuizQuestionDraft[] {
  if (!Array.isArray(raw)) {
    throw new QuizGenerationError(
      "AI response was not a JSON array.",
      "shape_invalid",
    );
  }
  const out: QuizQuestionDraft[] = [];
  for (const entry of raw as RawQuestion[]) {
    if (kind === "mcq4") {
      if (
        !isNonEmptyString(entry.question_text) ||
        !isNonEmptyString(entry.option_a) ||
        !isNonEmptyString(entry.option_b) ||
        !isNonEmptyString(entry.option_c) ||
        !isNonEmptyString(entry.option_d)
      ) {
        throw new QuizGenerationError(
          "A generated question is missing text or options.",
          "shape_invalid",
        );
      }
      const idx = entry.correct_index;
      if (
        typeof idx !== "number" ||
        !Number.isInteger(idx) ||
        idx < 0 ||
        idx > 3
      ) {
        throw new QuizGenerationError(
          "A generated question had an invalid correct_index.",
          "shape_invalid",
        );
      }
      out.push({
        kind: "mcq4",
        question_text: entry.question_text.trim(),
        option_a: entry.option_a.trim(),
        option_b: entry.option_b.trim(),
        option_c: entry.option_c.trim(),
        option_d: entry.option_d.trim(),
        correct_index: idx,
        correct_text: "",
        explanation:
          typeof entry.explanation === "string" && entry.explanation.trim()
            ? entry.explanation.trim()
            : null,
      });
    } else {
      // short_answer — flashcard-style.
      if (
        !isNonEmptyString(entry.question_text) ||
        !isNonEmptyString(entry.correct_text)
      ) {
        throw new QuizGenerationError(
          "A generated flashcard is missing the question or answer.",
          "shape_invalid",
        );
      }
      out.push({
        kind: "short_answer",
        question_text: entry.question_text.trim(),
        option_a: "",
        option_b: "",
        option_c: "",
        option_d: "",
        correct_index: 0,
        correct_text: entry.correct_text.trim(),
        explanation:
          typeof entry.explanation === "string" && entry.explanation.trim()
            ? entry.explanation.trim()
            : null,
      });
    }
  }
  if (out.length === 0) {
    throw new QuizGenerationError(
      "AI returned zero questions.",
      "shape_invalid",
    );
  }
  return out;
}

export async function generateQuizQuestions(args: {
  sourceText: string;
  count: number;
  /** What flavour of draft to produce. Defaults to multi-choice so
   *  existing callers (legacy AiGeneratePanel invocation) keep their
   *  behaviour. "short_answer" routes through a flashcard-style
   *  prompt + validator so the Q/A pairs map cleanly into the same
   *  `quizzes` + `quiz_questions` tables (kind="short_answer"). */
  kind?: GenerateKind;
  signal?: AbortSignal;
}): Promise<QuizQuestionDraft[]> {
  const { sourceText, count, signal } = args;
  const kind: GenerateKind = args.kind ?? "mcq4";

  const trimmedSource = sourceText.trim();
  if (!trimmedSource) {
    throw new QuizGenerationError(
      "Paste or type source text to generate from.",
      "empty_source",
    );
  }
  if (count < MIN_QUIZ_QUESTIONS || count > MAX_QUIZ_QUESTIONS) {
    throw new QuizGenerationError(
      `Question count must be between ${MIN_QUIZ_QUESTIONS} and ${MAX_QUIZ_QUESTIONS}.`,
      "count_out_of_range",
    );
  }

  // Cap source length to keep the upstream prompt under provider limits.
  const clippedSource =
    trimmedSource.length > MAX_SOURCE_CHARS
      ? trimmedSource.slice(0, MAX_SOURCE_CHARS)
      : trimmedSource;

  const systemPrompt =
    kind === "short_answer"
      ? buildFlashcardSystemPrompt(count)
      : buildQuizSystemPrompt(count);
  const userPrompt = buildQuizUserPrompt(clippedSource);

  let full = "";
  try {
    for await (const { delta } of streamChatResponse(
      [{ role: "user", content: userPrompt }],
      "Quiz source",
      "",
      {
        systemPromptOverride: systemPrompt,
        // Allow room for ~15 questions with explanations.
        maxOutputTokens: 4096,
      },
    )) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      full += delta;
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    if (err instanceof AiProviderError) {
      throw new QuizGenerationError(err.message, "provider_error", err);
    }
    throw new QuizGenerationError(
      err instanceof Error ? err.message : "AI request failed.",
      "provider_error",
      err,
    );
  }

  if (!full.trim()) {
    throw new QuizGenerationError(
      "AI returned an empty response.",
      "no_response",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFences(full));
  } catch (err) {
    throw new QuizGenerationError(
      "Couldn't parse the AI response as JSON. Try again with a shorter source or a different provider.",
      "parse_failed",
      err,
    );
  }

  return validateQuestions(parsed, kind);
}
