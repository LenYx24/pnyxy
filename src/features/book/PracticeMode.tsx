import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useTranslation } from "react-i18next";
import {
  X,
  Loader2,
  Send,
  ArrowRight,
  RotateCcw,
  AlertTriangle,
  CheckCircle2,
  CircleHelp,
  XCircle,
  GraduationCap,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/logger";
import { extractPdfText } from "@/lib/ai/extract-exam-topics";
import {
  extractExamQuestions,
  type ExtractedQuestion,
} from "@/lib/ai/extract-exam-questions";
import {
  evaluatePracticeAnswer,
  parseVerdict,
} from "@/lib/quiz/evaluate-practice-answer";
import { renderMarkdown } from "@/lib/ai/markdown-message";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";

interface PracticeModeProps {
  open: boolean;
  onClose: () => void;
  exam: {
    id: string;
    name: string;
    file_name: string;
    storage_path: string;
  };
}

type Phase = "loading" | "ready" | "answering" | "feedback" | "done" | "error";

/**
 * Full-screen practice modal. Walks the student through the exam
 * one question at a time, asks them to type an answer, then streams
 * Socratic feedback that points at gaps without spelling out the
 * full solution. The pedagogy here mirrors the GPT Tutor arm of the
 * Bastani PNAS 2025 study, productive struggle over crutch usage.
 */
export function PracticeMode({ open, onClose, exam }: PracticeModeProps) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>("loading");
  const [questions, setQuestions] = useState<ExtractedQuestion[]>([]);
  const [examText, setExamText] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [userInput, setUserInput] = useState("");
  const [feedback, setFeedback] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  // Per-question history so the user can scan how they did at the end.
  // Map question index → final verdict label.
  const [verdicts, setVerdicts] = useState<
    Map<number, "correct" | "partial" | "incorrect">
  >(new Map());

  // Step 1: download the file, extract text, extract questions. All
  // session-only, re-run if the user re-opens the modal. Cheap
  // enough for the typical 5-12 question exam, and sidesteps a
  // schema migration to cache the questions on the row.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPhase("loading");
    setError(null);
    setQuestions([]);
    setCurrentIndex(0);
    setUserInput("");
    setFeedback("");
    setVerdicts(new Map());

    void (async () => {
      try {
        const { data: blob, error: dlError } = await supabase.storage
          .from("book-files")
          .download(exam.storage_path);
        if (dlError || !blob) {
          throw new Error(dlError?.message ?? "download failed");
        }
        const file = new File([blob], exam.file_name, {
          type: "application/pdf",
        });
        const text = await extractPdfText(file);
        if (cancelled) return;
        setExamText(text);
        const qs = await extractExamQuestions(text);
        if (cancelled) return;
        if (qs.length === 0) {
          setError(
            t("book.practice.noQuestions", {
              defaultValue:
                "Couldn't find clear questions in this exam. Try a different file.",
            }),
          );
          setPhase("error");
          return;
        }
        setQuestions(qs);
        setPhase("ready");
      } catch (err) {
        if (cancelled) return;
        logError("PracticeMode:setup", err);
        setError(
          err instanceof Error
            ? err.message
            : t("book.practice.setupFailed", {
                defaultValue: "Couldn't prepare the practice session.",
              }),
        );
        setPhase("error");
      }
    })();

    return () => {
      cancelled = true;
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [open, exam.storage_path, exam.file_name, t]);

  // Cancel any in-flight evaluation when the modal closes.
  useEffect(() => {
    if (!open) {
      abortRef.current?.abort();
      abortRef.current = null;
    }
  }, [open]);

  const currentQuestion = questions[currentIndex] ?? null;
  const total = questions.length;

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!currentQuestion) return;
      const answer = userInput.trim();
      if (!answer) return;
      setPhase("answering");
      setFeedback("");

      const ctrl = new AbortController();
      abortRef.current?.abort();
      abortRef.current = ctrl;

      try {
        let buf = "";
        for await (const delta of evaluatePracticeAnswer({
          question: currentQuestion.text,
          userAnswer: answer,
          examContext: examText,
          signal: ctrl.signal,
        })) {
          buf += delta;
          setFeedback(buf);
        }
        // Snapshot verdict once the stream settled.
        const v = parseVerdict(buf);
        if (v) {
          setVerdicts((prev) => {
            const next = new Map(prev);
            next.set(currentIndex, v);
            return next;
          });
        }
        setPhase("feedback");
      } catch (err) {
        if ((err as { name?: string })?.name === "AbortError") {
          // User closed / advanced past, silently swallow.
          return;
        }
        logError("PracticeMode:evaluate", err);
        setError(
          err instanceof Error
            ? err.message
            : t("book.practice.evalFailed", {
                defaultValue: "Couldn't evaluate the answer.",
              }),
        );
        setPhase("feedback");
      } finally {
        abortRef.current = null;
      }
    },
    [currentQuestion, userInput, examText, currentIndex, t],
  );

  const handleNext = () => {
    setUserInput("");
    setFeedback("");
    if (currentIndex + 1 >= total) {
      setPhase("done");
      return;
    }
    setCurrentIndex((i) => i + 1);
    setPhase("ready");
  };

  const handleRetry = () => {
    setFeedback("");
    setPhase("ready");
    // Keep userInput so they can edit instead of retyping from scratch.
  };

  const verdict = useMemo(() => parseVerdict(feedback), [feedback]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={phase === "answering" ? undefined : onClose}
      />
      <div className="relative z-10 flex h-full max-h-[95vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-glass-border bg-bg-secondary/95 backdrop-blur-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-glass-border p-4">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/15">
              <GraduationCap size={16} className="text-accent" />
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold text-text-primary">
                {t("book.practice.heading", {
                  defaultValue: "Practice: {{name}}",
                  name: exam.name,
                })}
              </h2>
              {phase !== "loading" && phase !== "error" && total > 0 && (
                <p className="text-xs text-text-muted">
                  {phase === "done"
                    ? t("book.practice.doneSubtitle", {
                        defaultValue: "Session complete",
                      })
                    : t("book.practice.progress", {
                        defaultValue: "Question {{current}} of {{total}}",
                        current: currentIndex + 1,
                        total,
                      })}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-text-muted transition-colors hover:text-text-primary cursor-pointer"
            aria-label={t("common.close", { defaultValue: "Close" })}
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {phase === "loading" && (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-text-muted">
              <Loader2 size={28} className="animate-spin text-accent" />
              <p className="text-sm">
                {t("book.practice.loadingQuestions", {
                  defaultValue: "Reading the exam and pulling out questions…",
                })}
              </p>
            </div>
          )}

          {phase === "error" && (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-text-muted">
              <AlertTriangle size={28} className="text-warning" />
              <p className="max-w-sm text-center text-sm text-danger">
                {error}
              </p>
              <Button variant="secondary" onClick={onClose}>
                {t("common.close", { defaultValue: "Close" })}
              </Button>
            </div>
          )}

          {phase === "done" && (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-success/15 text-success">
                <CheckCircle2 size={28} />
              </div>
              <h3 className="text-lg font-semibold text-text-primary">
                {t("book.practice.doneTitle", {
                  defaultValue: "Nice, you finished the practice.",
                })}
              </h3>
              <SessionStats verdicts={verdicts} total={total} />
              <Button onClick={onClose}>
                {t("common.close", { defaultValue: "Close" })}
              </Button>
            </div>
          )}

          {(phase === "ready" ||
            phase === "answering" ||
            phase === "feedback") &&
            currentQuestion && (
              <>
                <div className="rounded-xl border border-glass-border bg-glass-bg/30 p-4">
                  <p className="mb-1 text-2xs font-semibold uppercase tracking-wider text-text-muted">
                    {t("book.practice.questionLabel", {
                      defaultValue: "Question",
                    })}
                  </p>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-text-primary">
                    {currentQuestion.text}
                  </p>
                </div>

                {phase !== "ready" && (
                  <div
                    className={cn(
                      "rounded-xl border p-4",
                      verdict === "correct"
                        ? "border-success/40 bg-success/5"
                        : verdict === "partial"
                          ? "border-warning/40 bg-warning/5"
                          : verdict === "incorrect"
                            ? "border-danger/40 bg-danger/5"
                            : "border-glass-border bg-glass-bg/30",
                    )}
                  >
                    <p className="mb-2 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-text-muted">
                      <VerdictIcon verdict={verdict} streaming={phase === "answering"} />
                      {t("book.practice.feedbackLabel", {
                        defaultValue: "Tutor feedback",
                      })}
                    </p>
                    {feedback ? (
                      <div
                        className="ai-message break-words text-sm"
                        dangerouslySetInnerHTML={{
                          __html: renderMarkdown(feedback),
                        }}
                      />
                    ) : (
                      <div className="flex items-center gap-2 text-text-muted">
                        <Loader2 size={14} className="animate-spin" />
                        <span className="text-sm">
                          {t("book.practice.thinking", {
                            defaultValue: "Thinking…",
                          })}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
        </div>

        {/* Footer */}
        {(phase === "ready" || phase === "answering") && currentQuestion && (
          <form
            onSubmit={handleSubmit}
            className="border-t border-glass-border p-4 space-y-2"
          >
            <textarea
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  void handleSubmit(e as unknown as FormEvent);
                }
              }}
              placeholder={t("book.practice.answerPlaceholder", {
                defaultValue:
                  "Type your answer. Try first, the tutor won't reveal the solution.",
              })}
              rows={3}
              disabled={phase === "answering"}
              className="w-full resize-y rounded-lg border border-glass-border bg-bg-primary/50 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/25 disabled:opacity-60"
              autoFocus
            />
            <div className="flex justify-between gap-2">
              <p className="text-2xs text-text-muted">
                {t("book.practice.submitHint", {
                  defaultValue: "Cmd/Ctrl + Enter to submit",
                })}
              </p>
              <Button
                type="submit"
                disabled={phase === "answering" || !userInput.trim()}
              >
                {phase === "answering" ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Send size={14} />
                )}
                {t("book.practice.submit", { defaultValue: "Submit answer" })}
              </Button>
            </div>
          </form>
        )}

        {phase === "feedback" && currentQuestion && (
          <div className="flex justify-end gap-2 border-t border-glass-border p-4">
            <Button variant="secondary" onClick={handleRetry}>
              <RotateCcw size={14} />
              {t("book.practice.retry", { defaultValue: "Try again" })}
            </Button>
            <Button onClick={handleNext}>
              {currentIndex + 1 >= total
                ? t("book.practice.finish", { defaultValue: "Finish" })
                : t("book.practice.next", { defaultValue: "Next question" })}
              <ArrowRight size={14} />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function VerdictIcon({
  verdict,
  streaming,
}: {
  verdict: "correct" | "partial" | "incorrect" | null;
  streaming: boolean;
}) {
  if (streaming && !verdict) {
    return <Loader2 size={11} className="animate-spin" />;
  }
  if (verdict === "correct") {
    return <CheckCircle2 size={11} className="text-success" />;
  }
  if (verdict === "partial") {
    return <CircleHelp size={11} className="text-warning" />;
  }
  if (verdict === "incorrect") {
    return <XCircle size={11} className="text-danger" />;
  }
  return null;
}

function SessionStats({
  verdicts,
  total,
}: {
  verdicts: Map<number, "correct" | "partial" | "incorrect">;
  total: number;
}) {
  const { t } = useTranslation();
  const counts = useMemo(() => {
    let c = 0,
      p = 0,
      w = 0;
    for (const v of verdicts.values()) {
      if (v === "correct") c++;
      else if (v === "partial") p++;
      else if (v === "incorrect") w++;
    }
    return { c, p, w };
  }, [verdicts]);

  if (verdicts.size === 0) return null;
  return (
    <p className="text-xs text-text-muted">
      {t("book.practice.doneStats", {
        defaultValue:
          "{{correct}} correct · {{partial}} partial · {{incorrect}} missed · {{skipped}} skipped",
        correct: counts.c,
        partial: counts.p,
        incorrect: counts.w,
        skipped: total - verdicts.size,
      })}
    </p>
  );
}
