import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useQuizStore } from "@/stores/quiz-store";
import type {
  Quiz,
  QuizAttempt,
  QuizAttemptAnswer,
  QuizQuestion,
} from "@/types/quiz";
import { ResultCard } from "./QuizTakePage";

export function QuizAttemptReviewPage() {
  const { t } = useTranslation();
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
          {t("quizzes.attemptReview.noAccess")}
        </p>
        <Link
          to={`/quizzes/${quizId ?? ""}`}
          className="mt-3 inline-block text-sm text-accent-purple hover:underline"
        >
          {t("quizzes.take.backToQuiz")}
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
        {t("quizzes.take.backToQuiz")}
      </button>

      <header className="space-y-1">
        <p className="text-xs uppercase tracking-wider text-text-muted">
          {t("quizzes.attemptReview.title")}
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
          {t("quizzes.attemptReview.noQuestionsAnymore")}
        </p>
      ) : (
        <section className="space-y-3">
          {questions.map((question, idx) => (
            <ResultCard
              key={question.id}
              index={idx}
              question={question}
              answer={answerByQuestion.get(question.id) ?? null}
            />
          ))}
        </section>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          variant="secondary"
          onClick={() => navigate(`/quizzes/${quiz.id}`)}
          className="w-full sm:w-auto"
        >
          {t("quizzes.take.backToQuiz")}
        </Button>
        <Button
          onClick={() => navigate(`/quizzes/${quiz.id}/take`)}
          className="w-full sm:w-auto"
        >
          {t("quizzes.attemptReview.retake")}
        </Button>
      </div>
    </div>
  );
}
