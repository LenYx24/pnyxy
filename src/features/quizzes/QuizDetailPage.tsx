import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  ArrowLeft,
  Play,
  Pencil,
  Trash2,
  Loader2,
  History,
  FileQuestion,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui";
import { useQuizStore } from "@/stores/quiz-store";
import { useAuthStore } from "@/stores/auth-store";
import type {
  Quiz,
  QuizAttempt,
  QuizQuestion,
  QuizQuestionStat,
} from "@/types/quiz";
import { cn } from "@/lib/cn";

export function QuizDetailPage() {
  const { quizId } = useParams<{ quizId: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const getQuiz = useQuizStore((s) => s.getQuiz);
  const deleteQuiz = useQuizStore((s) => s.deleteQuiz);
  const fetchAttempts = useQuizStore((s) => s.fetchAttempts);
  const fetchQuestionStats = useQuizStore((s) => s.fetchQuestionStats);

  const [loading, setLoading] = useState(true);
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [attempts, setAttempts] = useState<QuizAttempt[]>([]);
  const [stats, setStats] = useState<QuizQuestionStat[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!quizId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const data = await getQuiz(quizId);
      if (cancelled) return;
      if (!data) {
        setQuiz(null);
        setLoading(false);
        return;
      }
      setQuiz(data.quiz);
      setQuestions(data.questions);
      if (user) {
        const a = await fetchAttempts(quizId);
        if (!cancelled) setAttempts(a);
        // Stats RPC is owner-gated server-side; for non-owners it
        // returns an empty list which keeps the panel hidden.
        if (user.id === data.quiz.user_id) {
          const s = await fetchQuestionStats(quizId);
          if (!cancelled) setStats(s);
        }
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [quizId, user, getQuiz, fetchAttempts, fetchQuestionStats]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 size={20} className="animate-spin text-text-muted" />
      </div>
    );
  }

  if (!quiz) {
    return (
      <div className="mx-auto w-full max-w-2xl p-6 text-center">
        <p className="text-text-muted">Quiz not found or you don't have access.</p>
        <Link to="/quizzes" className="mt-4 inline-block text-sm text-accent-purple hover:underline">
          Back to Quizzes
        </Link>
      </div>
    );
  }

  const isOwner = user?.id === quiz.user_id;

  const handleDelete = async () => {
    if (!quizId) return;
    try {
      await deleteQuiz(quizId);
      navigate("/quizzes");
    } catch {
      // error already logged; keep dialog open
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-6">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1 text-sm text-text-muted transition-colors hover:text-text-primary cursor-pointer"
      >
        <ArrowLeft size={14} />
        Back
      </button>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-purple/15 text-accent-purple">
              <FileQuestion size={18} />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-bold text-text-primary">
                {quiz.title}
              </h1>
              <p className="text-xs text-text-muted">
                {questions.length}{" "}
                {questions.length === 1 ? "question" : "questions"} ·{" "}
                {quiz.visibility === "public" ? "Public" : "Private"}
              </p>
            </div>
          </div>
          {quiz.description && (
            <p className="mt-3 text-sm text-text-secondary">
              {quiz.description}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            onClick={() => navigate(`/quizzes/${quizId}/take`)}
            disabled={questions.length === 0}
          >
            <Play size={16} />
            Take quiz
          </Button>
          {isOwner && (
            <>
              <Button
                variant="secondary"
                onClick={() => navigate(`/quizzes/${quizId}/edit`)}
              >
                <Pencil size={14} />
                Edit
              </Button>
              <Button
                variant="secondary"
                onClick={() => setConfirmDelete(true)}
                className="text-red-400"
              >
                <Trash2 size={14} />
              </Button>
            </>
          )}
        </div>
      </header>

      {/* Attempt history */}
      {user && attempts.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-text-muted">
            <History size={14} />
            Your past attempts
          </div>
          <ul className="divide-y divide-glass-border overflow-hidden rounded-xl border border-glass-border">
            {attempts.map((a) => {
              const pct = a.total > 0 ? Math.round((a.score / a.total) * 100) : 0;
              const completed = a.completed_at ? new Date(a.completed_at) : null;
              return (
                <li key={a.id}>
                  <Link
                    to={`/quizzes/${quizId}/attempts/${a.id}`}
                    className="flex items-center justify-between gap-3 px-3 py-2 text-sm transition-colors hover:bg-glass-hover sm:px-4"
                  >
                    <span className="min-w-0 flex-1 truncate text-text-secondary">
                      {completed ? (
                        <>
                          <span className="sm:hidden">
                            {completed.toLocaleDateString()}
                          </span>
                          <span className="hidden sm:inline">
                            {completed.toLocaleString()}
                          </span>
                        </>
                      ) : (
                        "In progress"
                      )}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 font-medium tabular-nums",
                        pct >= 80
                          ? "text-green-400"
                          : pct >= 50
                            ? "text-amber-400"
                            : "text-red-400",
                      )}
                    >
                      {a.score}/{a.total} ({pct}%)
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {isOwner && <MostMissedSection stats={stats} />}

      {questions.length === 0 && isOwner && (
        <div className="rounded-xl border border-dashed border-glass-border p-6 text-center">
          <p className="text-sm text-text-muted">
            This quiz has no questions yet.
          </p>
          <Link
            to={`/quizzes/${quizId}/edit`}
            className="mt-3 inline-block text-sm text-accent-purple hover:underline"
          >
            Add questions →
          </Link>
        </div>
      )}

      {/* Confirm delete */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setConfirmDelete(false)}
          />
          <div className="relative z-10 w-full max-w-sm rounded-xl border border-glass-border bg-bg-secondary/95 p-6 backdrop-blur-xl">
            <h3 className="mb-2 text-lg font-semibold text-text-primary">
              Delete quiz?
            </h3>
            <p className="mb-4 text-sm text-text-muted">
              This permanently removes the quiz, its questions, and every
              attempt ever taken. Cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => setConfirmDelete(false)}
              >
                Cancel
              </Button>
              <button
                onClick={handleDelete}
                className="rounded-lg bg-red-500/20 px-4 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/30 cursor-pointer"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MostMissedSection({ stats }: { stats: QuizQuestionStat[] }) {
  const answered = stats.filter((s) => s.attempts > 0);
  if (answered.length === 0) return null;

  const sorted = [...answered].sort((a, b) => {
    const rateA = a.wrong / a.attempts;
    const rateB = b.wrong / b.attempts;
    if (rateB !== rateA) return rateB - rateA;
    return b.attempts - a.attempts;
  });
  const top = sorted.slice(0, 5);
  const totalAnswers = answered.reduce((n, s) => n + s.attempts, 0);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm font-semibold uppercase tracking-wider text-text-muted">
        <div className="flex items-center gap-2">
          <AlertTriangle size={14} />
          Most missed
        </div>
        <span className="text-[11px] font-normal normal-case text-text-muted">
          across {totalAnswers.toLocaleString()} answer
          {totalAnswers === 1 ? "" : "s"}
        </span>
      </div>
      <ul className="divide-y divide-glass-border overflow-hidden rounded-xl border border-glass-border">
        {top.map((s) => {
          const rate = s.attempts > 0 ? s.wrong / s.attempts : 0;
          const pct = Math.round(rate * 100);
          return (
            <li
              key={s.question_id}
              className="flex items-start justify-between gap-3 px-3 py-2 text-sm sm:px-4"
            >
              <span className="min-w-0 flex-1 text-text-secondary">
                <span className="mr-1 tabular-nums text-text-muted">
                  {s.question_position + 1}.
                </span>
                <span className="break-words">{s.question_text}</span>
              </span>
              <span
                className={cn(
                  "shrink-0 whitespace-nowrap font-medium tabular-nums",
                  pct >= 50
                    ? "text-red-400"
                    : pct >= 25
                      ? "text-amber-400"
                      : "text-text-muted",
                )}
              >
                {pct}% · {s.wrong}/{s.attempts}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
