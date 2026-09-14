import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen, Loader2 } from "lucide-react";
import { useReaderStore } from "@/stores/reader-store";
import { useVocabStore } from "@/stores/vocab-store";
import { cn } from "@/lib/cn";

interface DictionaryEntry {
  word: string;
  phonetic?: string;
  meanings: {
    partOfSpeech: string;
    definitions: { definition: string; example?: string }[];
  }[];
}

/** The Wiktionary definition API returns HTML fragments (wikilinks,
 *  <i> emphasis). Strip tags and decode the few entities that show up so
 *  the panel renders plain, readable text. */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface WiktionaryDefinition {
  definition?: string;
  examples?: string[];
  parsedExamples?: { example?: string }[];
}
interface WiktionarySection {
  partOfSpeech?: string;
  language?: string;
  definitions?: WiktionaryDefinition[];
}

/**
 * Wiktionary REST client (Wikimedia infra: reliable, keyless, generous
 * CORS). English-only lookup; returns null on 404 / no English section,
 * throws on 5xx / timeout so the caller's "connect_failed" branch lights
 * up. Replaces the old api.dictionaryapi.dev, a hobby API that went dark
 * and, with no timeout, left the panel spinning forever.
 */
async function fetchDefinition(
  word: string,
  signal?: AbortSignal,
): Promise<DictionaryEntry | null> {
  const res = await fetch(
    `https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(
      word.toLowerCase(),
    )}`,
    { headers: { accept: "application/json" }, signal },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as Record<string, WiktionarySection[]>;
  // Prefer the English section; fall back to whatever the word has.
  const sections = data.en ?? Object.values(data)[0] ?? [];
  const meanings = sections
    .map((s) => ({
      partOfSpeech: s.partOfSpeech ?? "",
      definitions: (s.definitions ?? [])
        .map((d) => ({
          definition: stripHtml(d.definition ?? ""),
          example: d.parsedExamples?.[0]?.example
            ? stripHtml(d.parsedExamples[0].example)
            : d.examples?.[0]
              ? stripHtml(d.examples[0])
              : undefined,
        }))
        .filter((d) => d.definition.length > 0)
        .slice(0, 3), // cap per part-of-speech
    }))
    .filter((m) => m.definitions.length > 0);
  if (meanings.length === 0) return null;
  return { word, meanings };
}

interface Props {
  selectedText: string;
  /** Return to the annotation menu's action list. Omitted when the
   *  panel is embedded in the persistent reader-tools side panel,
   *  where there's no "back" to go to. */
  onBack?: () => void;
  /** Stretch to the container width instead of the popover's fixed
   *  `w-64`. Set when hosted in the wide reader-tools side panel. */
  fullWidth?: boolean;
}

/**
 * "Define this word" panel, Free Dictionary lookup with silent
 * capture into the user's vocabulary deck on a single-word success.
 * Multi-word selections are shown but not auto-saved (would pollute
 * the flashcard deck). Capture is best-effort; failures are silent.
 */
export function AnnotationMenuDefinePanel({
  selectedText,
  onBack,
  fullWidth = false,
}: Props) {
  const { t } = useTranslation();
  const [definition, setDefinition] = useState<DictionaryEntry | null>(null);
  const [defining, setDefining] = useState(false);
  const [error, setError] = useState("");
  const [capturedVocabId, setCapturedVocabId] = useState<string | null>(null);
  const captureFromLookup = useVocabStore((s) => s.captureFromLookup);
  const removeVocabEntry = useVocabStore((s) => s.removeEntry);

  useEffect(() => {
    const word = selectedText.trim();
    if (!word) return;
    let cancelled = false;
    // Hard timeout so a slow/unreachable dictionary host can't leave the
    // panel spinning forever (the old provider used to hang indefinitely).
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 8000);
    setDefining(true);
    setDefinition(null);
    setError("");
    setCapturedVocabId(null);
    void (async () => {
      try {
        const entry = await fetchDefinition(word, controller.signal);
        if (cancelled) return;
        if (entry) {
          setDefinition(entry);
        } else {
          setError("not_found");
        }
      } catch {
        if (!cancelled) setError("connect_failed");
      } finally {
        window.clearTimeout(timer);
        if (!cancelled) setDefining(false);
      }
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [selectedText]);

  // Explicit save to the vocabulary deck. Previously this fired silently on any
  // single-word lookup; now the user opts in so words aren't captured behind
  // their back (and multi-word selections can be saved too if they choose).
  const [capturing, setCapturing] = useState(false);
  const handleAddToVocab = useCallback(async () => {
    if (capturing) return;
    // Works with OR without a dictionary hit: fall back to the raw
    // selection so the user can always save a word and define it later.
    const word = (definition?.word ?? selectedText).trim();
    if (!word) return;
    setCapturing(true);
    const primaryDef =
      definition?.meanings[0]?.definitions[0]?.definition ?? "";
    const activeDoc = useReaderStore.getState().getActiveDoc();
    try {
      const saved = await captureFromLookup({
        word,
        definition: primaryDef,
        contextSentence:
          selectedText.trim().length > word.length ? selectedText : "",
        sourceDocumentId: activeDoc?.meta.id ?? null,
        sourceTitle: activeDoc?.customTitle ?? activeDoc?.meta.title ?? null,
        sourcePage: activeDoc?.currentPage ?? null,
      });
      setCapturedVocabId(saved.id);
    } catch {
      // Best-effort; surface nothing.
    } finally {
      setCapturing(false);
    }
  }, [definition, capturing, selectedText, captureFromLookup]);

  const handleUndoCapture = useCallback(async () => {
    if (!capturedVocabId) return;
    const id = capturedVocabId;
    setCapturedVocabId(null);
    try {
      await removeVocabEntry(id);
    } catch {
      // Silent, re-saving will just overwrite.
    }
  }, [capturedVocabId, removeVocabEntry]);

  return (
    <div
      className={cn("flex flex-col gap-2 p-1", fullWidth ? "w-full" : "w-64")}
    >
      <div className="flex items-center gap-1.5">
        <BookOpen size={14} className="text-accent" />
        <span className="text-xs font-medium text-text-primary">
          {t("reader.annotationMenu.definePanelTitle")}
        </span>
      </div>

      <div className="rounded bg-glass-bg/50 px-2 py-1.5 text-xs italic text-text-muted">
        {selectedText.trim().length > 60
          ? selectedText.trim().slice(0, 60) + "…"
          : selectedText.trim()}
      </div>

      <div className="rounded bg-glass-bg px-2 py-2 text-xs text-text-primary leading-relaxed min-h-[3rem] max-h-48 overflow-y-auto">
        {defining && (
          <span className="flex items-center gap-1.5 text-text-muted">
            <Loader2 size={12} className="animate-spin" />
            {t("reader.annotationMenu.defining")}
          </span>
        )}
        {error === "not_found" && (
          <div className="space-y-1.5">
            <span className="text-text-muted">
              {t("reader.annotationMenu.defineNotFound")}
            </span>
            <a
              href={`https://en.wiktionary.org/wiki/${encodeURIComponent(selectedText.trim())}`}
              target="_blank"
              rel="noreferrer"
              className="block text-accent hover:underline"
            >
              {t("reader.annotationMenu.defineTryWiktionary")}
            </a>
          </div>
        )}
        {error === "connect_failed" && (
          <span className="text-danger">
            {t("reader.annotationMenu.defineConnectFailed")}
          </span>
        )}
        {!defining && !error && definition && (
          <div className="space-y-2">
            <div className="flex items-baseline gap-2">
              <span className="font-semibold text-sm text-text-primary">
                {definition.word}
              </span>
              {definition.phonetic && (
                <span className="text-2xs text-text-muted">
                  {definition.phonetic}
                </span>
              )}
            </div>
            {definition.meanings.map((m, i) => (
              <div key={i} className="space-y-1">
                {m.partOfSpeech && (
                  <span className="text-2xs uppercase tracking-wide text-accent">
                    {m.partOfSpeech}
                  </span>
                )}
                <ol className="list-decimal list-inside space-y-0.5 text-text-secondary">
                  {m.definitions.map((d, j) => (
                    <li key={j} className="pl-1">
                      {d.definition}
                      {d.example && (
                        <div className="mt-0.5 pl-3 text-2xs italic text-text-muted">
                          "{d.example}"
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        {capturedVocabId ? (
          <div className="flex items-center gap-2 text-2xs text-text-muted">
            <span>{t("reader.annotationMenu.savedToVocab")}</span>
            <button
              className="text-accent hover:underline cursor-pointer"
              onClick={handleUndoCapture}
            >
              {t("reader.annotationMenu.undo")}
            </button>
          </div>
        ) : !defining && selectedText.trim() ? (
          <button
            className="flex items-center gap-1.5 rounded bg-accent/15 px-2 py-1 text-2xs font-medium text-accent transition-colors hover:bg-accent/25 disabled:opacity-40 cursor-pointer"
            onClick={handleAddToVocab}
            disabled={capturing}
          >
            <BookOpen size={12} />
            {t("reader.annotationMenu.addToVocab")}
          </button>
        ) : (
          <span />
        )}
        {onBack && (
          <button
            className="rounded px-2 py-1 text-xs text-text-muted hover:text-text-secondary transition-colors cursor-pointer"
            onClick={onBack}
          >
            {t("reader.annotationMenu.back")}
          </button>
        )}
      </div>
    </div>
  );
}
