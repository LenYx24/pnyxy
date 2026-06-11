import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  ArrowRight,
  BrainCircuit,
  Check,
  Loader2,
  PartyPopper,
} from "lucide-react";
import { Button } from "@/components/ui";
import { useQuizStore } from "@/stores/quiz-store";
import { useAuthStore } from "@/stores/auth-store";
import { gradeAnswer, type DueReview } from "@/types/quiz";
import {
  McqOptions,
  ShortAnswerInput,
  TrueFalseOptions,
} from "./QuizTakePage";

const DEFAULT_BATCH = 20;

export function QuizReviewPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const fetchDueReviews = useQuizStore((s) => s.fetchDueReviews);
  const recordReviewBatch = useQuizStore((s) => s.recordReviewBatch);

  const [loading, setLoading] = useState(true);
  const [queue, setQueue] = useState<DueReview[]>([]);
  const [index, setIndex] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);

  const [pickedIndex, setPickedIndex] = useState<number | null>(null);
  const [typedText, setTypedText] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [recording, setRecording] = useState(false);
  const [wasCorrect, setWasCorrect] = useState(false);

  const current = queue[index];
  const finished = !loading && queue.length > 0 && index >= queue.length;

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const due = await fetchDueReviews(DEFAULT_BATCH);
      if (cancelled) return;
      setQueue(due);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, fetchDueReviews]);

  const canReveal = useMemo(() => {
    if (!current) return false;
    if (current.question.kind === "short_answer") {
      return typedText.trim().length > 0;
    }
    return pickedIndex !== null;
  }, [current, typedText, pickedIndex]);

  if (!user) {
    return (
      <div className="mx-auto w-full max-w-xl p-6 text-center">
        <p className="text-text-muted">
          {t("quizzes.review.signInRequired")}
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 size={20} className="animate-spin text-text-muted" />
      </div>
    );
  }

  if (queue.length === 0) {
    return (
      <EmptyState
        title={t("quizzes.review.nothingDue")}
        body={t("quizzes.review.nothingDueBody")}
      />
    );
  }

  if (finished) {
    const pct = Math.round((correctCount / queue.length) * 100);
    return (
      <div className="mx-auto w-full max-w-xl space-y-5 p-4 sm:p-6 text-center">
        <div className="flex justify-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/15 text-accent">
            <PartyPopper size={24} />
          </div>
        </div>
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-text-primary">
            {t("quizzes.review.sessionComplete")}
          </h1>
          <p className="text-sm text-text-muted">
            {t("quizzes.review.sessionResult", {
              correct: correctCount,
              total: queue.length,
              pct,
              count: queue.length,
            })}
          </p>
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-center">
          <Button
            variant="secondary"
            onClick={() => navigate("/quizzes")}
            className="w-full sm:w-auto"
          >
            {t("quizzes.review.browseQuizzes")}
          </Button>
          <Button
            onClick={async () => {
              setLoading(true);
              setIndex(0);
              setCorrectCount(0);
              setPickedIndex(null);
              setTypedText("");
              setRevealed(false);
              const due = await fetchDueReviews(DEFAULT_BATCH);
              setQueue(due);
              setLoading(false);
            }}
            className="w-full sm:w-auto"
          >
            {t("quizzes.review.loadMore")}
          </Button>
        </div>
      </div>
    );
  }

  if (!current) return null;
  const { question } = current;

  const reveal = async () => {
    if (!canReveal) return;
    const isCorrect = gradeAnswer(question, {
      selected_index: pickedIndex,
      selected_text: typedText,
    });
    setWasCorrect(isCorrect);
    setRevealed(true);
    setRecording(true);
    try {
      await recordReviewBatch([
        { question_id: question.id, is_correct: isCorrect },
      ]);
    } finally {
      setRecording(false);
    }
    if (isCorrect) setCorrectCount((n) => n + 1);
  };

  const next = () => {
    setIndex((i) => i + 1);
    setPickedIndex(null);
    setTypedText("");
    setRevealed(false);
  };

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5 p-4 sm:p-6">
      <button
        onClick={() => navigate("/quizzes")}
        className="flex items-center gap-1 text-sm text-text-muted transition-colors hover:text-text-primary cursor-pointer"
      >
        <ArrowLeft size={14} />
        {t("common.exit")}
      </button>

      <header className="space-y-1">
        <p className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-text-muted">
          <BrainCircuit size={13} />
          {t("quizzes.review.sessionTitle", {
            current: index + 1,
            total: queue.length,
          })}
        </p>
        <div className="h-1 w-full rounded-full bg-glass-bg">
          <div
            className="h-full rounded-full bg-accent transition-all"
            style={{ width: `${(index / queue.length) * 100}%` }}
          />
        </div>
      </header>

      <h2 className="text-lg font-semibold text-text-primary">
        {question.question_text}
      </h2>

      {question.kind === "mcq4" && (
        <McqOptions
          options={[
            question.option_a,
            question.option_b,
            question.option_c,
            question.option_d,
          ]}
          correctIndex={question.correct_index}
          selected={pickedIndex}
          revealed={revealed}
          onSelect={setPickedIndex}
        />
      )}
      {question.kind === "true_false" && (
        <TrueFalseOptions
          labels={[question.option_a ?? "True", question.option_b ?? "False"]}
          correctIndex={question.correct_index}
          selected={pickedIndex}
          revealed={revealed}
          onSelect={setPickedIndex}
        />
      )}
      {question.kind === "short_answer" && (
        <ShortAnswerInput
          value={typedText}
          onChange={setTypedText}
          revealed={revealed}
          isCorrect={wasCorrect}
          correctText={question.correct_text ?? ""}
        />
      )}

      {revealed && question.explanation && (
        <p className="rounded-lg border border-glass-border bg-glass-bg/40 p-3 text-sm text-text-secondary">
          {question.explanation}
        </p>
      )}

      <div className="flex justify-end gap-2">
        {!revealed ? (
          <Button onClick={reveal} disabled={!canReveal}>
            {t("common.submit")}
          </Button>
        ) : (
          <Button onClick={next} disabled={recording}>
            {recording ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <>
                {t("common.next")}
                <ArrowRight size={14} />
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <div className="mx-auto w-full max-w-xl space-y-5 p-4 sm:p-6 text-center">
      <div className="flex justify-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-glass-bg text-text-muted">
          <Check size={24} />
        </div>
      </div>
      <div className="space-y-1">
        <h1 className="text-2xl font-bold text-text-primary">{title}</h1>
        <p className="text-sm text-text-muted">{body}</p>
      </div>
      <div>
        <Button variant="secondary" onClick={() => navigate("/quizzes")}>
          {t("quizzes.review.browseQuizzes")}
        </Button>
      </div>
    </div>
  );
}
