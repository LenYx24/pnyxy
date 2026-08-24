import { streamChatResponse } from "@/lib/ai/ai-client";

const MAX_EXAM_CONTEXT_CHARS = 8_000;

/** Streamed Socratic feedback for a student's practice answer.
 *
 * Pedagogical contract, written into the system prompt:
 *   - DO NOT just hand over the full solution. The Bastani et al.
 *     PNAS 2025 result on unrestricted-LLM math practice showed
 *     students gain practice-time but lose exam-time when the AI
 *     acts as a crutch.
 *   - Open with a one-line **Verdict** so the user can rate progress
 *     at a glance.
 *   - For wrong answers: hint at the gap, ask a leading question,
 *     refuse to spell out the solution.
 *   - For correct answers: affirm + briefly explain why it holds.
 *   - Same language as the question.
 */
const SYSTEM_PROMPT = `You are a Socratic tutor evaluating a student's answer to an exam question. Your goal is to help them LEARN, not give them the solution.

Output rules:
- Open with a one-line verdict in bold: "**Verdict: Correct**" or "**Verdict: Partially correct**" or "**Verdict: Incorrect**".
- Then 2 to 4 short sentences of feedback. No headings, no bullet lists.
- If correct: briefly affirm and explain WHY the answer is right.
- If partial: name what's right, name what's missing/wrong, end with a follow-up question that nudges them to fill the gap.
- If incorrect: do NOT reveal the full solution. Point at WHERE the gap is, give a single concrete hint, end with a leading question.
- Reply in the SAME LANGUAGE as the question.
- Reference the exam context only when the answer can be grounded in something concrete from it.
- Never tell the student to "ask the teacher", you ARE the tutor.`;

interface EvaluateArgs {
  /** The question shown to the student. */
  question: string;
  /** The student's typed answer. May be empty (the prompt makes the
   *  AI nudge them to attempt instead of refusing outright). */
  userAnswer: string;
  /** Full extracted exam text, the model uses this as background
   *  context but should not regurgitate it. Hard-capped so a long
   *  multi-page paper doesn't blow the prompt budget. */
  examContext: string;
  /** Cancel token, wired through to fetch / SDK so the user pressing
   *  "stop" or closing the modal stops the in-flight stream. */
  signal?: AbortSignal;
}

/**
 * Yield deltas of a streamed Socratic evaluation. The caller appends
 * them into a state buffer to render the feedback as it arrives.
 */
export async function* evaluatePracticeAnswer(
  args: EvaluateArgs,
): AsyncGenerator<string> {
  const exam =
    args.examContext.length > MAX_EXAM_CONTEXT_CHARS
      ? args.examContext.slice(0, MAX_EXAM_CONTEXT_CHARS)
      : args.examContext;

  const userPrompt = [
    `Exam context (background only, don't repeat verbatim):\n---\n${exam}\n---`,
    "",
    `Question:\n${args.question}`,
    "",
    `Student's answer:\n${args.userAnswer.trim() || "(blank, they didn't attempt yet)"}`,
  ].join("\n");

  for await (const { delta } of streamChatResponse(
    [{ role: "user", content: userPrompt }],
    "Practice mode",
    "",
    {
      systemPromptOverride: SYSTEM_PROMPT,
      maxOutputTokens: 600,
      signal: args.signal,
    },
  )) {
    yield delta;
  }
}

/** Quick verdict-line parser. Returns null if the model hasn't
 *  written one yet, used to colour the feedback panel as the
 *  stream lands. */
export function parseVerdict(
  feedback: string,
): "correct" | "partial" | "incorrect" | null {
  const m = feedback.match(/\*\*Verdict:\s*([^*]+)\*\*/i);
  if (!m) return null;
  const v = m[1].toLowerCase();
  if (v.includes("partial")) return "partial";
  if (v.includes("incorrect") || v.includes("wrong")) return "incorrect";
  if (v.includes("correct")) return "correct";
  return null;
}
