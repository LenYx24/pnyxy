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

/**
 * Free Dictionary API client, no auth, English-only, 404 when the
 * lookup misses. Returns null on 404; throws on 5xx so the caller's
 * "connect_failed" branch can light up. Kept module-local because
 * nothing else in the app talks to the dictionary API today.
 */
async function fetchDefinition(word: string): Promise<DictionaryEntry | null> {
  const res = await fetch(
    `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as Array<{
    word: string;
    phonetic?: string;
    phonetics?: { text?: string }[];
    meanings?: {
      partOfSpeech?: string;
      definitions?: { definition: string; example?: string }[];
    }[];
  }>;
  const first = data[0];
  if (!first) return null;
  const phonetic =
    first.phonetic ?? first.phonetics?.find((p) => p.text)?.text ?? undefined;
  const meanings = (first.meanings ?? [])
    .map((m) => ({
      partOfSpeech: m.partOfSpeech ?? "",
      definitions: (m.definitions ?? []).slice(0, 3), // cap per part-of-speech
    }))
    .filter((m) => m.definitions.length > 0);
  return { word: first.word, phonetic, meanings };
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
    setDefining(true);
    setDefinition(null);
    setError("");
    setCapturedVocabId(null);
    void (async () => {
      try {
        const entry = await fetchDefinition(word);
        if (cancelled) return;
        if (entry) {
          setDefinition(entry);
          // Silently save to vocabulary for later review. Only capture
          // on a successful single-word lookup, long-phrase "defines"
          // would pollute the flashcard deck.
          if (!word.includes(" ")) {
            const primaryDef =
              entry.meanings[0]?.definitions[0]?.definition ?? "";
            const activeDoc = useReaderStore.getState().getActiveDoc();
            try {
              const saved = await captureFromLookup({
                word: entry.word,
                definition: primaryDef,
                contextSentence:
                  selectedText.length > word.length ? selectedText : "",
                sourceDocumentId: activeDoc?.meta.id ?? null,
                sourceTitle:
                  activeDoc?.customTitle ?? activeDoc?.meta.title ?? null,
                sourcePage: activeDoc?.currentPage ?? null,
              });
              if (!cancelled) setCapturedVocabId(saved.id);
            } catch {
              // Capture is best-effort, surface nothing to the user.
            }
          }
        } else {
          setError("not_found");
        }
      } catch {
        if (!cancelled) setError("connect_failed");
      } finally {
        if (!cancelled) setDefining(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedText, captureFromLookup]);

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
    <div className={cn("flex flex-col gap-2 p-1", fullWidth ? "w-full" : "w-64")}>
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
