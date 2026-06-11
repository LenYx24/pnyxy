import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ArrowRight, Check, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useQuizStore } from "@/stores/quiz-store";
import type { SubmitAnswer } from "@/stores/quiz-store";
import { useAuthStore } from "@/stores/auth-store";
import { gradeAnswer, type Quiz, type QuizQuestion } from "@/types/quiz";

// Pairs each question with the order in which its options should be
// displayed. For non-mcq4 kinds (or when randomize_options is off)
// the order is identity [0,1,2,3] — the renderer can ignore the
// distinction. For mcq4 with randomization enabled, the array is a
// permutation. The user's pick is in *displayed-index space* and we
// translate back via this array before storing the answer, so the
// stored selected_index always matches the canonical option order
// in the database (which is what FSRS / attempt history rely on).
type PlayItem = {
  question: QuizQuestion;
  optionOrder: number[];
};

function shuffle<T>(arr: readonly T[]): T[] {
  const result = arr.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function buildPlayOrder(quiz: Quiz, questions: QuizQuestion[]): PlayItem[] {
  const ordered = quiz.randomize_questions ? shuffle(questions) : questions;
  return ordered.map((q) => ({
    question: q,
    optionOrder:
      quiz.randomize_options && q.kind === "mcq4"
        ? shuffle([0, 1, 2, 3])
        : [0, 1, 2, 3],
  }));
}

export function QuizTakePage() {
  const { t } = useTranslation();
  const { quizId } = useParams<{ quizId: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const getQuiz = useQuizStore((s) => s.getQuiz);
  const submitAttempt = useQuizStore((s) => s.submitAttempt);

  const [loading, setLoading] = useState(true);
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [playOrder, setPlayOrder] = useState<PlayItem[]>([]);

  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState<SubmitAnswer[]>([]);
  const [pickedIndex, setPickedIndex] = useState<number | null>(null);
  const [typedText, setTypedText] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!quizId) return;
    let cancelled = false;
    (async () => {
      const data = await getQuiz(quizId);
      if (cancelled) return;
      if (data) {
        setQuiz(data.quiz);
        setQuestions(data.questions);
        setPlayOrder(buildPlayOrder(data.quiz, data.questions));
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [quizId, getQuiz]);

  const playItem = playOrder[current];
  const q = playItem?.question;
  const score = useMemo(
    () => answers.reduce((n, a) => (a.is_correct ? n + 1 : n), 0),
    [answers],
  );
  const isLast = current === playOrder.length - 1;

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 size={20} className="animate-spin text-text-muted" />
      </div>
    );
  }
  if (!quiz || playOrder.length === 0 || !q || !playItem) {
    return (
      <div className="mx-auto w-full max-w-xl p-6 text-center">
        <p className="text-text-muted">{t("quizzes.take.noQuestions")}</p>
        <Link
          to={`/quizzes/${quizId ?? ""}`}
          className="mt-3 inline-block text-sm text-accent hover:underline"
        >
          {t("quizzes.take.backToQuiz")}
        </Link>
      </div>
    );
  }

  const canReveal =
    q.kind === "short_answer"
      ? typedText.trim().length > 0
      : pickedIndex !== null;

  const reveal = () => {
    if (!canReveal) return;
    // pickedIndex is in *displayed* order. Translate to the canonical
    // option index before storing so submitAttempt / FSRS see the
    // same selected_index they would have for an unshuffled quiz.
    const originalIndex =
      pickedIndex !== null && q.kind !== "short_answer"
        ? playItem.optionOrder[pickedIndex]
        : null;
    const answer: SubmitAnswer = {
      question_id: q.id,
      selected_index: q.kind === "short_answer" ? null : originalIndex,
      selected_text: q.kind === "short_answer" ? typedText.trim() : null,
      is_correct: gradeAnswer(q, {
        selected_index: originalIndex,
        selected_text: typedText,
      }),
    };
    setAnswers((prev) => [...prev, answer]);
    setRevealed(true);
  };

  const next = async () => {
    if (!isLast) {
      setCurrent((c) => c + 1);
      setPickedIndex(null);
      setTypedText("");
      setRevealed(false);
      return;
    }
    if (!user) {
      setDone(true);
      return;
    }
    setSubmitting(true);
    try {
      await submitAttempt(quiz.id, answers);
    } finally {
      setSubmitting(false);
      setDone(true);
    }
  };

  const restart = () => {
    // Re-shuffle on restart so a "Retry" actually feels different
    // when randomization is on.
    setPlayOrder(buildPlayOrder(quiz, questions));
    setCurrent(0);
    setAnswers([]);
    setPickedIndex(null);
    setTypedText("");
    setRevealed(false);
    setDone(false);
  };

  if (done) {
    const pct = Math.round((score / playOrder.length) * 100);
    return (
      <div className="mx-auto w-full max-w-2xl space-y-5 p-4 sm:p-6">
        <header className="space-y-1 text-center">
          <p className="text-xs uppercase tracking-wider text-text-muted">
            {t("quizzes.take.results")}
          </p>
          <h1 className="text-3xl font-bold text-text-primary">
            {score} / {playOrder.length}
          </h1>
          <p
            className={cn(
              "text-sm font-medium",
              pct >= 80
                ? "text-success"
                : pct >= 50
                  ? "text-warning"
                  : "text-danger",
            )}
          >
            {pct}%{" "}
            {pct >= 80
              ? t("quizzes.take.great")
              : pct >= 50
                ? t("quizzes.take.keepGoing")
                : t("quizzes.take.worthAnother")}
          </p>
        </header>

        <section className="space-y-3">
          {playOrder.map(({ question }, idx) => (
            <ResultCard
              key={question.id}
              index={idx}
              question={question}
              answer={answers[idx] ?? null}
            />
          ))}
        </section>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="secondary"
            onClick={() => navigate(`/quizzes/${quiz.id}`)}
            className="w-full sm:w-auto"
          >
            {t("quizzes.take.backToQuiz")}
          </Button>
          <Button onClick={restart} className="w-full sm:w-auto">
            {t("common.retry")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5 p-4 sm:p-6">
      <button
        onClick={() => navigate(`/quizzes/${quiz.id}`)}
        className="flex items-center gap-1 text-sm text-text-muted transition-colors hover:text-text-primary cursor-pointer"
      >
        <ArrowLeft size={14} />
        {t("common.exit")}
      </button>

      <div>
        <p className="text-xs uppercase tracking-wider text-text-muted">
          {t("quizzes.take.progress", {
            current: current + 1,
            total: playOrder.length,
          })}
        </p>
        <div className="mt-1 h-1 w-full rounded-full bg-glass-bg">
          <div
            className="h-full rounded-full bg-accent transition-all"
            style={{
              width: `${(current / playOrder.length) * 100}%`,
            }}
          />
        </div>
      </div>

      <h2 className="text-lg font-semibold text-text-primary">
        {q.question_text}
      </h2>

      {q.kind === "mcq4" && (
        <McqOptions
          // Permute the option strings into displayed order. The
          // `selected` and `correctIndex` props are also in displayed
          // space — translate correct_index via optionOrder.indexOf.
          options={playItem.optionOrder.map(
            (origIdx) =>
              [q.option_a, q.option_b, q.option_c, q.option_d][origIdx],
          )}
          correctIndex={
            q.correct_index !== null
              ? playItem.optionOrder.indexOf(q.correct_index)
              : null
          }
          selected={pickedIndex}
          revealed={revealed}
          onSelect={setPickedIndex}
        />
      )}

      {q.kind === "true_false" && (
        <TrueFalseOptions
          labels={[q.option_a ?? "True", q.option_b ?? "False"]}
          correctIndex={q.correct_index}
          selected={pickedIndex}
          revealed={revealed}
          onSelect={setPickedIndex}
        />
      )}

      {q.kind === "short_answer" && (
        <ShortAnswerInput
          value={typedText}
          onChange={setTypedText}
          revealed={revealed}
          isCorrect={!!(answers[current]?.is_correct)}
          correctText={q.correct_text ?? ""}
        />
      )}

      {revealed && q.explanation && (
        <p className="rounded-lg border border-glass-border bg-glass-bg/40 p-3 text-sm text-text-secondary">
          {q.explanation}
        </p>
      )}

      <div className="flex justify-end gap-2">
        {!revealed ? (
          <Button onClick={reveal} disabled={!canReveal}>
            {t("common.submit")}
          </Button>
        ) : (
          <Button onClick={next} disabled={submitting}>
            {submitting ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <>
                {isLast ? t("common.finish") : t("common.next")}
                {!isLast && <ArrowRight size={14} />}
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}

export function McqOptions({
  options,
  correctIndex,
  selected,
  revealed,
  onSelect,
}: {
  options: (string | null)[];
  correctIndex: number | null;
  selected: number | null;
  revealed: boolean;
  onSelect: (i: number) => void;
}) {
  return (
    <div className="space-y-2">
      {options.map((opt, idx) => {
        const isSelected = selected === idx;
        const isCorrect = idx === correctIndex;
        return (
          <button
            key={idx}
            onClick={() => !revealed && onSelect(idx)}
            disabled={revealed}
            className={cn(
              "flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left text-sm transition-colors",
              !revealed && "cursor-pointer",
              revealed && isCorrect
                ? "border-success/50 bg-success/10 text-text-primary"
                : revealed && isSelected && !isCorrect
                  ? "border-danger/50 bg-danger/10 text-text-primary"
                  : isSelected
                    ? "border-accent/60 bg-accent/10 text-text-primary"
                    : "border-glass-border bg-glass-bg/40 text-text-secondary hover:border-accent/40 hover:text-text-primary",
            )}
          >
            <span
              className={cn(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-2xs font-semibold",
                isSelected
                  ? "border-accent text-accent"
                  : "border-text-muted/40 text-text-muted",
              )}
            >
              {"ABCD"[idx]}
            </span>
            <span className="min-w-0 flex-1 break-words">{opt}</span>
            {revealed && isCorrect && (
              <Check size={14} className="shrink-0 text-success" />
            )}
            {revealed && isSelected && !isCorrect && (
              <X size={14} className="shrink-0 text-danger" />
            )}
          </button>
        );
      })}
    </div>
  );
}

export function TrueFalseOptions({
  labels,
  correctIndex,
  selected,
  revealed,
  onSelect,
}: {
  labels: [string, string];
  correctIndex: number | null;
  selected: number | null;
  revealed: boolean;
  onSelect: (i: number) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {labels.map((label, idx) => {
        const isSelected = selected === idx;
        const isCorrect = idx === correctIndex;
        return (
          <button
            key={idx}
            onClick={() => !revealed && onSelect(idx)}
            disabled={revealed}
            className={cn(
              "flex items-center justify-center gap-2 rounded-lg border px-4 py-3 text-base font-medium transition-colors",
              !revealed && "cursor-pointer",
              revealed && isCorrect
                ? "border-success/50 bg-success/10 text-text-primary"
                : revealed && isSelected && !isCorrect
                  ? "border-danger/50 bg-danger/10 text-text-primary"
                  : isSelected
                    ? "border-accent/60 bg-accent/10 text-text-primary"
                    : "border-glass-border bg-glass-bg/40 text-text-secondary hover:border-accent/40 hover:text-text-primary",
            )}
          >
            {revealed && isCorrect && (
              <Check size={16} className="text-success" />
            )}
            {revealed && isSelected && !isCorrect && (
              <X size={16} className="text-danger" />
            )}
            {label}
          </button>
        );
      })}
    </div>
  );
}

export function ShortAnswerInput({
  value,
  onChange,
  revealed,
  isCorrect,
  correctText,
}: {
  value: string;
  onChange: (v: string) => void;
  revealed: boolean;
  isCorrect: boolean;
  correctText: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={revealed}
        placeholder={t("quizzes.take.typeAnswer")}
        autoFocus
        className={cn(
          "w-full rounded-lg border bg-bg-primary/50 px-3 py-2.5 text-sm text-text-primary outline-none disabled:opacity-70",
          revealed && isCorrect
            ? "border-success/50 bg-success/10"
            : revealed && !isCorrect
              ? "border-danger/50 bg-danger/10"
              : "border-glass-border focus:border-accent/50",
        )}
      />
      {revealed && !isCorrect && (
        <p className="text-sm text-text-secondary">
          {t("quizzes.take.expected")}{" "}
          <span className="font-medium text-success">{correctText}</span>
        </p>
      )}
      {revealed && isCorrect && (
        <p className="flex items-center gap-1.5 text-sm text-success">
          <Check size={14} />
          {t("quizzes.take.correct")}
        </p>
      )}
    </div>
  );
}

export function ResultCard({
  index,
  question,
  answer,
}: {
  index: number;
  question: QuizQuestion;
  answer: {
    selected_index?: number | null;
    selected_text?: string | null;
    is_correct: boolean;
  } | null;
}) {
  const { t } = useTranslation();
  const correct = answer?.is_correct ?? false;
  return (
    <div
      className={cn(
        "space-y-2 rounded-xl border p-3 text-sm sm:p-4",
        correct
          ? "border-success/30 bg-success/5"
          : "border-danger/30 bg-danger/5",
      )}
    >
      <p className="font-medium text-text-primary">
        {index + 1}. {question.question_text}
      </p>

      {question.kind === "short_answer" ? (
        <div className="space-y-1">
          <div className="flex items-start gap-2 text-text-secondary">
            <span className="shrink-0 text-2xs uppercase tracking-wider text-text-muted">
              {t("quizzes.take.yourAnswer")}
            </span>
            <span
              className={cn(
                "min-w-0 break-words",
                correct ? "text-success" : "text-danger",
              )}
            >
              {answer?.selected_text?.trim() || t("quizzes.take.blank")}
            </span>
          </div>
          {!correct && (
            <div className="flex items-start gap-2 text-text-secondary">
              <span className="shrink-0 text-2xs uppercase tracking-wider text-text-muted">
                {t("quizzes.take.expected")}
              </span>
              <span className="min-w-0 break-words text-success">
                {question.correct_text}
              </span>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-1">
          {(question.kind === "true_false"
            ? [question.option_a ?? "True", question.option_b ?? "False"]
            : [
                question.option_a,
                question.option_b,
                question.option_c,
                question.option_d,
              ]
          ).map((opt, optIdx) => {
            const isCorrect = optIdx === question.correct_index;
            const isPicked = answer?.selected_index === optIdx;
            return (
              <div
                key={optIdx}
                className={cn(
                  "flex items-start gap-2 rounded-md px-2 py-1",
                  isCorrect && "text-success",
                  isPicked && !isCorrect && "text-danger",
                  !isCorrect && !isPicked && "text-text-secondary",
                )}
              >
                <span className="mt-0.5 w-3 shrink-0" aria-hidden>
                  {isCorrect ? (
                    <Check size={12} />
                  ) : isPicked ? (
                    <X size={12} />
                  ) : null}
                </span>
                <span className="min-w-0 flex-1 break-words">{opt}</span>
              </div>
            );
          })}
        </div>
      )}

      {question.explanation && (
        <p className="text-xs text-text-muted">{question.explanation}</p>
      )}
    </div>
  );
}
