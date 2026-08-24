import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  BookMarked,
  Download,
  Play,
  Shuffle,
  Trash2,
  Search,
} from "lucide-react";
import { Button, GlassCard } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useVocabStore } from "@/stores/vocab-store";
import { useAuthStore } from "@/stores/auth-store";
import type { VocabEntry } from "@/types/vocab";
import { FlashcardReview } from "./FlashcardReview";
import { exportVocabAsCsv } from "./exportVocab";

type Filter = "all" | "due" | "learning";

export function VocabularyPage() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const entries = useVocabStore((s) => s.entries);
  const isLoading = useVocabStore((s) => s.isLoading);
  const loadEntries = useVocabStore((s) => s.loadEntries);
  const removeEntry = useVocabStore((s) => s.removeEntry);

  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<string | "all">("all");
  // `reviewing` doubles as the modal-open flag; `cramMode` only
  // matters when the modal is open and decides whether the rating
  // buttons feed FSRS or are read-only.
  const [reviewing, setReviewing] = useState(false);
  const [cramMode, setCramMode] = useState(false);

  useEffect(() => {
    loadEntries();
  }, [loadEntries, user?.id]);

  const all = useMemo(() => [...entries.values()], [entries]);

  const bookOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of all) {
      if (e.sourceDocumentId && e.sourceTitle) {
        map.set(e.sourceDocumentId, e.sourceTitle);
      }
    }
    return [...map.entries()];
  }, [all]);

  const visible = useMemo(() => {
    const now = Date.now();
    const q = query.trim().toLowerCase();
    return all
      .filter((e) => (filter === "due" ? e.dueAt <= now : true))
      .filter((e) =>
        filter === "learning"
          ? e.fsrsCard.reps > 0 && e.fsrsCard.state !== 2
          : true,
      )
      .filter((e) =>
        sourceFilter === "all" ? true : e.sourceDocumentId === sourceFilter,
      )
      .filter(
        (e) =>
          !q ||
          e.word.includes(q) ||
          e.definition.toLowerCase().includes(q),
      )
      .sort((a, b) => a.dueAt - b.dueAt);
  }, [all, filter, sourceFilter, query]);

  const dueCount = useMemo(() => {
    const now = Date.now();
    return all.filter(
      (e) =>
        e.dueAt <= now &&
        (sourceFilter === "all" || e.sourceDocumentId === sourceFilter),
    ).length;
  }, [all, sourceFilter]);

  const reviewQueue = useMemo(() => {
    const now = Date.now();
    return all
      .filter(
        (e) =>
          e.dueAt <= now &&
          (sourceFilter === "all" || e.sourceDocumentId === sourceFilter),
      )
      .sort((a, b) => a.dueAt - b.dueAt);
  }, [all, sourceFilter]);

  // Cram queue, every visible card regardless of dueAt, shuffled
  // so a back-to-back cram session doesn't always start with the
  // oldest entry. Used by the "Review all" button below; the
  // shuffle freshens on every modal open so two passes in a row
  // don't see the cards in the same order.
  const cramQueue = useMemo(() => {
    const out = [...visible];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
    // `reviewing` is the trigger: we recompute the shuffled queue
    // each time the modal opens, then keep it stable while open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewing && cramMode, visible.length]);

  const handleExport = () => {
    exportVocabAsCsv(visible);
  };

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/15 text-accent">
            <BookMarked size={20} />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-text-primary">
              {t("vocabulary.title")}
            </h1>
            <p className="text-xs sm:text-sm text-text-muted">
              {t("vocabulary.tagline")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            onClick={handleExport}
            disabled={visible.length === 0}
            className="hidden sm:inline-flex"
          >
            <Download size={16} />
            {t("vocabulary.export")}
          </Button>
          {/* "Cram": review any visible card regardless of dueAt.
              FSRS schedule isn't touched (see FlashcardReview's
              `cram` prop). Disabled when there are zero cards to
              show; otherwise always available even if nothing is
              due. The icon (Shuffle) signals "free-form pass". */}
          <Button
            variant="secondary"
            onClick={() => {
              setCramMode(true);
              setReviewing(true);
            }}
            disabled={visible.length === 0}
            title={t("vocabulary.cramHint", {
              defaultValue:
                "Practice any card without changing the spaced-repetition schedule",
            })}
          >
            <Shuffle size={16} />
            {t("vocabulary.cram", { defaultValue: "Cram" })}
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              setCramMode(false);
              setReviewing(true);
            }}
            disabled={reviewQueue.length === 0}
          >
            <Play size={16} />
            {t("vocabulary.reviewDue", { count: dueCount })}
          </Button>
        </div>
      </header>

      {/* Stats strip */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <GlassCard className="p-3 sm:p-4">
          <p className="text-2xs sm:text-xs uppercase tracking-wide text-text-muted">
            {t("vocabulary.stats.total")}
          </p>
          <p className="text-xl sm:text-2xl font-bold text-text-primary">
            {all.length}
          </p>
        </GlassCard>
        <GlassCard className="p-3 sm:p-4">
          <p className="text-2xs sm:text-xs uppercase tracking-wide text-text-muted">
            {t("vocabulary.stats.dueNow")}
          </p>
          <p className="text-xl sm:text-2xl font-bold text-accent">
            {dueCount}
          </p>
        </GlassCard>
        <GlassCard className="p-3 sm:p-4">
          <p className="text-2xs sm:text-xs uppercase tracking-wide text-text-muted">
            {t("vocabulary.stats.learning")}
          </p>
          <p className="text-xl sm:text-2xl font-bold text-text-primary">
            {all.filter((e) => e.fsrsCard.reps > 0 && e.fsrsCard.state !== 2).length}
          </p>
        </GlassCard>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[10rem]">
          <Search
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("vocabulary.search")}
            className="w-full rounded-lg border border-glass-border bg-glass-bg px-3 py-2 pl-9 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent/50"
          />
        </div>
        <div className="flex rounded-lg border border-glass-border bg-glass-bg p-0.5 text-xs">
          {(["all", "due", "learning"] as Filter[]).map((key) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={cn(
                "rounded-md px-2.5 py-1.5 transition-colors cursor-pointer",
                filter === key
                  ? "bg-accent/20 text-accent"
                  : "text-text-muted hover:text-text-primary",
              )}
            >
              {t(`vocabulary.filter.${key}`)}
            </button>
          ))}
        </div>
        {bookOptions.length > 0 && (
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="rounded-lg border border-glass-border bg-glass-bg px-2 py-2 text-xs text-text-primary outline-none focus:border-accent/50 cursor-pointer"
          >
            <option value="all">{t("vocabulary.allBooks")}</option>
            {bookOptions.map(([id, title]) => (
              <option key={id} value={id}>
                {title}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* List */}
      {isLoading ? (
        <p className="py-10 text-center text-sm text-text-muted">
          {t("common.loading")}
        </p>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-glass-border py-12 text-center">
          <BookMarked size={28} className="text-text-muted" />
          <p className="text-sm text-text-primary">
            {all.length === 0
              ? t("vocabulary.empty.title")
              : t("vocabulary.empty.filtered")}
          </p>
          <p className="max-w-sm text-xs text-text-muted">
            {all.length === 0 ? t("vocabulary.empty.hint") : null}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-glass-border rounded-xl border border-glass-border bg-glass-bg">
          {visible.map((entry) => (
            <VocabRow key={entry.id} entry={entry} onRemove={removeEntry} />
          ))}
        </ul>
      )}

      {reviewing && (
        <FlashcardReview
          queue={cramMode ? cramQueue : reviewQueue}
          cram={cramMode}
          onClose={() => {
            setReviewing(false);
            setCramMode(false);
          }}
        />
      )}
    </div>
  );
}

function VocabRow({
  entry,
  onRemove,
}: {
  entry: VocabEntry;
  onRemove: (id: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const now = Date.now();
  const isDue = entry.dueAt <= now;
  const dueLabel = isDue
    ? t("vocabulary.dueNow")
    : t("vocabulary.dueIn", { days: Math.ceil((entry.dueAt - now) / 86400000) });

  return (
    <li className="flex items-start justify-between gap-3 p-3 sm:p-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-semibold text-text-primary">{entry.word}</span>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-2xs",
              isDue
                ? "bg-accent/20 text-accent"
                : "bg-glass-bg text-text-muted",
            )}
          >
            {dueLabel}
          </span>
        </div>
        <p className="mt-0.5 line-clamp-2 text-xs text-text-secondary">
          {entry.definition}
        </p>
        {entry.sourceTitle && (
          <p className="mt-1 truncate text-2xs text-text-muted">
            {entry.sourceTitle}
            {entry.sourcePage != null
              ? ` · ${t("vocabulary.page", { page: entry.sourcePage })}`
              : ""}
          </p>
        )}
      </div>
      <button
        onClick={() => onRemove(entry.id)}
        aria-label={t("common.delete")}
        className="shrink-0 rounded-md p-1.5 text-text-muted transition-colors hover:bg-danger/10 hover:text-danger cursor-pointer"
      >
        <Trash2 size={16} />
      </button>
    </li>
  );
}
