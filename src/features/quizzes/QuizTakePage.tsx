import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ArrowLeft, ArrowRight, Check, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useQuizStore } from "@/stores/quiz-store";
import type { SubmitAnswer } from "@/stores/quiz-store";
import { useAuthStore } from "@/stores/auth-store";
import { gradeAnswer, type Quiz, type QuizQuestion } from "@/types/quiz";

export function QuizTakePage() {
  const { quizId } = useParams<{ quizId: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const getQuiz = useQuizStore((s) => s.getQuiz);
  const submitAttempt = useQuizStore((s) => s.submitAttempt);

  const [loading, setLoading] = useState(true);
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);

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
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [quizId, getQuiz]);

  const q = questions[current];
  const score = useMemo(
    () => answers.reduce((n, a) => (a.is_correct ? n + 1 : n), 0),
    [answers],
  );
  const isLast = current === questions.length - 1;

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 size={20} className="animate-spin text-text-muted" />
      </div>
    );
  }
  if (!quiz || questions.length === 0) {
    return (
      <div className="mx-auto w-full max-w-xl p-6 text-center">
        <p className="text-text-muted">This quiz has no questions.</p>
        <Link
          to={`/quizzes/${quizId ?? ""}`}
          className="mt-3 inline-block text-sm text-accent-purple hover:underline"
        >
          Back to quiz
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
    const answer: SubmitAnswer = {
      question_id: q.id,
      selected_index:
        q.kind === "short_answer" ? null : pickedIndex,
      selected_text: q.kind === "short_answer" ? typedText.trim() : null,
      is_correct: gradeAnswer(q, {
        selected_index: pickedIndex,
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
    setCurrent(0);
    setAnswers([]);
    setPickedIndex(null);
    setTypedText("");
    setRevealed(false);
    setDone(false);
  };

  if (done) {
    const pct = Math.round((score / questions.length) * 100);
    return (
      <div className="mx-auto w-full max-w-2xl space-y-5 p-4 sm:p-6">
        <header className="space-y-1 text-center">
          <p className="text-xs uppercase tracking-wider text-text-muted">
            Results
          </p>
          <h1 className="text-3xl font-bold text-text-primary">
            {score} / {questions.length}
          </h1>
          <p
            className={cn(
              "text-sm font-medium",
              pct >= 80
                ? "text-green-400"
                : pct >= 50
                  ? "text-amber-400"
                  : "text-red-400",
            )}
          >
            {pct}%{" "}
            {pct >= 80
              ? "— great work!"
              : pct >= 50
                ? "— keep going."
                : "— worth another go."}
          </p>
        </header>

        <section className="space-y-3">
          {questions.map((question, idx) => (
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
            Back to quiz
          </Button>
          <Button onClick={restart} className="w-full sm:w-auto">
            Retry
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
        Exit
      </button>

      <div>
        <p className="text-xs uppercase tracking-wider text-text-muted">
          Question {current + 1} of {questions.length}
        </p>
        <div className="mt-1 h-1 w-full rounded-full bg-glass-bg">
          <div
            className="h-full rounded-full bg-accent-purple transition-all"
            style={{
              width: `${(current / questions.length) * 100}%`,
            }}
          />
        </div>
      </div>

      <h2 className="text-lg font-semibold text-text-primary">
        {q.question_text}
      </h2>

      {q.kind === "mcq4" && (
        <McqOptions
          options={[q.option_a, q.option_b, q.option_c, q.option_d]}
          correctIndex={q.correct_index}
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
            Submit
          </Button>
        ) : (
          <Button onClick={next} disabled={submitting}>
            {submitting ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <>
                {isLast ? "Finish" : "Next"}
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
                ? "border-green-500/50 bg-green-500/10 text-text-primary"
                : revealed && isSelected && !isCorrect
                  ? "border-red-500/50 bg-red-500/10 text-text-primary"
                  : isSelected
                    ? "border-accent-purple/60 bg-accent-purple/10 text-text-primary"
                    : "border-glass-border bg-glass-bg/40 text-text-secondary hover:border-accent-purple/40 hover:text-text-primary",
            )}
          >
            <span
              className={cn(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold",
                isSelected
                  ? "border-accent-purple text-accent-purple"
                  : "border-text-muted/40 text-text-muted",
              )}
            >
              {"ABCD"[idx]}
            </span>
            <span className="min-w-0 flex-1 break-words">{opt}</span>
            {revealed && isCorrect && (
              <Check size={14} className="shrink-0 text-green-400" />
            )}
            {revealed && isSelected && !isCorrect && (
              <X size={14} className="shrink-0 text-red-400" />
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
                ? "border-green-500/50 bg-green-500/10 text-text-primary"
                : revealed && isSelected && !isCorrect
                  ? "border-red-500/50 bg-red-500/10 text-text-primary"
                  : isSelected
                    ? "border-accent-purple/60 bg-accent-purple/10 text-text-primary"
                    : "border-glass-border bg-glass-bg/40 text-text-secondary hover:border-accent-purple/40 hover:text-text-primary",
            )}
          >
            {revealed && isCorrect && (
              <Check size={16} className="text-green-400" />
            )}
            {revealed && isSelected && !isCorrect && (
              <X size={16} className="text-red-400" />
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
  return (
    <div className="space-y-2">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={revealed}
        placeholder="Type your answer"
        autoFocus
        className={cn(
          "w-full rounded-lg border bg-bg-primary/50 px-3 py-2.5 text-sm text-text-primary outline-none disabled:opacity-70",
          revealed && isCorrect
            ? "border-green-500/50 bg-green-500/10"
            : revealed && !isCorrect
              ? "border-red-500/50 bg-red-500/10"
              : "border-glass-border focus:border-accent-purple/50",
        )}
      />
      {revealed && !isCorrect && (
        <p className="text-sm text-text-secondary">
          Expected:{" "}
          <span className="font-medium text-green-400">{correctText}</span>
        </p>
      )}
      {revealed && isCorrect && (
        <p className="flex items-center gap-1.5 text-sm text-green-400">
          <Check size={14} />
          Correct
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
  const correct = answer?.is_correct ?? false;
  return (
    <div
      className={cn(
        "space-y-2 rounded-xl border p-3 text-sm sm:p-4",
        correct
          ? "border-green-500/30 bg-green-500/5"
          : "border-red-500/30 bg-red-500/5",
      )}
    >
      <p className="font-medium text-text-primary">
        {index + 1}. {question.question_text}
      </p>

      {question.kind === "short_answer" ? (
        <div className="space-y-1">
          <div className="flex items-start gap-2 text-text-secondary">
            <span className="shrink-0 text-[11px] uppercase tracking-wider text-text-muted">
              Your answer:
            </span>
            <span
              className={cn(
                "min-w-0 break-words",
                correct ? "text-green-400" : "text-red-400",
              )}
            >
              {answer?.selected_text?.trim() || "(blank)"}
            </span>
          </div>
          {!correct && (
            <div className="flex items-start gap-2 text-text-secondary">
              <span className="shrink-0 text-[11px] uppercase tracking-wider text-text-muted">
                Expected:
              </span>
              <span className="min-w-0 break-words text-green-400">
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
                  isCorrect && "text-green-400",
                  isPicked && !isCorrect && "text-red-400",
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
