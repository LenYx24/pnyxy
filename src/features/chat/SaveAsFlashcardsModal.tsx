import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { Loader2, Plus, Sparkles, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useQuizStore } from "@/stores/quiz-store";
import {
  extractFlashcards,
  type FlashcardDraft,
} from "@/lib/ai/extract-flashcards";

interface SaveAsFlashcardsModalProps {
  open: boolean;
  onClose: () => void;
  /** The assistant message text we're extracting from. */
  passage: string;
  /** Default title for the saved quiz, the conversation title is a
   *  good seed; user can edit before save. */
  defaultTitle: string;
}

/**
 * Run an LLM extractor over an assistant message and let the user
 * curate the resulting Q/A list before turning it into a saved
 * short-answer quiz. The quiz feature already plumbs FSRS spaced-
 * repetition review (`quiz_reviews` table), so cards saved here
 * automatically appear in the user's review queue.
 */
export function SaveAsFlashcardsModal({
  open,
  onClose,
  passage,
  defaultTitle,
}: SaveAsFlashcardsModalProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const createQuiz = useQuizStore((s) => s.createQuiz);

  const [extracting, setExtracting] = useState(false);
  const [cards, setCards] = useState<FlashcardDraft[]>([]);
  const [title, setTitle] = useState(defaultTitle);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Each open is a fresh extraction. Keeps state simple and avoids
  // showing stale cards from a previous message.
  useEffect(() => {
    if (!open) return;
    setTitle(defaultTitle);
    setError(null);
    setCards([]);
    setExtracting(true);
    let cancelled = false;
    extractFlashcards(passage)
      .then((next) => {
        if (cancelled) return;
        setCards(next);
        if (next.length === 0) {
          setError(t("chat.flashcards.noneFound"));
        }
      })
      .catch(() => {
        if (cancelled) return;
        setError(t("chat.flashcards.extractFailed"));
      })
      .finally(() => {
        if (!cancelled) setExtracting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, passage, defaultTitle, t]);

  const updateCard = (i: number, patch: Partial<FlashcardDraft>) =>
    setCards((prev) =>
      prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)),
    );
  const removeCard = (i: number) =>
    setCards((prev) => prev.filter((_, idx) => idx !== i));
  const addCard = () =>
    setCards((prev) => [...prev, { question: "", answer: "" }]);

  const cleanCards = cards
    .map((c) => ({ question: c.question.trim(), answer: c.answer.trim() }))
    .filter((c) => c.question && c.answer);
  const canSave =
    !extracting && !saving && cleanCards.length > 0 && title.trim().length > 0;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const id = await createQuiz({
        title: title.trim(),
        description: t("chat.flashcards.savedDescription"),
        visibility: "private",
        uploaded_book_id: null,
        catalog_book_id: null,
        questions: cleanCards.map((c) => ({
          kind: "short_answer",
          question_text: c.question,
          option_a: "",
          option_b: "",
          option_c: "",
          option_d: "",
          correct_index: 0,
          correct_text: c.answer,
          explanation: null,
        })),
      });
      onClose();
      if (id) navigate(`/quizzes/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => !saving && onClose()}
      />
      <div className="relative z-10 flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl border border-glass-border bg-bg-secondary/95 backdrop-blur-xl">
        <div className="flex items-center justify-between border-b border-glass-border px-5 py-3">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-accent" />
            <h2 className="text-lg font-semibold text-text-primary">
              {t("chat.flashcards.title")}
            </h2>
          </div>
          <button
            onClick={onClose}
            disabled={saving}
            className="rounded-md p-1 text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer disabled:opacity-50"
            aria-label={t("common.close")}
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-5">
          {/* Title */}
          <div>
            <label className="mb-1 block text-xs font-medium text-text-secondary">
              {t("chat.flashcards.titleLabel")}
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={140}
              className="w-full rounded-lg border border-glass-border bg-bg-primary/50 px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
            />
          </div>

          {/* Cards / loading / error */}
          {extracting ? (
            <div className="flex items-center gap-2 py-6 text-sm text-text-muted">
              <Loader2 size={16} className="animate-spin text-accent" />
              {t("chat.flashcards.extracting")}
            </div>
          ) : error ? (
            <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          ) : (
            <>
              <p className="text-xs text-text-muted">
                {t("chat.flashcards.editHint", { count: cards.length })}
              </p>
              {cards.map((card, i) => (
                <div
                  key={i}
                  className="space-y-2 rounded-lg border border-glass-border bg-glass-bg/40 p-3"
                >
                  <div className="flex items-start gap-2">
                    <span className="mt-1.5 shrink-0 rounded bg-accent/15 px-1.5 py-0.5 text-2xs font-medium uppercase tracking-wider text-accent">
                      Q
                    </span>
                    <textarea
                      rows={1}
                      value={card.question}
                      onChange={(e) =>
                        updateCard(i, { question: e.target.value })
                      }
                      placeholder={t("chat.flashcards.questionPlaceholder")}
                      className="min-h-[2rem] flex-1 resize-none rounded border border-glass-border bg-bg-primary/50 px-2 py-1 text-sm text-text-primary outline-none focus:border-accent"
                    />
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="mt-1.5 shrink-0 rounded bg-success/15 px-1.5 py-0.5 text-2xs font-medium uppercase tracking-wider text-success">
                      A
                    </span>
                    <textarea
                      rows={1}
                      value={card.answer}
                      onChange={(e) =>
                        updateCard(i, { answer: e.target.value })
                      }
                      placeholder={t("chat.flashcards.answerPlaceholder")}
                      className="min-h-[2rem] flex-1 resize-none rounded border border-glass-border bg-bg-primary/50 px-2 py-1 text-sm text-text-primary outline-none focus:border-accent"
                    />
                    <button
                      onClick={() => removeCard(i)}
                      className="shrink-0 rounded p-1 text-text-muted transition-colors hover:bg-danger/10 hover:text-danger cursor-pointer"
                      aria-label={t("chat.flashcards.removeCard")}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
              <button
                onClick={addCard}
                className={cn(
                  "flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-glass-border bg-glass-bg/30 py-2 text-xs text-text-muted transition-colors cursor-pointer",
                  "hover:border-accent/40 hover:bg-glass-hover hover:text-text-primary",
                )}
              >
                <Plus size={12} />
                {t("chat.flashcards.addCard")}
              </button>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-glass-border px-5 py-3">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleSave} disabled={!canSave}>
            {saving ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                {t("common.saving")}
              </>
            ) : (
              t("chat.flashcards.saveQuiz", { count: cleanCards.length })
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
