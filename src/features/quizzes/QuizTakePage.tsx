import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Loader2,
  SkipForward,
  X,
} from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { track } from "@/lib/telemetry";
import { useQuizStore } from "@/stores/quiz-store";
import type { SubmitAnswer } from "@/stores/quiz-store";
import { useAuthStore } from "@/stores/auth-store";
import {
  gradeAnswer,
  parseCorrectIndices,
  serializeIndices,
  type Quiz,
  type QuizQuestion,
} from "@/types/quiz";

// Pairs each question with the order in which its options should be
// displayed. For non-mcq4 kinds (or when randomize_options is off)
// the order is identity [0,1,2,3], the renderer can ignore the
// distinction. For mcq4 with randomization enabled, the array is a
// permutation. The user's pick is in *displayed-index space* and we
// translate back via this array before storing the answer, so the
// stored selected_index always matches the canonical option order
// in the database (which is what FSRS / attempt history rely on).
type PlayItem = {
  question: QuizQuestion;
  optionOrder: number[];
};

// Per-question interaction state, indexed parallel to playOrder. Picks
// are held in *displayed-index* space (see optionOrder); `answer` is the
// graded, canonical-space result set when the question is revealed.
type QState = {
  pickedIndex: number | null;
  multiPicked: number[];
  typedText: string;
  revealed: boolean;
  answer: SubmitAnswer | null;
};

