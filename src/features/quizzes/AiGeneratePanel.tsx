import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { BookOpen, FileText, Loader2, Minus, Plus, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { extractPdfText, hasAnyConfiguredProvider } from "@/lib/ai/ai-client";
import { getIADownloadUrl } from "@/lib/open-library";
import { supabase } from "@/lib/supabase";
import {
  generateQuizQuestions,
  MAX_QUIZ_QUESTIONS,
  MIN_QUIZ_QUESTIONS,
  MAX_SOURCE_CHARS,
  QuizGenerationError,
  type GenerateKind,
} from "@/lib/quiz/quiz-ai";
import type { QuizQuestionDraft } from "@/types/quiz";

interface AiGeneratePanelProps {
  onAppend: (drafts: QuizQuestionDraft[], sourceTitle?: string) => void;
  /** When set, the panel offers "From book" mode backed by the uploaded PDF. */
  uploadedBookId?: string | null;
  /** When set (and uploadedBookId is not), "From book" mode is backed by
   *  the catalog book's ia_id or download_url, provided it resolves to a PDF. */
  catalogBookId?: string | null;
  /** Start the panel expanded, used when the editor is opened from a
   *  "Generate from this book" shortcut on the book Overview page so
   *  the user lands directly on the form instead of having to click
   *  the panel header first. */
  autoOpen?: boolean;
  /** Draft kind to produce. Defaults to "mcq4" (multiple-choice quiz);
   *  "short_answer" routes through the flashcard prompt so the same
   *  page-range UI doubles as a flashcard generator from the book
   *  Overview's "Generate flashcards" shortcut. */
  kind?: GenerateKind;
}

type BookSource =
  | { kind: "uploaded"; storagePath: string }
  | { kind: "catalog-ia"; iaId: string }
  | { kind: "catalog-url"; downloadUrl: string };

interface BookMeta {
  title: string;
  pageCount: number;
  source: BookSource;
}

type Mode = "text" | "book";

const DEFAULT_COUNT = 5;
const DEFAULT_PAGE_SPAN = 10;

export function AiGeneratePanel({
  onAppend,
  uploadedBookId,
  catalogBookId,
  autoOpen = false,
  kind = "mcq4",
}: AiGeneratePanelProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(autoOpen);
  const [mode, setMode] = useState<Mode>("text");
  const [sourceText, setSourceText] = useState("");
  const [count, setCount] = useState(DEFAULT_COUNT);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [bookMeta, setBookMeta] = useState<BookMeta | null>(null);
  const [startPage, setStartPage] = useState(1);
  const [endPage, setEndPage] = useState(DEFAULT_PAGE_SPAN);

  const providerConfigured = hasAnyConfiguredProvider();

  useEffect(() => {
    // Uploaded book wins over catalog book (schema forbids both being set).
    if (!uploadedBookId && !catalogBookId) {
      setBookMeta(null);
      setMode("text");
      return;
    }
    let cancelled = false;
    (async () => {
      const meta = uploadedBookId
        ? await loadUploadedBookMeta(uploadedBookId)
        : await loadCatalogBookMeta(catalogBookId!);
      if (cancelled || !meta) return;
      setBookMeta(meta);
      const maxSpan = Math.min(
        DEFAULT_PAGE_SPAN,
        meta.pageCount || DEFAULT_PAGE_SPAN,
      );
      setEndPage(Math.max(1, maxSpan));
      setMode("book");
    })();
    return () => {
      cancelled = true;
    };
  }, [uploadedBookId, catalogBookId]);

  const resolveSourceText = async (): Promise<string> => {
    if (mode === "text") return sourceText;
    if (!bookMeta) {
      throw new QuizGenerationError(
        "Book isn't loaded yet.",
        "empty_source",
      );
    }
    const from = Math.max(1, Math.min(startPage, endPage));
    const to = Math.max(from, endPage);
    const url = await resolveBookPdfUrl(bookMeta.source);
    let text: string;
    try {
      text = await extractPdfText(url, from, to);
    } catch (err) {
      // Typical causes: CORS on a third-party URL, 404 on IA format
      // fallback, corrupt PDF. Give the user something actionable.
      throw new QuizGenerationError(
        "Couldn't read the book PDF. If it's a catalog book, the host may block cross-origin access — try pasting text instead.",
        "provider_error",
        err,
      );
    }
    if (!text.trim()) {
      throw new QuizGenerationError(
        "No extractable text in that page range. The PDF might be scanned images.",
        "empty_source",
      );
    }
    return text;
  };

  const handleGenerate = async () => {
    setError(null);
    setLoading(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const text = await resolveSourceText();
      const drafts = await generateQuizQuestions({
        sourceText: text,
        count,
        kind,
        signal: controller.signal,
      });
      // Suggest a title so the editor's happy path can save without the
      // user hand-typing one: the book title in book mode, or the first
      // words of the pasted source in text mode.
      const sourceTitle =
        mode === "book" ? bookMeta?.title : deriveTextTitle(text);
      onAppend(drafts, sourceTitle || undefined);
      setSourceText("");
      setOpen(false);
    } catch (err) {
      // Abort is a deliberate user cancel, not an error — stay silent.
      if (err instanceof DOMException && err.name === "AbortError") {
        // no-op
      } else if (err instanceof QuizGenerationError) {
        setError(err.message);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Generation failed.");
      }
    } finally {
      abortRef.current = null;
      setLoading(false);
    }
  };

  const canGenerate =
    !loading &&
    providerConfigured &&
    (mode === "text"
      ? sourceText.trim().length > 0
      : bookMeta !== null && startPage >= 1 && endPage >= startPage);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-accent/30 bg-accent/5 px-4 py-3 text-sm font-medium text-accent transition-colors hover:bg-accent/10 cursor-pointer"
      >
        <Sparkles size={16} />
        {t("quizzes.ai.generate")}
      </button>
    );
  }

  return (
    <section className="space-y-4 rounded-xl border border-accent/30 bg-accent/5 p-4">
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-accent">
          <Sparkles size={16} />
          {t("quizzes.ai.heading")}
        </div>
        <button
          onClick={() => setOpen(false)}
          disabled={loading}
          className="rounded-md p-1 text-text-muted hover:bg-glass-hover hover:text-text-primary transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
          aria-label={t("common.close")}
        >
          <X size={14} />
        </button>
      </header>

      {!providerConfigured && (
        <p className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
          {t("quizzes.ai.noProvider")}{" "}
          <Link
            to="/settings"
            className="font-semibold underline underline-offset-2"
          >
            {t("quizzes.ai.configureLink")}
          </Link>
        </p>
      )}

      {bookMeta && (
        <div className="flex rounded-lg border border-glass-border bg-bg-primary/40 p-0.5">
          <ModeTab
            active={mode === "book"}
            icon={BookOpen}
            label={t("quizzes.ai.fromBook")}
            onClick={() => setMode("book")}
            disabled={loading}
          />
          <ModeTab
            active={mode === "text"}
            icon={FileText}
            label={t("quizzes.ai.pasteText")}
            onClick={() => setMode("text")}
            disabled={loading}
          />
        </div>
      )}

      {mode === "text" ? (
        <div>
          <label
            htmlFor="ai-source-text"
            className="mb-1 block text-xs font-medium text-text-muted"
          >
            {t("quizzes.ai.sourceText")}
          </label>
          <textarea
            id="ai-source-text"
            rows={6}
            value={sourceText}
            onChange={(e) => setSourceText(e.target.value)}
            maxLength={MAX_SOURCE_CHARS}
            placeholder={t("quizzes.ai.sourcePlaceholder")}
            disabled={loading}
            className="w-full resize-y rounded-lg border border-glass-border bg-bg-primary/50 px-3 py-2 text-sm text-text-primary outline-none focus:border-accent/50 disabled:opacity-60"
          />
          <p className="mt-1 text-2xs text-text-muted">
            {t("quizzes.ai.charsCounter", {
              used: sourceText.length.toLocaleString(),
              max: MAX_SOURCE_CHARS.toLocaleString(),
            })}
          </p>
        </div>
      ) : (
        <BookRange
          bookMeta={bookMeta}
          startPage={startPage}
          endPage={endPage}
          onStartChange={setStartPage}
          onEndChange={setEndPage}
          disabled={loading}
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-text-muted">
            {t("quizzes.ai.questionsLabel")}
          </span>
          <CountStepper
            value={count}
            onChange={setCount}
            min={MIN_QUIZ_QUESTIONS}
            max={MAX_QUIZ_QUESTIONS}
            disabled={loading}
          />
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
          {error}
        </p>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          variant="secondary"
          onClick={() => {
            // While a generation is in flight this doubles as an abort
            // control so a stalled stream can't trap the user.
            if (loading) {
              abortRef.current?.abort();
              return;
            }
            setOpen(false);
            setError(null);
          }}
          className="w-full sm:w-auto"
        >
          {loading
            ? t("quizzes.ai.cancelGeneration", { defaultValue: "Cancel" })
            : t("common.cancel")}
        </Button>
        <Button
          onClick={handleGenerate}
          disabled={!canGenerate}
          className="w-full sm:w-auto"
        >
          {loading ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              {mode === "book"
                ? t("quizzes.ai.generatingFromBook")
                : t("quizzes.ai.generating")}
            </>
          ) : (
            <>
              <Sparkles size={16} />
              {t("quizzes.ai.generateN", { count })}
            </>
          )}
        </Button>
      </div>
    </section>
  );
}

