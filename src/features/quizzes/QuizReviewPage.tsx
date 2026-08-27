import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  ArrowRight,
  BrainCircuit,
  Check,
  Loader2,
  PartyPopper,
  X,
} from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useQuizStore } from "@/stores/quiz-store";
import { useAuthStore } from "@/stores/auth-store";
import {
  gradeAnswer,
  parseCorrectIndices,
  serializeIndices,
  type DueReview,
} from "@/types/quiz";
import {
  McqOptions,
  MultiSelectOptions,
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
  const [multiPicked, setMultiPicked] = useState<number[]>([]);
  const [typedText, setTypedText] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [recording, setRecording] = useState(false);
  const [wasCorrect, setWasCorrect] = useState(false);
  // Guards exactly-once recording per card: reveal no longer records
  // (so the self-grade override can flip the verdict first); we commit
  // the FINAL wasCorrect when advancing or leaving the card instead.
  const recordedRef = useRef(false);

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
    if (current.question.kind === "multi_select") {
      return multiPicked.length > 0;
    }
    return pickedIndex !== null;
  }, [current, typedText, pickedIndex, multiPicked]);

  if (!user) {
    return (
      <div className="mx-auto w-full max-w-xl p-6 text-center">
        <p className="text-text-muted">{t("quizzes.review.signInRequired")}</p>
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
              setMultiPicked([]);
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

  const reveal = () => {
    if (!canReveal) return;
    const isCorrect = gradeAnswer(question, {
      selected_index: pickedIndex,
      selected_text:
        question.kind === "multi_select"
          ? serializeIndices(multiPicked)
          : typedText,
    });
    setWasCorrect(isCorrect);
    setRevealed(true);
  };

  // Records the current card's FSRS result exactly once, using the
  // final (possibly self-graded-override) wasCorrect. Called when the
  // user advances (Next) or leaves the card (Exit).
  const commitReview = async () => {
    if (!revealed || recordedRef.current) return;
    recordedRef.current = true;
    setRecording(true);
    try {
      await recordReviewBatch([
        { question_id: question.id, is_correct: wasCorrect },
      ]);
      if (wasCorrect) setCorrectCount((n) => n + 1);
    } catch (err) {
      // Allow a retry if the write failed.
      recordedRef.current = false;
      throw err;
    } finally {
      setRecording(false);
    }
  };

  const next = async () => {
    await commitReview();
    recordedRef.current = false;
    setIndex((i) => i + 1);
    setPickedIndex(null);
    setMultiPicked([]);
    setTypedText("");
    setRevealed(false);
    setWasCorrect(false);
  };

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5 p-4 sm:p-6">
      <button
        onClick={async () => {
          // Persist the in-progress card (if revealed) before leaving so
          // a reviewed-but-not-advanced card still records exactly once.
          try {
            await commitReview();
          } finally {
            navigate("/quizzes");
          }
        }}
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
      {question.kind === "multi_select" && (
        <MultiSelectOptions
          options={[
            question.option_a,
            question.option_b,
            question.option_c,
            question.option_d,
          ]}
          correctIndices={parseCorrectIndices(question.correct_text)}
          selected={multiPicked}
          revealed={revealed}
          onToggle={(i) =>
            setMultiPicked((prev) =>
              prev.includes(i) ? prev.filter((n) => n !== i) : [...prev, i],
            )
          }
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
          onSubmit={() => {
            if (canReveal && !revealed) reveal();
          }}
        />
      )}

      {revealed && question.explanation && (
        <p className="rounded-lg border border-glass-border bg-glass-bg/40 p-3 text-sm text-text-secondary">
          {question.explanation}
        </p>
      )}

      {revealed && (
        // Auto-grading one canonical answer can't cover synonyms or
        // phrasing, so let the user correct the verdict before it's
        // recorded. This flips wasCorrect, which commitReview persists.
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-glass-border bg-glass-bg/40 p-3 text-sm">
          <span
            className={cn(
              "flex items-center gap-1.5 font-medium",
              wasCorrect ? "text-success" : "text-danger",
            )}
          >
            {wasCorrect ? <Check size={14} /> : <X size={14} />}
            {wasCorrect
              ? t("quizzes.review.markedCorrect")
              : t("quizzes.review.markedIncorrect")}
          </span>
          <button
            type="button"
            onClick={() => setWasCorrect((v) => !v)}
            disabled={recording}
            className="rounded-md border border-glass-border px-2.5 py-1 text-sm text-text-secondary transition-colors hover:border-accent/40 hover:text-text-primary disabled:opacity-50 cursor-pointer"
          >
            {wasCorrect
              ? t("quizzes.review.markIncorrect")
              : t("quizzes.review.markCorrect")}
          </button>
        </div>
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
