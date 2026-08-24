import { parseCorrectIndices, type Quiz, type QuizQuestion } from "@/types/quiz";

/**
 * Serialize a quiz to GIFT, Moodle's plain-text quiz format, the most
 * widely-supported human-readable interchange format for quizzes. This
 * is the no-vendor-lock-in export: the `.gift` file opens in any text
 * editor and imports into Moodle/Canvas/etc.
 *
 * Mapping to our schema:
 *   - mcq4        → `{ =correct ~wrong ~wrong ~wrong }`, explanation as
 *                   `#feedback` on the correct answer.
 *   - true_false  → `{ TRUE }` / `{ FALSE }` (correct_index 0 = option_a,
 *                   which is the "True" slot), explanation as a comment.
 *   - multi_select→ `{ ~%pct%opt ... }` GIFT multiple-answer, correct
 *                   options split +100% between them, wrong options
 *                   each -100% (so only the exact set scores full).
 *   - short_answer→ `{ =answer#feedback }`.
 */

// GIFT reserves these as control characters; a literal one in question
// or answer text must be backslash-escaped.
function giftEscape(s: string): string {
  return s.replace(/([\\{}=~#:])/g, "\\$1");
}

function oneLine(s: string): string {
  return s.replace(/\s*\n\s*/g, " ").trim();
}

export function quizToGift(
  quiz: Pick<Quiz, "title" | "description">,
  questions: QuizQuestion[],
): string {
  const out: string[] = [];
  out.push(`// ${oneLine(quiz.title) || "Untitled quiz"}`);
  if (quiz.description?.trim()) {
    out.push(`// ${oneLine(quiz.description)}`);
  }
  out.push("");

  questions.forEach((q, i) => {
    const titleTag = `::Q${i + 1}::`;
    const stem = giftEscape(oneLine(q.question_text));
    const explanation = q.explanation?.trim()
      ? giftEscape(oneLine(q.explanation))
      : "";

    if (q.kind === "mcq4") {
      const opts = [q.option_a, q.option_b, q.option_c, q.option_d];
      const body = opts
        .map((opt, idx) => {
          if (opt == null) return null;
          const correct = idx === q.correct_index;
          const fb = correct && explanation ? `#${explanation}` : "";
          return `  ${correct ? "=" : "~"}${giftEscape(opt.trim())}${fb}`;
        })
        .filter((line): line is string => line !== null)
        .join("\n");
      out.push(`${titleTag} ${stem} {`);
      out.push(body);
      out.push("}");
    } else if (q.kind === "multi_select") {
      const opts = [q.option_a, q.option_b, q.option_c, q.option_d];
      const correctSet = parseCorrectIndices(q.correct_text);
      const numCorrect = correctSet.length || 1;
      const numWrong = opts.filter((o) => o != null).length - numCorrect;
      const correctPct = Number((100 / numCorrect).toFixed(5));
      const wrongPct = numWrong > 0 ? Number((100 / numWrong).toFixed(5)) : 100;
      const body = opts
        .map((opt, idx) => {
          if (opt == null) return null;
          const isCorrect = correctSet.includes(idx);
          const pct = isCorrect ? correctPct : -wrongPct;
          const fb = isCorrect && explanation ? `#${explanation}` : "";
          return `  ~%${pct}%${giftEscape(opt.trim())}${fb}`;
        })
        .filter((line): line is string => line !== null)
        .join("\n");
      out.push(`${titleTag} ${stem} {`);
      out.push(body);
      out.push("}");
    } else if (q.kind === "true_false") {
      const isTrue = (q.correct_index ?? 0) === 0;
      out.push(`${titleTag} ${stem} {${isTrue ? "TRUE" : "FALSE"}}`);
      if (explanation) out.push(`// explanation: ${explanation}`);
    } else {
      // short_answer
      const ans = giftEscape((q.correct_text ?? "").trim());
      const fb = explanation ? `#${explanation}` : "";
      out.push(`${titleTag} ${stem} {=${ans}${fb}}`);
    }
    out.push("");
  });

  return out.join("\n");
}

function quizFileStem(quiz: Pick<Quiz, "id" | "title">): string {
  const base = quiz.title.trim() || `quiz-${quiz.id.slice(0, 8)}`;
  return (
    base
      .replace(/[\\/:*?"<>|]+/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || `quiz-${quiz.id.slice(0, 8)}`
  );
}

/** Trigger a browser download of the quiz as a `.gift` file. */
export function downloadQuizGift(
  quiz: Pick<Quiz, "id" | "title" | "description">,
  questions: QuizQuestion[],
): void {
  const blob = new Blob([quizToGift(quiz, questions)], {
    type: "text/plain;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${quizFileStem(quiz)}.gift`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
