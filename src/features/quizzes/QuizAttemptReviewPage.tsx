import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ArrowLeft, Check, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useQuizStore } from "@/stores/quiz-store";
import type {
  Quiz,
  QuizAttempt,
  QuizAttemptAnswer,
  QuizQuestion,
} from "@/types/quiz";

export function QuizAttemptReviewPage() {
  const { quizId, attemptId } = useParams<{
    quizId: string;
    attemptId: string;
  }>();
  const navigate = useNavigate();
  const getQuiz = useQuizStore((s) => s.getQuiz);
  const fetchAttemptDetail = useQuizStore((s) => s.fetchAttemptDetail);

  const [loading, setLoading] = useState(true);
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [attempt, setAttempt] = useState<QuizAttempt | null>(null);
  const [answers, setAnswers] = useState<QuizAttemptAnswer[]>([]);

  useEffect(() => {
    if (!quizId || !attemptId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [quizData, attemptData] = await Promise.all([
        getQuiz(quizId),
        fetchAttemptDetail(attemptId),
      ]);
      if (cancelled) return;
      if (quizData) {
        setQuiz(quizData.quiz);
        setQuestions(quizData.questions);
      }
      if (attemptData) {
        setAttempt(attemptData.attempt);
        setAnswers(attemptData.answers);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [quizId, attemptId, getQuiz, fetchAttemptDetail]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 size={20} className="animate-spin text-text-muted" />
      </div>
    );
  }

  if (!quiz || !attempt) {
    return (
      <div className="mx-auto w-full max-w-xl p-6 text-center">
        <p className="text-text-muted">
          Attempt not found or you don't have access.
        </p>
        <Link
          to={`/quizzes/${quizId ?? ""}`}
          className="mt-3 inline-block text-sm text-accent-purple hover:underline"
        >
          Back to quiz
        </Link>
      </div>
    );
  }

  const pct =
    attempt.total > 0 ? Math.round((attempt.score / attempt.total) * 100) : 0;
  const completed = attempt.completed_at ? new Date(attempt.completed_at) : null;
  const answerByQuestion = new Map(answers.map((a) => [a.question_id, a]));

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5 p-4 sm:p-6">
      <button
        onClick={() => navigate(`/quizzes/${quiz.id}`)}
        className="flex items-center gap-1 text-sm text-text-muted transition-colors hover:text-text-primary cursor-pointer"
      >
        <ArrowLeft size={14} />
        Back to quiz
      </button>

      <header className="space-y-1">
        <p className="text-xs uppercase tracking-wider text-text-muted">
          Attempt review
        </p>
        <h1 className="truncate text-2xl font-bold text-text-primary">
          {quiz.title}
        </h1>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
          <span
            className={cn(
              "font-semibold tabular-nums",
              pct >= 80
                ? "text-green-400"
                : pct >= 50
                  ? "text-amber-400"
                  : "text-red-400",
            )}
          >
            {attempt.score}/{attempt.total} ({pct}%)
          </span>
          {completed && (
            <span className="text-text-muted">
              <span className="sm:hidden">{completed.toLocaleDateString()}</span>
              <span className="hidden sm:inline">
                {completed.toLocaleString()}
              </span>
            </span>
          )}
        </div>
      </header>

      {questions.length === 0 ? (
        <p className="rounded-lg border border-glass-border bg-glass-bg/40 p-4 text-sm text-text-muted">
          This quiz no longer has any questions.
        </p>
      ) : (
        <section className="space-y-3">
          {questions.map((question, idx) => {
            const ans = answerByQuestion.get(question.id) ?? null;
            const isCorrect = ans?.is_correct ?? false;
            const options = [
              question.option_a,
              question.option_b,
              question.option_c,
              question.option_d,
            ];
            return (
              <article
                key={question.id}
                className={cn(
                  "space-y-2 rounded-xl border p-3 text-sm sm:p-4",
                  ans == null
                    ? "border-glass-border bg-glass-bg/40"
                    : isCorrect
                      ? "border-green-500/30 bg-green-500/5"
                      : "border-red-500/30 bg-red-500/5",
                )}
              >
                <p className="font-medium text-text-primary">
                  {idx + 1}. {question.question_text}
                </p>
                {ans == null && (
                  <p className="text-xs italic text-text-muted">
                    No answer recorded.
                  </p>
                )}
                <div className="space-y-1">
                  {options.map((opt, optIdx) => {
                    const isCorrectOption = optIdx === question.correct_index;
                    const isPicked = ans?.selected_index === optIdx;
                    return (
                      <div
                        key={optIdx}
                        className={cn(
                          "flex items-start gap-2 rounded-md px-2 py-1",
                          isCorrectOption && "text-green-400",
                          isPicked && !isCorrectOption && "text-red-400",
                          !isCorrectOption &&
                            !isPicked &&
                            "text-text-secondary",
                        )}
                      >
                        <span className="mt-0.5 w-3 shrink-0" aria-hidden>
                          {isCorrectOption ? (
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
                {question.explanation && (
                  <p className="text-xs text-text-muted">
                    {question.explanation}
                  </p>
                )}
              </article>
            );
          })}
        </section>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          variant="secondary"
          onClick={() => navigate(`/quizzes/${quiz.id}`)}
          className="w-full sm:w-auto"
        >
          Back to quiz
        </Button>
        <Button
          onClick={() => navigate(`/quizzes/${quiz.id}/take`)}
          className="w-full sm:w-auto"
        >
          Retake
        </Button>
      </div>
    </div>
  );
}
