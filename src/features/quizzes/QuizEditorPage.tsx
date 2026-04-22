import { useEffect, useState } from "react";
import {
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router";
import { ArrowLeft, Plus, Trash2, Check, Loader2 } from "lucide-react";
import { Button, Toggle } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useQuizStore } from "@/stores/quiz-store";
import { useAuthStore } from "@/stores/auth-store";
import type { QuizQuestionDraft, QuizVisibility } from "@/types/quiz";
import { AiGeneratePanel } from "./AiGeneratePanel";

function emptyQuestion(): QuizQuestionDraft {
  return {
    question_text: "",
    option_a: "",
    option_b: "",
    option_c: "",
    option_d: "",
    correct_index: 0,
    explanation: null,
  };
}

export function QuizEditorPage() {
  const { quizId } = useParams<{ quizId?: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const [searchParams] = useSearchParams();

  const createQuiz = useQuizStore((s) => s.createQuiz);
  const updateQuiz = useQuizStore((s) => s.updateQuiz);
  const getQuiz = useQuizStore((s) => s.getQuiz);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<QuizVisibility>("private");
  const [catalogBookId, setCatalogBookId] = useState<string | null>(
    searchParams.get("catalog_book_id"),
  );
  const [uploadedBookId, setUploadedBookId] = useState<string | null>(
    searchParams.get("uploaded_book_id"),
  );
  const [questions, setQuestions] = useState<QuizQuestionDraft[]>([
    emptyQuestion(),
  ]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingInitial, setLoadingInitial] = useState(!!quizId);

  // If editing, load existing quiz
  useEffect(() => {
    if (!quizId) return;
    let cancelled = false;
    (async () => {
      const data = await getQuiz(quizId);
      if (cancelled || !data) return;
      setTitle(data.quiz.title);
      setDescription(data.quiz.description ?? "");
      setVisibility(data.quiz.visibility);
      setCatalogBookId(data.quiz.catalog_book_id);
      setUploadedBookId(data.quiz.uploaded_book_id);
      setQuestions(
        data.questions.length > 0
          ? data.questions.map((q) => ({
              id: q.id,
              question_text: q.question_text,
              option_a: q.option_a,
              option_b: q.option_b,
              option_c: q.option_c,
              option_d: q.option_d,
              correct_index: q.correct_index,
              explanation: q.explanation,
            }))
          : [emptyQuestion()],
      );
      setLoadingInitial(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [quizId, getQuiz]);

  if (!user) {
    return (
      <div className="mx-auto w-full max-w-2xl p-6 text-center">
        <p className="text-text-muted">
          Please sign in to create a quiz.
        </p>
      </div>
    );
  }

  if (loadingInitial) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 size={20} className="animate-spin text-text-muted" />
      </div>
    );
  }

  const addQuestion = () =>
    setQuestions((qs) => [...qs, emptyQuestion()]);
  const removeQuestion = (i: number) =>
    setQuestions((qs) => qs.filter((_, idx) => idx !== i));
  const patchQuestion = (i: number, patch: Partial<QuizQuestionDraft>) =>
    setQuestions((qs) =>
      qs.map((q, idx) => (idx === i ? { ...q, ...patch } : q)),
    );

  const isEmptyDraft = (q: QuizQuestionDraft) =>
    !q.question_text.trim() &&
    !q.option_a.trim() &&
    !q.option_b.trim() &&
    !q.option_c.trim() &&
    !q.option_d.trim();

  const appendGeneratedQuestions = (drafts: QuizQuestionDraft[]) => {
    if (drafts.length === 0) return;
    setQuestions((qs) => {
      // Drop a single blank starter row so generation doesn't leave a
      // leading empty question, but keep any real user entries.
      const keep = qs.length === 1 && isEmptyDraft(qs[0]) ? [] : qs;
      return [...keep, ...drafts];
    });
  };

  const handleSave = async () => {
    setError(null);
    if (!title.trim()) return setError("Title is required.");
    if (questions.length === 0)
      return setError("Add at least one question.");
    for (const [i, q] of questions.entries()) {
      if (!q.question_text.trim())
        return setError(`Question ${i + 1} needs text.`);
      if (!q.option_a.trim() || !q.option_b.trim() || !q.option_c.trim() || !q.option_d.trim())
        return setError(`Question ${i + 1} needs all four options filled.`);
    }

    setSaving(true);
    try {
      if (quizId) {
        await updateQuiz(
          quizId,
          {
            title: title.trim(),
            description: description.trim() || null,
            visibility,
            catalog_book_id: catalogBookId,
            uploaded_book_id: uploadedBookId,
          },
          questions,
        );
        navigate(`/quizzes/${quizId}`);
      } else {
        const id = await createQuiz({
          title: title.trim(),
          description: description.trim() || null,
          visibility,
          catalog_book_id: catalogBookId,
          uploaded_book_id: uploadedBookId,
          questions,
        });
        if (id) navigate(`/quizzes/${id}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save quiz.");
    } finally {
      setSaving(false);
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

      <header>
        <h1 className="text-2xl font-bold text-text-primary">
          {quizId ? "Edit quiz" : "New quiz"}
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          Multiple-choice quiz with four options per question.
        </p>
      </header>

      {/* Basics */}
      <section className="space-y-4 rounded-xl border border-glass-border bg-glass-bg/40 p-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-text-muted">
            Title *
          </label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Chapter 3 review"
            maxLength={140}
            className="w-full rounded-lg border border-glass-border bg-bg-primary/50 px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-purple/50"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-text-muted">
            Description
          </label>
          <textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional — a line or two about what this quiz covers."
            maxLength={500}
            className="w-full resize-none rounded-lg border border-glass-border bg-bg-primary/50 px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-purple/50"
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border border-glass-border bg-bg-primary/40 px-3 py-2">
          <div>
            <p className="text-sm font-medium text-text-primary">Public</p>
            <p className="text-xs text-text-muted">
              Visible in the community quizzes feed.
            </p>
          </div>
          <Toggle
            checked={visibility === "public"}
            onChange={(v) => setVisibility(v ? "public" : "private")}
          />
        </div>
      </section>

      <AiGeneratePanel
        onAppend={appendGeneratedQuestions}
        uploadedBookId={uploadedBookId}
        catalogBookId={catalogBookId}
      />

      {/* Questions */}
      <section className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-text-muted">
            Questions ({questions.length})
          </h2>
          <Button
            variant="secondary"
            onClick={addQuestion}
            className="gap-1 px-2.5 py-1 text-xs"
          >
            <Plus size={14} />
            <span className="hidden sm:inline">Add question</span>
            <span className="sm:hidden">Add</span>
          </Button>
        </div>

        {questions.map((q, i) => (
          <div
            key={i}
            className="space-y-3 rounded-xl border border-glass-border bg-glass-bg/40 p-4"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs font-medium text-text-muted">
                Question {i + 1}
              </p>
              {questions.length > 1 && (
                <button
                  onClick={() => removeQuestion(i)}
                  className="rounded-md p-1 text-text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
                  aria-label="Remove question"
                  title="Remove question"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>

            <textarea
              rows={2}
              value={q.question_text}
              onChange={(e) =>
                patchQuestion(i, { question_text: e.target.value })
              }
              placeholder="What's the question?"
              className="w-full resize-none rounded-lg border border-glass-border bg-bg-primary/50 px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-purple/50"
            />

            <div className="grid gap-2 sm:grid-cols-2">
              {(["option_a", "option_b", "option_c", "option_d"] as const).map(
                (key, idx) => {
                  const isCorrect = q.correct_index === idx;
                  return (
                    <div
                      key={key}
                      className={cn(
                        "flex items-center gap-2 rounded-lg border px-2 py-1.5 transition-colors",
                        isCorrect
                          ? "border-green-500/50 bg-green-500/5"
                          : "border-glass-border bg-bg-primary/40",
                      )}
                    >
                      <button
                        onClick={() => patchQuestion(i, { correct_index: idx })}
                        className={cn(
                          "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-colors cursor-pointer",
                          isCorrect
                            ? "border-green-500 bg-green-500 text-white"
                            : "border-text-muted/40 text-text-muted hover:border-accent-purple",
                        )}
                        aria-label={`Mark option ${"ABCD"[idx]} as correct`}
                        title={isCorrect ? "Correct answer" : "Mark correct"}
                      >
                        {isCorrect ? <Check size={12} /> : <span className="text-[10px] font-semibold">{"ABCD"[idx]}</span>}
                      </button>
                      <input
                        value={q[key]}
                        onChange={(e) =>
                          patchQuestion(i, { [key]: e.target.value } as Partial<QuizQuestionDraft>)
                        }
                        placeholder={`Option ${"ABCD"[idx]}`}
                        className="min-w-0 flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted"
                      />
                    </div>
                  );
                },
              )}
            </div>

            <input
              value={q.explanation ?? ""}
              onChange={(e) =>
                patchQuestion(i, { explanation: e.target.value })
              }
              placeholder="Explanation shown after answering (optional)"
              className="w-full rounded-lg border border-glass-border bg-bg-primary/40 px-3 py-2 text-xs text-text-primary outline-none focus:border-accent-purple/50"
            />
          </div>
        ))}
      </section>

      {error && (
        <p className="rounded-lg bg-red-500/10 p-3 text-sm text-red-400">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={() => navigate(-1)} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Saving…
            </>
          ) : quizId ? (
            "Save changes"
          ) : (
            "Create quiz"
          )}
        </Button>
      </div>
    </div>
  );
}
