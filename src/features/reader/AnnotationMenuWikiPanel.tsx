import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, Globe, Loader2 } from "lucide-react";
import {
  fetchWikipediaSummary,
  type WikipediaSummary,
} from "@/lib/wikipedia";
import { isAbortError } from "@/lib/ai-client";
import { detectSourceLang } from "@/lib/lang-detect";

interface Props {
  /** Initial term to look up — pre-filled from the user's text
   *  selection. The input is editable so the user can fix PDF mis-
   *  extractions ("colourised" → "colorized") without re-selecting. */
  initialQuery: string;
  /** Dismiss the panel and return to the main action list. The parent
   *  owns the menu's overall visibility; this only closes the panel. */
  onBack: () => void;
}

/**
 * Wikipedia summary panel for the annotation context menu. Owns its
 * own query / language / fetch state — extracted from the menu
 * shell so the menu can render Wikipedia results without holding
 * the AbortController and intermediate states in its top-level
 * useState bag. On mount the panel auto-runs the first lookup with
 * a language detected from the source text.
 */
export function AnnotationMenuWikiPanel({ initialQuery, onBack }: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState(initialQuery);
  const [lang, setLang] = useState<string>("");
  const [summary, setSummary] = useState<WikipediaSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const runLookup = useCallback(async (text: string, languageCode: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setQuery(trimmed);
    setLang(languageCode);
    setLoading(true);
    setSummary(null);
    setError("");
    try {
      const result = await fetchWikipediaSummary(trimmed, languageCode, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (!result) setError("not_found");
      else setSummary(result);
    } catch (err) {
      if (controller.signal.aborted) return;
      if (isAbortError(err)) return;
      setError("connect_failed");
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setLoading(false);
      }
    }
  }, []);

  // Auto-run the first lookup on mount. The picked language mirrors
  // the menu's translate detection so the user usually lands on the
  // right Wikipedia without thinking; the toggles let them flip.
  useEffect(() => {
    const initial = initialQuery.trim();
    if (!initial) return;
    void runLookup(initial, detectSourceLang(initial));
    return () => {
      abortRef.current?.abort();
    };
    // initialQuery only changes when the parent re-mounts the panel
    // for a fresh selection (which we want to trigger a re-lookup).
  }, [initialQuery, runLookup]);

  return (
    <div className="flex w-72 flex-col gap-2 p-1">
      <div className="flex items-center gap-1.5">
        <Globe size={14} className="text-accent-purple" />
        <span className="text-xs font-medium text-text-primary">
          {t("reader.annotationMenu.wikiPanelTitle")}
        </span>
        <div className="ml-auto flex gap-1">
          {["hu", "en"].map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => runLookup(query, code)}
              disabled={loading || lang === code || !query.trim()}
              className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide transition-colors cursor-pointer ${
                lang === code
                  ? "bg-accent-purple/20 text-accent-purple"
                  : "bg-glass-bg text-text-muted hover:text-text-secondary"
              } disabled:opacity-60`}
            >
              {code}
            </button>
          ))}
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!query.trim()) return;
          runLookup(query, lang || detectSourceLang(query));
        }}
        className="flex items-stretch gap-1"
      >
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("reader.annotationMenu.wikiQueryPlaceholder")}
          aria-label={t("reader.annotationMenu.wikiQueryLabel")}
          className="flex-1 rounded border border-glass-border bg-glass-bg px-2 py-1 text-xs text-text-primary outline-none focus:border-accent-purple"
        />
        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="rounded bg-accent-purple/20 px-2 py-1 text-xs text-accent-purple transition-colors hover:bg-accent-purple/30 cursor-pointer disabled:opacity-50"
        >
          {t("reader.annotationMenu.wikiSearch")}
        </button>
      </form>

      <div className="min-h-[3rem] max-h-64 overflow-y-auto rounded bg-glass-bg px-2 py-2 text-xs leading-relaxed text-text-primary">
        {loading && (
          <span className="flex items-center gap-1.5 text-text-muted">
            <Loader2 size={12} className="animate-spin" />
            {t("reader.annotationMenu.wikiLoading")}
          </span>
        )}
        {error === "not_found" && !loading && (
          <span className="text-text-muted">
            {t("reader.annotationMenu.wikiNotFound")}
          </span>
        )}
        {error === "connect_failed" && !loading && (
          <span className="text-red-400">
            {t("reader.annotationMenu.wikiConnectFailed")}
          </span>
        )}
        {!loading && summary && (
          <div className="space-y-2">
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-semibold text-text-primary">
                {summary.title}
              </span>
              {summary.type === "disambiguation" && (
                <span className="rounded bg-amber-500/15 px-1 text-[10px] uppercase tracking-wide text-amber-300">
                  {t("reader.annotationMenu.wikiDisambiguation")}
                </span>
              )}
            </div>
            {summary.thumbnailUrl && (
              <img
                src={summary.thumbnailUrl}
                alt=""
                className="max-h-32 w-auto rounded"
                loading="lazy"
              />
            )}
            <p className="text-text-secondary">{summary.extract}</p>
            <a
              href={summary.pageUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-accent-purple hover:underline"
            >
              {t("reader.annotationMenu.wikiOpen")}
              <ExternalLink size={11} />
            </a>
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <button
          className="rounded px-2 py-1 text-xs text-text-muted hover:text-text-secondary transition-colors cursor-pointer"
          onClick={onBack}
        >
          {t("reader.annotationMenu.back")}
        </button>
      </div>
    </div>
  );
}
