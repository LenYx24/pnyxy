import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { X, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useVocabStore } from "@/stores/vocab-store";
import type { VocabEntry, VocabRating } from "@/types/vocab";

interface FlashcardReviewProps {
  queue: VocabEntry[];
  onClose: () => void;
  /** Cram mode, review the queue without updating each card's
   *  FSRS schedule. Used by the "Review all" entry point so a
   *  pre-exam pass through non-due cards doesn't trash the spaced-
   *  repetition curve. Rating buttons still render (the user
   *  picks how they felt about the card) but the rating is dropped
   *  on the floor instead of feeding `recordReview`. */
  cram?: boolean;
}

function clozeSentence(sentence: string, word: string): string {
  if (!sentence) return "";
  // Case-insensitive replacement of the first match only; fall back
  // to the raw sentence if the word isn't present (context may have
  // been captured from a different inflection).
  const pattern = new RegExp(`\\b${escapeRegex(word)}\\b`, "i");
  return sentence.replace(pattern, "______");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const RATINGS: { key: VocabRating; tone: string }[] = [
  { key: "again", tone: "bg-danger/20 text-danger hover:bg-danger/30" },
  {
    key: "hard",
    tone: "bg-orange-500/20 text-orange-400 hover:bg-orange-500/30",
  },
  {
    key: "good",
    tone: "bg-accent/20 text-accent hover:bg-accent/30",
  },
  { key: "easy", tone: "bg-success/20 text-success hover:bg-success/30" },
];

export function FlashcardReview({
  queue,
  onClose,
  cram = false,
}: FlashcardReviewProps) {
  const { t } = useTranslation();
  const recordReview = useVocabStore((s) => s.recordReview);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);

  const current = queue[index];
  const total = queue.length;
  const done = index >= total;

  const cloze = useMemo(
    () => (current ? clozeSentence(current.contextSentence, current.word) : ""),
    [current],
  );

  const handleRate = useCallback(
    async (rating: VocabRating) => {
      if (!current) return;
      // In cram mode the rating is informational only, we don't
      // touch FSRS so a "review anyway" pass before an exam can't
      // pull the schedule forward or push it back unintentionally.
      if (!cram) await recordReview(current.id, rating);
      setRevealed(false);
      setIndex((i) => i + 1);
    },
    [current, recordReview, cram],
  );

  // Keyboard shortcuts: space/enter to reveal, 1-4 to rate.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (done) return;
      if (!revealed && (e.key === " " || e.key === "Enter")) {
        e.preventDefault();
        setRevealed(true);
        return;
      }
      if (revealed) {
        if (e.key === "1") handleRate("again");
        else if (e.key === "2") handleRate("hard");
        else if (e.key === "3") handleRate("good");
        else if (e.key === "4") handleRate("easy");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [revealed, done, handleRate]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="relative flex w-full max-w-xl flex-col gap-4 rounded-2xl border border-glass-border bg-bg-secondary/95 p-4 sm:p-6 shadow-2xl backdrop-blur-xl max-h-[90vh] overflow-y-auto">
        <button
          onClick={onClose}
          aria-label={t("common.close")}
          className="absolute right-3 top-3 rounded-md p-1.5 text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
        >
          <X size={18} />
        </button>

        <header className="flex items-center justify-between gap-2 pr-8">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-text-primary">
              {t("vocabulary.review.title")}
            </h2>
            {cram && (
              <span
                className="rounded-full bg-orange-500/20 px-2 py-0.5 text-2xs font-semibold uppercase tracking-wide text-orange-300"
                title={t("vocabulary.review.cramHint", {
                  defaultValue:
                    "Cram mode — ratings don't change the FSRS schedule",
                })}
              >
                {t("vocabulary.review.cramBadge", { defaultValue: "Cram" })}
              </span>
            )}
          </div>
          <span className="text-sm text-text-muted">
            {done
              ? t("vocabulary.review.done")
              : t("vocabulary.review.progress", {
                  current: index + 1,
                  total,
                })}
          </span>
        </header>

        {done ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="text-base text-text-primary">
              {t("vocabulary.review.allCaughtUp", { count: total })}
            </p>
            <Button variant="secondary" onClick={onClose}>
              {t("common.close")}
            </Button>
          </div>
        ) : (
          <>
            {/* Card face */}
            <div className="flex flex-col gap-3 rounded-xl border border-glass-border bg-glass-bg p-4 sm:p-5 min-h-[10rem]">
              {cloze ? (
                <p className="text-base leading-relaxed text-text-primary">
                  {cloze}
                </p>
              ) : (
                <p className="text-sm italic text-text-muted">
                  {t("vocabulary.review.noContext")}
                </p>
              )}

              {revealed && current && (
                <div className="mt-1 space-y-2 border-t border-glass-border pt-3">
                  <div className="flex items-baseline gap-2">
                    <span className="text-xl font-semibold text-accent">
                      {current.word}
                    </span>
                  </div>
                  <p className="text-sm leading-relaxed text-text-secondary">
                    {current.definition}
                  </p>
                  {(current.sourceTitle || current.sourcePage != null) && (
                    <p className="text-xs text-text-muted">
                      {current.sourceTitle}
                      {current.sourcePage != null
                        ? ` · ${t("vocabulary.page", { page: current.sourcePage })}`
                        : ""}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Actions */}
            {!revealed ? (
              <button
                onClick={() => setRevealed(true)}
                className="flex items-center justify-center gap-2 rounded-lg border border-glass-border bg-glass-bg py-3 text-sm font-medium text-text-primary transition-colors hover:bg-glass-hover cursor-pointer"
              >
                <ChevronDown size={16} />
                {t("vocabulary.review.reveal")}
              </button>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {RATINGS.map(({ key, tone }) => (
                  <button
                    key={key}
                    onClick={() => handleRate(key)}
                    className={cn(
                      "rounded-lg py-3 text-sm font-medium transition-colors cursor-pointer",
                      tone,
                    )}
                  >
                    {t(`vocabulary.rating.${key}`)}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
