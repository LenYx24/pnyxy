import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ArrowLeft, ArrowRight, Check, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useQuizStore } from "@/stores/quiz-store";
import { useAuthStore } from "@/stores/auth-store";
import type { Quiz, QuizQuestion } from "@/types/quiz";

type Answer = { question_id: string; selected_index: number; is_correct: boolean };

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
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
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

  const reveal = () => {
    if (selected === null) return;
    const isCorrect = selected === q.correct_index;
    setAnswers((prev) => [
      ...prev,
      { question_id: q.id, selected_index: selected, is_correct: isCorrect },
    ]);
    setRevealed(true);
  };

  const next = async () => {
    if (!isLast) {
      setCurrent((c) => c + 1);
      setSelected(null);
      setRevealed(false);
      return;
    }
    // Finish + submit
    if (!user) {
      // Anonymous mode: show results without recording.
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
          {questions.map((question, idx) => {
            const ans = answers[idx];
            return (
              <div
                key={question.id}
                className={cn(
                  "space-y-2 rounded-xl border p-3 text-sm",
                  ans?.is_correct
                    ? "border-green-500/30 bg-green-500/5"
                    : "border-red-500/30 bg-red-500/5",
                )}
              >
                <p className="font-medium text-text-primary">
                  {idx + 1}. {question.question_text}
                </p>
                <div className="space-y-1">
                  {([question.option_a, question.option_b, question.option_c, question.option_d]).map(
                    (opt, optIdx) => {
                      const isCorrect = optIdx === question.correct_index;
                      const isPicked = ans?.selected_index === optIdx;
                      return (
                        <div
                          key={optIdx}
                          className={cn(
                            "flex items-center gap-2 rounded-md px-2 py-1",
                            isCorrect && "text-green-400",
                            isPicked && !isCorrect && "text-red-400",
                          )}
                        >
                          {isCorrect && <Check size={12} />}
                          {isPicked && !isCorrect && <X size={12} />}
                          {!isCorrect && !isPicked && (
                            <span className="w-3" aria-hidden />
                          )}
                          <span>{opt}</span>
                        </div>
                      );
                    },
                  )}
                </div>
                {question.explanation && (
                  <p className="text-xs text-text-muted">
                    {question.explanation}
                  </p>
                )}
              </div>
            );
          })}
        </section>

        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            onClick={() => navigate(`/quizzes/${quiz.id}`)}
          >
            Back to quiz
          </Button>
          <Button
            onClick={() => {
              setCurrent(0);
              setAnswers([]);
              setSelected(null);
              setRevealed(false);
              setDone(false);
            }}
          >
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

      <div className="space-y-2">
        {([q.option_a, q.option_b, q.option_c, q.option_d]).map((opt, idx) => {
          const isSelected = selected === idx;
          const isCorrect = idx === q.correct_index;
          const showState = revealed;
          return (
            <button
              key={idx}
              onClick={() => !revealed && setSelected(idx)}
              disabled={revealed}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left text-sm transition-colors",
                !revealed && "cursor-pointer",
                showState && isCorrect
                  ? "border-green-500/50 bg-green-500/10 text-text-primary"
                  : showState && isSelected && !isCorrect
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
              <span className="flex-1">{opt}</span>
              {showState && isCorrect && (
                <Check size={14} className="text-green-400" />
              )}
              {showState && isSelected && !isCorrect && (
                <X size={14} className="text-red-400" />
              )}
            </button>
          );
        })}
      </div>

      {revealed && q.explanation && (
        <p className="rounded-lg border border-glass-border bg-glass-bg/40 p-3 text-sm text-text-secondary">
          {q.explanation}
        </p>
      )}

      <div className="flex justify-end gap-2">
        {!revealed ? (
          <Button onClick={reveal} disabled={selected === null}>
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
