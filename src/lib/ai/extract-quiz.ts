/**
 * Parser for AI-emitted inline quiz blocks (```quiz fenced JSON).
 * Mirrors extract-recommendations.ts: pure .ts module, silent about
 * mid-stream partial JSON, and it also strips an UNTERMINATED fence so
 * streaming never shows raw JSON in the prose (the card renderer shows
 * a "quiz incoming" hint from `pending` instead).
 */

export interface InlineQuizQuestion {
  q: string;
  options: string[];
  /** zero-based index into options */
  correct: number;
  explanation: string | null;
}

export interface InlineQuiz {
  title: string;
  questions: InlineQuizQuestion[];
}

interface ExtractQuizResult {
  cleaned: string;
  quiz?: InlineQuiz;
  /** An opened ```quiz fence with no closer yet (still streaming). */
  pending?: boolean;
}

const QUIZ_FENCE = /```quiz\s*([\s\S]*?)```/i;
const OPEN_QUIZ_FENCE = /```quiz\s*[\s\S]*$/i;

/** Prompt-side contract, appended to the default system prompts (the
 *  proxy carries its own copy, keep in sync). */
export const INLINE_QUIZ_SPEC = `When the user asks to be quizzed, or a quick knowledge check would clearly help, emit the quiz as a fenced code block tagged \`quiz\` containing ONLY JSON in this exact shape:
\`\`\`quiz
{"title": "…", "questions": [{"q": "…", "options": ["…", "…", "…", "…"], "correct": 1, "explanation": "…"}]}
\`\`\`
3-8 questions, 2-4 options each, "correct" is the zero-based index of the right option. Write the quiz in the user's language; when you have document context, cite pages in the explanations ([p.N]). Put no other text inside the block, and never reveal the answers in the prose around it.`;

export function extractInlineQuiz(content: string): ExtractQuizResult {
  const match = content.match(QUIZ_FENCE);
  if (match) {
    const cleaned = content.replace(QUIZ_FENCE, "").trim();
    try {
      const quiz = coerceQuiz(JSON.parse(match[1].trim()));
      return quiz ? { cleaned, quiz } : { cleaned };
    } catch {
      // malformed JSON in a closed fence: drop the block, keep the prose
      return { cleaned };
    }
  }
  const open = content.match(OPEN_QUIZ_FENCE);
  if (open) {
    return { cleaned: content.replace(OPEN_QUIZ_FENCE, "").trim(), pending: true };
  }
  return { cleaned: content };
}

function coerceQuiz(raw: unknown): InlineQuiz | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.questions)) return null;
  const questions: InlineQuizQuestion[] = [];
  for (const entry of r.questions) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const options = Array.isArray(e.options)
      ? e.options.filter((o): o is string => typeof o === "string").slice(0, 4)
      : [];
    const correct = typeof e.correct === "number" ? e.correct : NaN;
    if (
      typeof e.q !== "string" ||
      options.length < 2 ||
      !Number.isInteger(correct) ||
      correct < 0 ||
      correct >= options.length
    ) {
      continue;
    }
    questions.push({
      q: e.q.trim(),
      options,
      correct,
      explanation:
        typeof e.explanation === "string" && e.explanation.trim()
          ? e.explanation.trim()
          : null,
    });
  }
  if (questions.length === 0) return null;
  return {
    title: typeof r.title === "string" && r.title.trim() ? r.title.trim() : "",
    questions,
  };
}
