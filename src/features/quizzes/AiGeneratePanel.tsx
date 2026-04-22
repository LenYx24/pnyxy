import { useEffect, useState } from "react";
import { Link } from "react-router";
import { BookOpen, FileText, Loader2, Minus, Plus, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { extractPdfText, hasAnyConfiguredProvider } from "@/lib/ai-client";
import { getIADownloadUrl } from "@/lib/open-library";
import { supabase } from "@/lib/supabase";
import {
  generateQuizQuestions,
  MAX_QUIZ_QUESTIONS,
  MIN_QUIZ_QUESTIONS,
  MAX_SOURCE_CHARS,
  QuizGenerationError,
} from "@/lib/quiz-ai";
import type { QuizQuestionDraft } from "@/types/quiz";

interface AiGeneratePanelProps {
  onAppend: (drafts: QuizQuestionDraft[]) => void;
  /** When set, the panel offers "From book" mode backed by the uploaded PDF. */
  uploadedBookId?: string | null;
  /** When set (and uploadedBookId is not), "From book" mode is backed by
   *  the catalog book's ia_id or download_url, provided it resolves to a PDF. */
  catalogBookId?: string | null;
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
}: AiGeneratePanelProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("text");
  const [sourceText, setSourceText] = useState("");
  const [count, setCount] = useState(DEFAULT_COUNT);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    try {
      const text = await resolveSourceText();
      const drafts = await generateQuizQuestions({ sourceText: text, count });
      onAppend(drafts);
      setSourceText("");
      setOpen(false);
    } catch (err) {
      if (err instanceof QuizGenerationError) {
        setError(err.message);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Generation failed.");
      }
    } finally {
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
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-accent-purple/30 bg-accent-purple/5 px-4 py-3 text-sm font-medium text-accent-purple transition-colors hover:bg-accent-purple/10 cursor-pointer"
      >
        <Sparkles size={16} />
        Generate questions with AI
      </button>
    );
  }

  return (
    <section className="space-y-4 rounded-xl border border-accent-purple/30 bg-accent-purple/5 p-4">
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-accent-purple">
          <Sparkles size={16} />
          Generate with AI
        </div>
        <button
          onClick={() => setOpen(false)}
          disabled={loading}
          className="rounded-md p-1 text-text-muted hover:bg-glass-hover hover:text-text-primary transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="Close AI panel"
        >
          <X size={14} />
        </button>
      </header>

      {!providerConfigured && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
          No AI provider is enabled.{" "}
          <Link
            to="/settings"
            className="font-semibold underline underline-offset-2"
          >
            Configure one in Settings
          </Link>{" "}
          to use generation.
        </p>
      )}

      {bookMeta && (
        <div className="flex rounded-lg border border-glass-border bg-bg-primary/40 p-0.5">
          <ModeTab
            active={mode === "book"}
            icon={BookOpen}
            label="From book"
            onClick={() => setMode("book")}
            disabled={loading}
          />
          <ModeTab
            active={mode === "text"}
            icon={FileText}
            label="Paste text"
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
            Source text
          </label>
          <textarea
            id="ai-source-text"
            rows={6}
            value={sourceText}
            onChange={(e) => setSourceText(e.target.value)}
            maxLength={MAX_SOURCE_CHARS}
            placeholder="Paste a chapter, notes, a Wikipedia section — anything the quiz should be about."
            disabled={loading}
            className="w-full resize-y rounded-lg border border-glass-border bg-bg-primary/50 px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-purple/50 disabled:opacity-60"
          />
          <p className="mt-1 text-[11px] text-text-muted">
            {sourceText.length.toLocaleString()} /{" "}
            {MAX_SOURCE_CHARS.toLocaleString()} chars
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
          <span className="text-xs font-medium text-text-muted">Questions</span>
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
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
          {error}
        </p>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          variant="secondary"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          disabled={loading}
          className="w-full sm:w-auto"
        >
          Cancel
        </Button>
        <Button
          onClick={handleGenerate}
          disabled={!canGenerate}
          className="w-full sm:w-auto"
        >
          {loading ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              {mode === "book" ? "Reading & generating…" : "Generating…"}
            </>
          ) : (
            <>
              <Sparkles size={16} />
              Generate {count}
            </>
          )}
        </Button>
      </div>
    </section>
  );
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
          ? "bg-accent-purple/15 text-accent-purple"
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
          label="From page"
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
          label="To page"
          value={endPage}
          onChange={(n) => onEndChange(clampEnd(n))}
          min={startPage}
          max={total || 9999}
          disabled={disabled}
        />
      </div>
      <p className="text-[11px] text-text-muted">
        Text is extracted from those pages. Keep the range tight — a couple of
        chapters works better than a whole book.
      </p>
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
      <span className="text-[11px] font-medium uppercase tracking-wider text-text-muted">
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
        className="w-20 rounded-lg border border-glass-border bg-bg-primary/50 px-2 py-1.5 text-center text-sm tabular-nums text-text-primary outline-none focus:border-accent-purple/50 disabled:opacity-60"
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
