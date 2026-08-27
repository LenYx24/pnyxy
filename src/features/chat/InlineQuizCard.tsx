/**
 * Interactive in-chat quiz (design canvas "A"): one question at a time,
 * instant right/wrong feedback with the explanation (page citations
 * included), progress bar, then a score summary with retry. Works in
 * the 300px reader side panel too (no fixed widths, wrap-friendly
 * rows). Save puts it into the regular quiz store so it's retakeable
 * from the library once the quizzes feature is unlocked.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, Check, RotateCcw, Save, X } from "lucide-react";
import type { InlineQuiz } from "@/lib/ai/extract-quiz";
import { useQuizStore } from "@/stores/quiz-store";
import { useFeature } from "@/lib/use-features";
import { showToast } from "@/stores/toast-store";
import { track } from "@/lib/telemetry";
import { cn } from "@/lib/cn";
import type { QuizQuestionDraft } from "@/types/quiz";

export function InlineQuizCard({ quiz }: { quiz: InlineQuiz }) {
  const { t } = useTranslation();
  const quizzesEnabled = useFeature("quizzes");
  const createQuiz = useQuizStore((s) => s.createQuiz);

  const [index, setIndex] = useState(0);
  // picked option per question (undefined = unanswered)
  const [picks, setPicks] = useState<Record<number, number>>({});
  const [finished, setFinished] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);

  const total = quiz.questions.length;
  const q = quiz.questions[Math.min(index, total - 1)];
  const picked = picks[index];
  const answered = picked !== undefined;
  const score = useMemo(
    () =>
      quiz.questions.reduce(
        (acc, question, i) => acc + (picks[i] === question.correct ? 1 : 0),
        0,
      ),
    [quiz.questions, picks],
  );

  const pick = (optIdx: number) => {
    if (answered || finished) return;
    setPicks((p) => ({ ...p, [index]: optIdx }));
  };

  const next = () => {
    if (index + 1 < total) {
      setIndex(index + 1);
    } else {
      setFinished(true);
      track("quiz_done", { score, total, inline: true });
    }
  };

  const restart = () => {
    setPicks({});
    setIndex(0);
    setFinished(false);
  };

  const save = async () => {
    if (saving || savedId) return;
    setSaving(true);
    try {
      const questions: QuizQuestionDraft[] = quiz.questions.map((question) => ({
        kind: "mcq4",
        question_text: question.q,
        option_a: question.options[0] ?? "",
        option_b: question.options[1] ?? "",
        option_c: question.options[2] ?? "",
        option_d: question.options[3] ?? "",
        correct_index: question.correct,
        correct_text: question.options[question.correct] ?? "",
        correct_indices: [],
        explanation: question.explanation,
      }));
      const id = await createQuiz({
        title: quiz.title || t("chat.inlineQuiz.defaultTitle"),
        description: null,
        visibility: "private",
        uploaded_book_id: null,
        catalog_book_id: null,
        questions,
      });
      if (!id) throw new Error("save failed");
      setSavedId(id);
      track("quiz_saved", { total, inline: true });
      showToast(t("chat.inlineQuiz.saved"), "success");
    } catch {
      showToast(t("chat.inlineQuiz.saveFailed"), "error");
    } finally {
      setSaving(false);
    }
  };

  const saveButton = quizzesEnabled && (
    <button
      type="button"
      onClick={() => void save()}
      disabled={saving || !!savedId}
      className="ml-auto inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-control px-2 py-1 text-2xs text-text-muted transition-colors hover:bg-surface-3 hover:text-text-primary disabled:cursor-default disabled:opacity-60"
    >
      {savedId ? (
        <Check size={13} strokeWidth={1.5} />
      ) : (
        <Save size={13} strokeWidth={1.5} />
      )}
      {savedId ? t("chat.inlineQuiz.savedShort") : t("chat.inlineQuiz.save")}
    </button>
  );

  if (finished) {
    return (
      <div className="flex flex-col gap-3 rounded-panel bg-bg-tertiary p-4">
        <p className="text-sm font-semibold text-text-primary">
          {t("chat.inlineQuiz.result", {
            score,
            total,
          })}
        </p>
        <div className="h-1 w-full overflow-hidden rounded-full bg-surface-3">
          <div
            className={cn(
              "h-full rounded-full",
              score / total >= 0.8
                ? "bg-success"
                : score / total >= 0.5
                  ? "bg-warning"
                  : "bg-danger",
            )}
            style={{ width: `${Math.round((score / total) * 100)}%` }}
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={restart}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-bg-secondary px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-3 hover:text-text-primary"
          >
            <RotateCcw size={13} strokeWidth={1.5} />
            {t("chat.inlineQuiz.retry")}
          </button>
          {saveButton}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5 rounded-panel bg-bg-tertiary p-4">
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-text-primary">
          {quiz.title || t("chat.inlineQuiz.title")}
        </span>
        <span className="shrink-0 text-2xs tabular-nums text-text-muted-2">
          {index + 1}/{total}
        </span>
      </div>
      <div className="h-0.5 w-full overflow-hidden rounded-full bg-surface-3">
        <div
          className="h-full rounded-full bg-accent transition-[width]"
          style={{
            width: `${Math.round(((index + (answered ? 1 : 0)) / total) * 100)}%`,
          }}
        />
      </div>
      <p className="text-sm leading-normal text-text-primary">{q.q}</p>
      <div className="flex flex-col gap-1.5">
        {q.options.map((opt, i) => {
          const isPick = picked === i;
          const isCorrect = i === q.correct;
          const showGood = answered && isCorrect;
          const showBad = answered && isPick && !isCorrect;
          return (
            <button
              key={i}
              type="button"
              onClick={() => pick(i)}
              disabled={answered}
              className={cn(
                "flex items-center gap-2.5 rounded-control px-3 py-2 text-left text-[13px] transition-colors",
                !answered &&
                  "cursor-pointer bg-bg-secondary text-text-secondary hover:bg-surface-3 hover:text-text-primary",
                answered &&
                  !showGood &&
                  !showBad &&
                  "bg-bg-secondary text-text-muted",
                showGood && "bg-success/15 text-success",
                showBad && "bg-danger/12 text-danger",
              )}
            >
              <span
                className={cn(
                  "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                  showGood
                    ? "border-success bg-success text-bg-primary"
                    : showBad
                      ? "border-danger text-danger"
                      : "border-surface-3",
                )}
              >
                {showGood && <Check size={10} strokeWidth={2.5} />}
                {showBad && <X size={10} strokeWidth={2.5} />}
              </span>
              <span className="min-w-0 flex-1">{opt}</span>
            </button>
          );
        })}
      </div>
      {answered && q.explanation && (
        <p className="rounded-control border-l-2 border-success bg-bg-secondary px-3 py-2 text-xs leading-relaxed text-text-muted">
          {q.explanation}
        </p>
      )}
      {answered && (
        <div className="flex items-center gap-2 pt-0.5">
          <button
            type="button"
            onClick={next}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-text-primary px-3.5 py-1.5 text-xs font-semibold text-bg-primary transition-opacity hover:opacity-90"
          >
            {index + 1 < total
              ? t("chat.inlineQuiz.next")
              : t("chat.inlineQuiz.finish")}
            <ArrowRight size={13} strokeWidth={2} />
          </button>
          {saveButton}
        </div>
      )}
    </div>
  );
}