/** Best-effort title from pasted source text: first non-empty line,
 *  collapsed and clipped so it fits the editor's 140-char title field. */
function deriveTextTitle(text: string): string {
  const firstLine = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!firstLine) return "";
  const clipped = firstLine.replace(/\s+/g, " ").slice(0, 80);
  return clipped.length < firstLine.length ? `${clipped}…` : clipped;
}

async function loadUploadedBookMeta(
  uploadedBookId: string,
): Promise<BookMeta | null> {
  const [bookRes, fileRes] = await Promise.all([
    supabase
      .from("books")
      .select("title, format, page_count")
      .eq("id", uploadedBookId)
      .maybeSingle(),
    supabase
      .from("book_files")
      .select("storage_path")
      .eq("book_id", uploadedBookId)
      .eq("is_primary", true)
      .maybeSingle(),
  ]);
  if (!bookRes.data || !fileRes.data || bookRes.data.format !== "pdf") {
    return null;
  }
  return {
    title: bookRes.data.title,
    pageCount: bookRes.data.page_count ?? 0,
    source: { kind: "uploaded", storagePath: fileRes.data.storage_path },
  };
}

async function loadCatalogBookMeta(
  catalogBookId: string,
): Promise<BookMeta | null> {
  const { data } = await supabase
    .from("catalog_books")
    .select("title, page_count, ia_id, download_url")
    .eq("id", catalogBookId)
    .maybeSingle();
  if (!data) return null;

  let source: BookSource | null = null;
  if (data.ia_id) {
    source = { kind: "catalog-ia", iaId: data.ia_id };
  } else if (data.download_url) {
    const ext = data.download_url.split("?")[0].split(".").pop()?.toLowerCase();
    if (ext === "pdf") {
      source = { kind: "catalog-url", downloadUrl: data.download_url };
    }
  }
  if (!source) return null;

  return {
    title: data.title,
    pageCount: data.page_count ?? 0,
    source,
  };
}