function initStates(len: number): QState[] {
  return Array.from({ length: len }, () => ({
    pickedIndex: null,
    multiPicked: [],
    typedText: "",
    revealed: false,
    answer: null,
  }));
}

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
      quiz.randomize_options && (q.kind === "mcq4" || q.kind === "multi_select")
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
  // One entry per question in play order, so navigating back and forth
  // preserves each question's picks + revealed verdict instead of the
  // old append-only answers array (which duplicated on revisit).
  const [states, setStates] = useState<QState[]>([]);
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
        setStates(initStates(data.questions.length));
        track("quiz_start", { quiz: quizId, questions: data.questions.length });
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [quizId, getQuiz]);

  const playItem = playOrder[current];
  const q = playItem?.question;
  const st = states[current];
  const score = useMemo(
    () => states.reduce((n, s) => (s.answer?.is_correct ? n + 1 : n), 0),
    [states],
  );
  const answeredCount = useMemo(
    () => states.reduce((n, s) => (s.answer ? n + 1 : n), 0),
    [states],
  );
  const isLast = current === playOrder.length - 1;

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 size={20} className="animate-spin text-text-muted" />
      </div>
    );
  }
  if (!quiz || playOrder.length === 0 || !q || !playItem || !st) {
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

  const patchState = (patch: Partial<QState>) =>
    setStates((prev) =>
      prev.map((s, i) => (i === current ? { ...s, ...patch } : s)),
    );

  const canAnswer =
    q.kind === "short_answer"
      ? st.typedText.trim().length > 0
      : q.kind === "multi_select"
        ? st.multiPicked.length > 0
        : st.pickedIndex !== null;

  const reveal = () => {
    if (!canAnswer || st.revealed) return;
    // Picks are in *displayed* order. Translate back to the canonical
    // option index/indices before storing so submitAttempt / FSRS see
    // the same selection they would for an unshuffled quiz.
    let selectedIndex: number | null = null;
    let selectedText: string | null = null;
    if (q.kind === "short_answer") {
      selectedText = st.typedText.trim();
    } else if (q.kind === "multi_select") {
      const original = st.multiPicked.map((i) => playItem.optionOrder[i]);
      selectedText = serializeIndices(original);
    } else {
      selectedIndex =
        st.pickedIndex !== null ? playItem.optionOrder[st.pickedIndex] : null;
    }
    const answer: SubmitAnswer = {
      question_id: q.id,
      selected_index: selectedIndex,
      selected_text: selectedText,
      is_correct: gradeAnswer(q, {
        selected_index: selectedIndex,
        selected_text: selectedText,
      }),
    };
    patchState({ revealed: true, answer });
  };

  const goPrev = () => {
    if (current > 0) setCurrent((c) => c - 1);
  };

  const finish = async () => {
    // Only answered (revealed) questions carry a row; skipped ones are
    // simply absent, but `total` still counts every question so the
    // score denominator reflects the full quiz.
    const answered = states
      .map((s) => s.answer)
      .filter((a): a is SubmitAnswer => a !== null);
    track("quiz_done", {
      score: answered.filter((a) => a.is_correct).length,
      total: playOrder.length,
      inline: false,
    });
    if (!user) {
      setDone(true);
      return;
    }
    setSubmitting(true);
    try {
      await submitAttempt(quiz.id, answered, playOrder.length);
    } finally {
      setSubmitting(false);
      setDone(true);
    }
  };

  // Advance (Next after revealing, or Skip without answering). On the
  // last question this finishes the attempt.
  const goNext = () => {
    if (isLast) {
      void finish();
      return;
    }
    setCurrent((c) => c + 1);
  };

  const restart = () => {
    // Re-shuffle on restart so a "Retry" actually feels different
    // when randomization is on.
    setPlayOrder(buildPlayOrder(quiz, questions));
    setStates(initStates(questions.length));
    setCurrent(0);
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
              answer={states[idx]?.answer ?? null}
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
          // space, translate correct_index via optionOrder.indexOf.
          options={playItem.optionOrder.map(
            (origIdx) =>
              [q.option_a, q.option_b, q.option_c, q.option_d][origIdx],
          )}
          correctIndex={
            q.correct_index !== null
              ? playItem.optionOrder.indexOf(q.correct_index)
              : null
          }
          selected={st.pickedIndex}
          revealed={st.revealed}
          onSelect={(i) => patchState({ pickedIndex: i })}
        />
      )}

      {q.kind === "multi_select" && (
        <MultiSelectOptions
          options={playItem.optionOrder.map(
            (origIdx) =>
              [q.option_a, q.option_b, q.option_c, q.option_d][origIdx],
          )}
          // Correct set translated into displayed space.
          correctIndices={parseCorrectIndices(q.correct_text)
            .map((ci) => playItem.optionOrder.indexOf(ci))
            .filter((i) => i >= 0)}
          selected={st.multiPicked}
          revealed={st.revealed}
          onToggle={(i) =>
            patchState({
              multiPicked: st.multiPicked.includes(i)
                ? st.multiPicked.filter((n) => n !== i)
                : [...st.multiPicked, i],
            })
          }
        />
      )}

      {q.kind === "true_false" && (
        <TrueFalseOptions
          labels={[q.option_a ?? "True", q.option_b ?? "False"]}
          correctIndex={q.correct_index}
          selected={st.pickedIndex}
          revealed={st.revealed}
          onSelect={(i) => patchState({ pickedIndex: i })}
        />
      )}

      {q.kind === "short_answer" && (
        <ShortAnswerInput
          value={st.typedText}
          onChange={(v) => patchState({ typedText: v })}
          revealed={st.revealed}
          isCorrect={!!st.answer?.is_correct}
          correctText={q.correct_text ?? ""}
          onSubmit={() => {
            if (canAnswer && !st.revealed) reveal();
          }}
        />
      )}

      {st.revealed && q.explanation && (
        <p className="rounded-lg border border-glass-border bg-glass-bg/40 p-3 text-sm text-text-secondary">
          {q.explanation}
        </p>
      )}

      <div className="flex items-center justify-between gap-2">
        <Button
          variant="ghost"
          onClick={goPrev}
          disabled={current === 0 || submitting}
          className="gap-1"
        >
          <ArrowLeft size={14} />
          {t("quizzes.take.previous")}
        </Button>

        <div className="flex items-center gap-2">
          {!st.revealed && (
            <Button
              variant="secondary"
              onClick={goNext}
              disabled={submitting}
              className="gap-1"
            >
              <SkipForward size={14} />
              {t("quizzes.take.skip")}
            </Button>
          )}
          {!st.revealed ? (
            <Button onClick={reveal} disabled={!canAnswer}>
              {t("common.submit")}
            </Button>
          ) : (
            <Button onClick={goNext} disabled={submitting}>
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

      {isLast && !st.revealed && answeredCount > 0 && (
        <p className="text-right text-2xs text-text-muted">
          {t("quizzes.take.skipToFinishHint")}
        </p>
      )}
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

export function MultiSelectOptions({
  options,
  correctIndices,
  selected,
  revealed,
  onToggle,
}: {
  options: (string | null)[];
  correctIndices: number[];
  selected: number[];
  revealed: boolean;
  onToggle: (i: number) => void;
}) {
  return (
    <div className="space-y-2">
      {options.map((opt, idx) => {
        const isSelected = selected.includes(idx);
        const isCorrect = correctIndices.includes(idx);
        // After reveal: correct picks + missed corrects are green;
        // wrongly-picked options are red.
        const showGood = revealed && isCorrect;
        const showBad = revealed && isSelected && !isCorrect;
        return (
          <button
            key={idx}
            onClick={() => !revealed && onToggle(idx)}
            disabled={revealed}
            className={cn(
              "flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left text-sm transition-colors",
              !revealed && "cursor-pointer",
              showGood
                ? "border-success/50 bg-success/10 text-text-primary"
                : showBad
                  ? "border-danger/50 bg-danger/10 text-text-primary"
                  : isSelected
                    ? "border-accent/60 bg-accent/10 text-text-primary"
                    : "border-glass-border bg-glass-bg/40 text-text-secondary hover:border-accent/40 hover:text-text-primary",
            )}
          >
            <span
              className={cn(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-2xs font-semibold",
                isSelected
                  ? "border-accent bg-accent/20 text-accent"
                  : "border-text-muted/40 text-text-muted",
              )}
            >
              {isSelected ? <Check size={13} /> : "ABCD"[idx]}
            </span>
            <span className="min-w-0 flex-1 break-words">{opt}</span>
            {showGood && <Check size={14} className="shrink-0 text-success" />}
            {showBad && <X size={14} className="shrink-0 text-danger" />}
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
  onSubmit,
}: {
  value: string;
  onChange: (v: string) => void;
  revealed: boolean;
  isCorrect: boolean;
  correctText: string;
  /** Fired when the user presses Enter (before reveal). Ignores IME
   *  composition so mid-composition Enter doesn't submit. */
  onSubmit?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter" || revealed || !onSubmit) return;
          // Skip while an IME is composing (same guard as the chat
          // composer): nativeEvent.isComposing or the legacy 229 keyCode.
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          e.preventDefault();
          onSubmit();
        }}
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
      ) : question.kind === "multi_select" ? (
        <div className="space-y-1">
          {(() => {
            const correctSet = parseCorrectIndices(question.correct_text);
            const pickedSet = parseCorrectIndices(answer?.selected_text);
            return [
              question.option_a,
              question.option_b,
              question.option_c,
              question.option_d,
            ].map((opt, optIdx) => {
              const isCorrect = correctSet.includes(optIdx);
              const isPicked = pickedSet.includes(optIdx);
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
            });
          })()}
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
