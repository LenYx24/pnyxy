import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { createPortal } from "react-dom";
import {
  Copy,
  MessageSquare,
  Trash2,
  Palette,
  BookOpen,
  Languages,
  Loader2,
  Share2,
} from "lucide-react";
import { useAnnotationStore } from "@/stores/annotation-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useVocabStore } from "@/stores/vocab-store";
import { useReaderStore } from "@/stores/reader-store";
import type { HighlightColor } from "@/types/annotation";

const COLORS: { color: HighlightColor; hex: string }[] = [
  { color: "yellow", hex: "#facc15" },
  { color: "green", hex: "#4ade80" },
  { color: "blue", hex: "#60a5fa" },
  { color: "pink", hex: "#f472b6" },
  { color: "orange", hex: "#fb923c" },
];

interface DictionaryEntry {
  word: string;
  phonetic?: string;
  meanings: {
    partOfSpeech: string;
    definitions: { definition: string; example?: string }[];
  }[];
}

async function fetchDefinition(word: string): Promise<DictionaryEntry | null> {
  // Free Dictionary API — no auth, English only, 404 if not found.
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

/**
 * MyMemory's free API requires real two-letter source + target lang
 * codes — `langpair=autodetect|hu` silently returns the input
 * untranslated. Cheap heuristic: pick `hu` when the text contains
 * Hungarian-specific accented characters (ő, ű, é, …); otherwise
 * `en`. This covers the dominant HU-student use case (English
 * textbook ↔ Hungarian) without an extra round-trip detector. Users
 * who pick a target same as the detected source will see "no
 * translation needed" via MyMemory's match score.
 */
function detectSourceLang(text: string): string {
  if (/[őűáéíóúöüÁÉÍÓÚŐŰÖÜ]/.test(text)) return "hu";
  return "en";
}

const TRANSLATE_LANGUAGES = [
  { code: "en", label: "English" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "it", label: "Italian" },
  { code: "pt", label: "Portuguese" },
  { code: "ru", label: "Russian" },
  { code: "zh", label: "Chinese" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "ar", label: "Arabic" },
  { code: "hi", label: "Hindi" },
  { code: "tr", label: "Turkish" },
  { code: "pl", label: "Polish" },
  { code: "nl", label: "Dutch" },
  { code: "sv", label: "Swedish" },
  { code: "hu", label: "Hungarian" },
  { code: "ro", label: "Romanian" },
  { code: "uk", label: "Ukrainian" },
  { code: "cs", label: "Czech" },
];

export function AnnotationContextMenu() {
  const { t } = useTranslation();
  const contextMenu = useAnnotationStore((s) => s.contextMenu);
  const addHighlight = useAnnotationStore((s) => s.addHighlight);
  const addComment = useAnnotationStore((s) => s.addComment);
  const hideContextMenu = useAnnotationStore((s) => s.hideContextMenu);
  const removeHighlight = useAnnotationStore((s) => s.removeHighlight);
  const updateHighlightColor = useAnnotationStore(
    (s) => s.updateHighlightColor,
  );
  const highlights = useAnnotationStore((s) => s.highlights);

  const translateTargetLanguage = useSettingsStore(
    (s) => s.translateTargetLanguage,
  );
  const setTranslateTargetLanguage = useSettingsStore(
    (s) => s.setTranslateTargetLanguage,
  );

  const [showCommentInput, setShowCommentInput] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [showColorChange, setShowColorChange] = useState(false);
  const [showTranslate, setShowTranslate] = useState(false);
  const [translatedText, setTranslatedText] = useState("");
  const [translating, setTranslating] = useState(false);
  const [translateError, setTranslateError] = useState("");
  const [showDefine, setShowDefine] = useState(false);
  const [definition, setDefinition] = useState<DictionaryEntry | null>(null);
  const [defining, setDefining] = useState(false);
  const [defineError, setDefineError] = useState("");
  const [capturedVocabId, setCapturedVocabId] = useState<string | null>(null);
  const captureFromLookup = useVocabStore((s) => s.captureFromLookup);
  const removeVocabEntry = useVocabStore((s) => s.removeEntry);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });

  const highlight = contextMenu.highlightId
    ? highlights.get(contextMenu.highlightId)
    : null;

  const selectedText =
    contextMenu.selection?.text ?? highlight?.selection.text ?? "";

  // Clamp menu position to viewport
  useEffect(() => {
    if (!contextMenu.visible) return;
    // Reset sub-states when menu opens
    setShowCommentInput(false);
    setShowColorChange(false);
    setShowTranslate(false);
    setTranslatedText("");
    setTranslateError("");
    setCommentText("");
    setShowDefine(false);
    setDefinition(null);
    setDefineError("");
    setCapturedVocabId(null);

    // Position after a tick so the ref is populated
    requestAnimationFrame(() => {
      const el = menuRef.current;
      if (!el) {
        setMenuPos({ x: contextMenu.x, y: contextMenu.y + 8 });
        return;
      }
      const rect = el.getBoundingClientRect();
      const x = Math.min(contextMenu.x, window.innerWidth - rect.width - 8);
      const y = Math.min(
        contextMenu.y + 8,
        window.innerHeight - rect.height - 8,
      );
      setMenuPos({ x: Math.max(8, x), y: Math.max(8, y) });
    });
  }, [contextMenu.visible, contextMenu.x, contextMenu.y]);

  // Re-clamp when translate panel opens/closes (menu size changes)
  useEffect(() => {
    if (!contextMenu.visible) return;
    requestAnimationFrame(() => {
      const el = menuRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const x = Math.min(contextMenu.x, window.innerWidth - rect.width - 8);
      const y = Math.min(
        contextMenu.y + 8,
        window.innerHeight - rect.height - 8,
      );
      setMenuPos({ x: Math.max(8, x), y: Math.max(8, y) });
    });
  }, [showTranslate, translatedText, showDefine, definition, contextMenu.visible, contextMenu.x, contextMenu.y]);

  const handleHighlight = useCallback(
    (color: HighlightColor) => {
      if (!contextMenu.selection) return;
      addHighlight(contextMenu.selection, color);
      window.getSelection()?.removeAllRanges();
    },
    [contextMenu.selection, addHighlight],
  );

  const handleCopy = useCallback(() => {
    const text = contextMenu.selection?.text ?? highlight?.selection.text;
    if (text) {
      navigator.clipboard.writeText(text);
    }
    hideContextMenu();
    window.getSelection()?.removeAllRanges();
  }, [contextMenu.selection, highlight, hideContextMenu]);

  const handleShare = useCallback(async () => {
    const text = contextMenu.selection?.text ?? highlight?.selection.text ?? "";
    if (!text.trim()) return;
    const doc = useReaderStore.getState().getActiveDoc();
    const title = doc?.customTitle ?? doc?.meta.title ?? "";
    const page =
      contextMenu.selection?.rects[0]?.pageNum ??
      highlight?.selection.rects[0]?.pageNum;
    const attribution = [title, page != null ? `p. ${page}` : null]
      .filter(Boolean)
      .join(" · ");
    const body = attribution ? `"${text}"\n\n— ${attribution}` : `"${text}"`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: title || "Pnyxy highlight",
          text: body,
        });
        hideContextMenu();
        return;
      } catch {
        // User cancelled or share failed — fall through to clipboard.
      }
    }
    try {
      await navigator.clipboard.writeText(body);
    } catch {
      // Clipboard may be blocked; nothing else we can do here.
    }
    hideContextMenu();
    window.getSelection()?.removeAllRanges();
  }, [contextMenu.selection, highlight, hideContextMenu]);

  const handleAddComment = useCallback(() => {
    setShowCommentInput(true);
    setCommentText("");
  }, []);

  const handleSubmitComment = useCallback(() => {
    const selection = contextMenu.selection ?? highlight?.selection;
    if (!selection || !commentText.trim()) return;
    addComment(selection, commentText.trim(), contextMenu.highlightId ?? undefined);
    setShowCommentInput(false);
    setCommentText("");
    window.getSelection()?.removeAllRanges();
  }, [contextMenu.selection, contextMenu.highlightId, highlight, commentText, addComment]);

  const handleCommentKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmitComment();
      }
      if (e.key === "Escape") {
        setShowCommentInput(false);
      }
    },
    [handleSubmitComment],
  );

  const handleChangeColor = useCallback(
    (color: HighlightColor) => {
      if (!contextMenu.highlightId) return;
      updateHighlightColor(contextMenu.highlightId, color);
      setShowColorChange(false);
      hideContextMenu();
    },
    [contextMenu.highlightId, updateHighlightColor, hideContextMenu],
  );

  const handleRemoveHighlight = useCallback(() => {
    if (!contextMenu.highlightId) return;
    removeHighlight(contextMenu.highlightId);
    hideContextMenu();
  }, [contextMenu.highlightId, removeHighlight, hideContextMenu]);

  const handleDefine = useCallback(async () => {
    const word = selectedText.trim();
    if (!word) return;
    setShowDefine(true);
    setDefinition(null);
    setDefineError("");
    setDefining(true);
    setCapturedVocabId(null);
    try {
      const entry = await fetchDefinition(word);
      if (entry) {
        setDefinition(entry);
        // Silently save to vocabulary for later review. Only capture
        // on a successful single-word lookup — long-phrase "defines"
        // would pollute the flashcard deck.
        if (!word.includes(" ")) {
          const primaryDef = entry.meanings[0]?.definitions[0]?.definition ?? "";
          const activeDoc = useReaderStore.getState().getActiveDoc();
          try {
            const saved = await captureFromLookup({
              word: entry.word,
              definition: primaryDef,
              contextSentence: selectedText.length > word.length ? selectedText : "",
              sourceDocumentId: activeDoc?.meta.id ?? null,
              sourceTitle: activeDoc?.customTitle ?? activeDoc?.meta.title ?? null,
              sourcePage: activeDoc?.currentPage ?? null,
            });
            setCapturedVocabId(saved.id);
          } catch {
            // Capture is best-effort — surface nothing to the user.
          }
        }
      } else setDefineError("not_found");
    } catch {
      setDefineError("connect_failed");
    } finally {
      setDefining(false);
    }
  }, [selectedText, captureFromLookup]);

  const handleUndoCapture = useCallback(async () => {
    if (!capturedVocabId) return;
    const id = capturedVocabId;
    setCapturedVocabId(null);
    try {
      await removeVocabEntry(id);
    } catch {
      // Silent — re-saving will just overwrite.
    }
  }, [capturedVocabId, removeVocabEntry]);

  const handleTranslate = useCallback(async () => {
    if (!selectedText.trim()) return;
    setShowTranslate(true);
    setTranslating(true);
    setTranslatedText("");
    setTranslateError("");

    try {
      const trimmed = selectedText.trim();
      const text = encodeURIComponent(trimmed);
      const source = detectSourceLang(trimmed);
      const langPair = `${source}|${translateTargetLanguage}`;
      const res = await fetch(
        `https://api.mymemory.translated.net/get?q=${text}&langpair=${langPair}`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.responseStatus === 200 && data.responseData?.translatedText) {
        setTranslatedText(data.responseData.translatedText);
      } else {
        setTranslateError(
          data.responseDetails || t("reader.annotationMenu.translateFailed"),
        );
      }
    } catch {
      setTranslateError(t("reader.annotationMenu.translateConnectFailed"));
    } finally {
      setTranslating(false);
    }
  }, [selectedText, translateTargetLanguage, t]);

  const handleLanguageChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      setTranslateTargetLanguage(e.target.value);
      // Re-translate if already showing
      if (showTranslate && selectedText.trim()) {
        setTranslating(true);
        setTranslatedText("");
        setTranslateError("");
        const trimmed = selectedText.trim();
        const text = encodeURIComponent(trimmed);
        const source = detectSourceLang(trimmed);
        const langPair = `${source}|${e.target.value}`;
        fetch(
          `https://api.mymemory.translated.net/get?q=${text}&langpair=${langPair}`,
        )
          .then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json();
          })
          .then((data) => {
            if (data.responseStatus === 200 && data.responseData?.translatedText) {
              setTranslatedText(data.responseData.translatedText);
            } else {
              setTranslateError(
                data.responseDetails ||
                  t("reader.annotationMenu.translateFailed"),
              );
            }
          })
          .catch(() => {
            setTranslateError(
              t("reader.annotationMenu.translateConnectFailed"),
            );
          })
          .finally(() => {
            setTranslating(false);
          });
      }
    },
    [setTranslateTargetLanguage, showTranslate, selectedText, t],
  );

  if (!contextMenu.visible) return null;
  // Need either a selection or a highlight to show menu
  if (!contextMenu.selection && !contextMenu.highlightId) return null;

  const hasSelection = !!contextMenu.selection;
  const hasHighlight = !!highlight;

  return createPortal(
    <div
      ref={menuRef}
      data-annotation-context-menu
      className="fixed z-50 flex flex-col gap-1 rounded-lg border border-glass-border bg-bg-secondary/95 backdrop-blur-md p-2 shadow-xl"
      style={{ left: menuPos.x, top: menuPos.y }}
    >
      {/* Highlight color circles (only for new selections) */}
      {hasSelection && !showCommentInput && !showTranslate && (
        <>
          <div className="flex items-center gap-1.5 px-1">
            {COLORS.map(({ color, hex }) => (
              <button
                key={color}
                className="h-6 w-6 rounded-full border-2 border-transparent hover:border-white/40 transition-colors cursor-pointer hover:scale-110"
                style={{ backgroundColor: hex }}
                title={t("reader.annotationMenu.highlightTitle", { color })}
                onClick={() => handleHighlight(color)}
              />
            ))}
          </div>
          <div className="h-px bg-glass-border my-0.5" />
        </>
      )}

      {/* Change color for existing highlight */}
      {hasHighlight && showColorChange && (
        <>
          <div className="flex items-center gap-1.5 px-1">
            {COLORS.map(({ color, hex }) => (
              <button
                key={color}
                className="h-6 w-6 rounded-full border-2 border-transparent hover:border-white/40 transition-colors cursor-pointer hover:scale-110"
                style={{
                  backgroundColor: hex,
                  borderColor:
                    highlight.color === color
                      ? "rgba(255,255,255,0.6)"
                      : undefined,
                }}
                title={color}
                onClick={() => handleChangeColor(color)}
              />
            ))}
          </div>
          <div className="h-px bg-glass-border my-0.5" />
        </>
      )}

      {/* Action buttons */}
      {!showCommentInput && !showTranslate && !showDefine ? (
        <div className="flex flex-col gap-0.5">
          {selectedText.trim() && (
            <button
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-text-secondary hover:bg-glass-hover hover:text-text-primary transition-colors cursor-pointer"
              onClick={handleDefine}
            >
              <BookOpen size={14} />
              {t("reader.annotationMenu.define", {
                word:
                  selectedText.trim().length > 20
                    ? selectedText.trim().slice(0, 20) + "…"
                    : selectedText.trim(),
              })}
            </button>
          )}

          {selectedText.trim() && (
            <button
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-text-secondary hover:bg-glass-hover hover:text-text-primary transition-colors cursor-pointer"
              onClick={handleTranslate}
            >
              <Languages size={14} />
              {t("reader.annotationMenu.translate")}
            </button>
          )}

          {(selectedText.trim()) && (
            <div className="h-px bg-glass-border my-0.5" />
          )}

          <button
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-text-secondary hover:bg-glass-hover hover:text-text-primary transition-colors cursor-pointer"
            onClick={handleAddComment}
          >
            <MessageSquare size={14} />
            {t("reader.annotationMenu.addComment")}
          </button>

          {(hasSelection || hasHighlight) && (
            <button
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-text-secondary hover:bg-glass-hover hover:text-text-primary transition-colors cursor-pointer"
              onClick={handleCopy}
            >
              <Copy size={14} />
              {t("reader.annotationMenu.copyText")}
            </button>
          )}

          {(hasSelection || hasHighlight) && (
            <button
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-text-secondary hover:bg-glass-hover hover:text-text-primary transition-colors cursor-pointer"
              onClick={handleShare}
            >
              <Share2 size={14} />
              {t("reader.annotationMenu.share")}
            </button>
          )}

          {hasHighlight && (
            <>
              <div className="h-px bg-glass-border my-0.5" />
              <button
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-text-secondary hover:bg-glass-hover hover:text-text-primary transition-colors cursor-pointer"
                onClick={() => setShowColorChange(!showColorChange)}
              >
                <Palette size={14} />
                {t("reader.annotationMenu.changeColor")}
              </button>
              <button
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-red-400/70 hover:bg-red-400/10 hover:text-red-400 transition-colors cursor-pointer"
                onClick={handleRemoveHighlight}
              >
                <Trash2 size={14} />
                {t("reader.annotationMenu.removeHighlight")}
              </button>
            </>
          )}
        </div>
      ) : showDefine ? (
        /* Define panel */
        <div className="flex flex-col gap-2 p-1 w-64">
          <div className="flex items-center gap-1.5">
            <BookOpen size={14} className="text-accent-purple" />
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
            {defineError === "not_found" && (
              <div className="space-y-1.5">
                <span className="text-text-muted">
                  {t("reader.annotationMenu.defineNotFound")}
                </span>
                <a
                  href={`https://en.wiktionary.org/wiki/${encodeURIComponent(selectedText.trim())}`}
                  target="_blank"
                  rel="noreferrer"
                  className="block text-accent-purple hover:underline"
                >
                  {t("reader.annotationMenu.defineTryWiktionary")}
                </a>
              </div>
            )}
            {defineError === "connect_failed" && (
              <span className="text-red-400">
                {t("reader.annotationMenu.defineConnectFailed")}
              </span>
            )}
            {!defining && !defineError && definition && (
              <div className="space-y-2">
                <div className="flex items-baseline gap-2">
                  <span className="font-semibold text-sm text-text-primary">
                    {definition.word}
                  </span>
                  {definition.phonetic && (
                    <span className="text-[11px] text-text-muted">
                      {definition.phonetic}
                    </span>
                  )}
                </div>
                {definition.meanings.map((m, i) => (
                  <div key={i} className="space-y-1">
                    {m.partOfSpeech && (
                      <span className="text-[10px] uppercase tracking-wide text-accent-purple">
                        {m.partOfSpeech}
                      </span>
                    )}
                    <ol className="list-decimal list-inside space-y-0.5 text-text-secondary">
                      {m.definitions.map((d, j) => (
                        <li key={j} className="pl-1">
                          {d.definition}
                          {d.example && (
                            <div className="mt-0.5 pl-3 text-[11px] italic text-text-muted">
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
              <div className="flex items-center gap-2 text-[11px] text-text-muted">
                <span>{t("reader.annotationMenu.savedToVocab")}</span>
                <button
                  className="text-accent-purple hover:underline cursor-pointer"
                  onClick={handleUndoCapture}
                >
                  {t("reader.annotationMenu.undo")}
                </button>
              </div>
            ) : (
              <span />
            )}
            <button
              className="rounded px-2 py-1 text-xs text-text-muted hover:text-text-secondary transition-colors cursor-pointer"
              onClick={() => setShowDefine(false)}
            >
              {t("reader.annotationMenu.back")}
            </button>
          </div>
        </div>
      ) : showTranslate ? (
        /* Translate panel — wider, with the source-detection chip
           visible and the language picker on its own row so the
           translation result has room to breathe. */
        <div className="flex w-72 flex-col gap-2 p-1">
          <div className="flex items-center gap-1.5">
            <Languages size={14} className="text-accent-purple" />
            <span className="text-xs font-medium text-text-primary">
              {t("reader.annotationMenu.translatePanelTitle")}
            </span>
            <span className="ml-auto rounded bg-glass-bg px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-text-muted">
              {detectSourceLang(selectedText.trim())}
              <span className="mx-1">→</span>
              {translateTargetLanguage}
            </span>
          </div>

          {/* Source text */}
          <div className="max-h-20 overflow-y-auto rounded bg-glass-bg/50 px-2 py-1.5 text-xs italic leading-relaxed text-text-muted">
            {selectedText.trim().length > 200
              ? selectedText.trim().slice(0, 200) + "…"
              : selectedText.trim()}
          </div>

          {/* Translation result — give it real vertical room. */}
          <div className="max-h-40 min-h-[3rem] overflow-y-auto rounded bg-glass-bg px-2 py-1.5 text-xs leading-relaxed text-text-primary">
            {translating && (
              <span className="flex items-center gap-1.5 text-text-muted">
                <Loader2 size={12} className="animate-spin" />
                {t("reader.annotationMenu.translating")}
              </span>
            )}
            {translateError && (
              <span className="text-red-400">{translateError}</span>
            )}
            {!translating && !translateError && translatedText && (
              translatedText
            )}
          </div>

          {/* Target language picker */}
          <div className="flex items-center gap-2">
            <label
              htmlFor="translate-lang"
              className="text-[11px] text-text-muted"
            >
              {t("reader.annotationMenu.translateTargetLabel")}
            </label>
            <select
              id="translate-lang"
              value={translateTargetLanguage}
              onChange={handleLanguageChange}
              className="flex-1 cursor-pointer rounded border border-glass-border bg-glass-bg px-2 py-1 text-xs text-text-primary outline-none focus:border-accent-purple"
            >
              {TRANSLATE_LANGUAGES.map(({ code, label }) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-1">
            <button
              className="rounded px-2 py-1 text-xs text-text-muted transition-colors hover:text-text-secondary cursor-pointer"
              onClick={() => setShowTranslate(false)}
            >
              {t("reader.annotationMenu.back")}
            </button>
            {translatedText && (
              <button
                className="rounded bg-accent-purple/20 px-2 py-1 text-xs text-accent-purple transition-colors hover:bg-accent-purple/30 cursor-pointer"
                onClick={() => {
                  navigator.clipboard.writeText(translatedText);
                  hideContextMenu();
                  window.getSelection()?.removeAllRanges();
                }}
              >
                {t("reader.annotationMenu.copy")}
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5 p-1">
          <textarea
            autoFocus
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            onKeyDown={handleCommentKeyDown}
            placeholder={t("reader.annotationMenu.commentPlaceholder")}
            className="w-48 h-16 rounded border border-glass-border bg-glass-bg px-2 py-1.5 text-xs text-text-primary outline-none resize-none focus:border-accent-purple"
          />
          <div className="flex justify-end gap-1">
            <button
              className="rounded px-2 py-1 text-xs text-text-muted hover:text-text-secondary transition-colors cursor-pointer"
              onClick={() => setShowCommentInput(false)}
            >
              {t("common.cancel")}
            </button>
            <button
              className="rounded bg-accent-purple/20 px-2 py-1 text-xs text-accent-purple hover:bg-accent-purple/30 transition-colors cursor-pointer disabled:opacity-40"
              disabled={!commentText.trim()}
              onClick={handleSubmitComment}
            >
              {t("reader.annotationMenu.commentAction")}
            </button>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