async function resolveBookPdfUrl(source: BookSource): Promise<string> {
  if (source.kind === "uploaded") {
    const { data, error } = await supabase.storage
      .from("book-files")
      .createSignedUrl(source.storagePath, 600);
    if (error || !data?.signedUrl) {
      throw new Error("Could not sign upload URL.");
    }
    return data.signedUrl;
  }
  if (source.kind === "catalog-ia") {
    return getIADownloadUrl(source.iaId, "pdf");
  }
  return source.downloadUrl;
}

function ModeTab({
  active,
  icon: Icon,
  label,
  onClick,
  disabled,
}: {
  active: boolean;
  icon: typeof BookOpen;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50",
        active
          ? "bg-accent/15 text-accent"
          : "text-text-muted hover:text-text-primary",
      )}
    >
      <Icon size={13} />
      {label}
    </button>
  );
}

function BookRange({
  bookMeta,
  startPage,
  endPage,
  onStartChange,
  onEndChange,
  disabled,
}: {
  bookMeta: BookMeta | null;
  startPage: number;
  endPage: number;
  onStartChange: (n: number) => void;
  onEndChange: (n: number) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const total = bookMeta?.pageCount ?? 0;
  const clampStart = (n: number) =>
    Math.max(1, Math.min(total || 1, Math.round(n)));
  const clampEnd = (n: number) =>
    Math.max(startPage, Math.min(total || 1, Math.round(n)));

  return (
    <div className="space-y-2">
      {bookMeta && (
        <p className="truncate text-xs text-text-muted">
          <span className="text-text-secondary">{bookMeta.title}</span>
          {total > 0 && ` — ${total} pages`}
        </p>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <PageInput
          label={t("quizzes.ai.fromPage")}
          value={startPage}
          onChange={(n) => {
            const v = clampStart(n);
            onStartChange(v);
            if (endPage < v) onEndChange(v);
          }}
          min={1}
          max={total || 9999}
          disabled={disabled}
        />
        <PageInput
          label={t("quizzes.ai.toPage")}
          value={endPage}
          onChange={(n) => onEndChange(clampEnd(n))}
          min={startPage}
          max={total || 9999}
          disabled={disabled}
        />
      </div>
      <p className="text-2xs text-text-muted">{t("quizzes.ai.bookHint")}</p>
    </div>
  );
}

function PageInput({
  label,
  value,
  onChange,
  min,
  max,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  disabled?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-2xs font-medium uppercase tracking-wider text-text-muted">
        {label}
      </span>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
        disabled={disabled}
        className="w-20 rounded-lg border border-glass-border bg-bg-primary/50 px-2 py-1.5 text-center text-sm tabular-nums text-text-primary outline-none focus:border-accent/50 disabled:opacity-60"
      />
    </label>
  );
}

function CountStepper({
  value,
  onChange,
  min,
  max,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  disabled?: boolean;
}) {
  const clamp = (n: number) => Math.max(min, Math.min(max, n));
  return (
    <div className="inline-flex items-center overflow-hidden rounded-lg border border-glass-border bg-bg-primary/50">
      <button
        onClick={() => onChange(clamp(value - 1))}
        disabled={disabled || value <= min}
        className="px-3 py-1.5 text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
        aria-label="Decrease question count"
      >
        <Minus size={14} />
      </button>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(clamp(Math.round(n)));
        }}
        disabled={disabled}
        className="w-10 border-x border-glass-border bg-transparent py-1 text-center text-sm tabular-nums text-text-primary outline-none disabled:opacity-60 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <button
        onClick={() => onChange(clamp(value + 1))}
        disabled={disabled || value >= max}
        className="px-3 py-1.5 text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
        aria-label="Increase question count"
      >
        <Plus size={14} />
      </button>
    </div>
  );
}
