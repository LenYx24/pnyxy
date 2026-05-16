import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Sparkles } from "lucide-react";
import { isAbortError, streamChatResponse } from "@/lib/ai-client";
import { detectSourceLang } from "@/lib/lang-detect";
import { useAnnotationStore } from "@/stores/annotation-store";
import { useReaderStore } from "@/stores/reader-store";

interface Props {
  selectedText: string;
  onBack: () => void;
}

/**
 * "Explain with AI" panel — streams a plain-text gloss / translation
 * via the existing LLM proxy. Cancellable mid-stream so a user who
 * navigates away doesn't keep burning quota. Auto-starts the
 * generation on mount (the menu's actions list is the only call
 * site, so the panel ↔ generation lifecycle can be 1:1 with the
 * mount).
 */
export function AnnotationMenuExplainPanel({ selectedText, onBack }: Props) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const hideContextMenu = useAnnotationStore((s) => s.hideContextMenu);

  useEffect(() => {
    const passage = selectedText.trim();
    if (!passage) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setText("");
    setError("");

    // The user is reading on a specific page of a specific book —
    // surface that to the model so the explanation is rooted in the
    // actual study material, not generic encyclopedic prose.
    const activeDoc = useReaderStore.getState().getActiveDoc();
    const bookTitle = activeDoc?.customTitle ?? activeDoc?.meta.title ?? "";
    const sourceLang = detectSourceLang(passage);
    // Hungarian users get Hungarian explanations by default; everyone
    // else gets English. Cheap heuristic — a real i18n-locale-aware
    // pick would need to thread through `useTranslation`'s `i18n`
    // instance which isn't worth the extra dependency for an MVP.
    const replyLang = sourceLang === "hu" ? "Hungarian" : "English";

    const systemPrompt = [
      "You explain selected passages from books for a study-focused reader.",
      "Reply in 2–4 short paragraphs (plain text, no markdown, no headings).",
      `Reply in ${replyLang}.`,
      "First sentence: a plain-language gloss / translation if the passage is in another language.",
      "Then: context, definitions of key terms, and why this matters.",
      "Stay grounded in the passage — do not invent facts that aren't in it.",
    ].join(" ");

    const userPrompt = bookTitle
      ? `From the book "${bookTitle}":\n\n${passage}`
      : passage;

    void (async () => {
      try {
        for await (const chunk of streamChatResponse(
          [{ role: "user", content: userPrompt }],
          "",
          "",
          {
            systemPromptOverride: systemPrompt,
            maxOutputTokens: 500,
            signal: controller.signal,
          },
        )) {
          if (controller.signal.aborted) return;
          setText((prev) => prev + chunk.delta);
        }
      } catch (err) {
        if (controller.signal.aborted || isAbortError(err)) return;
        setError(err instanceof Error ? err.message : "stream_failed");
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
          setLoading(false);
        }
      }
    })();

    return () => {
      controller.abort();
    };
  }, [selectedText]);

  return (
    <div className="flex w-72 flex-col gap-2 p-1">
      <div className="flex items-center gap-1.5">
        <Sparkles size={14} className="text-accent-purple" />
        <span className="text-xs font-medium text-text-primary">
          {t("reader.annotationMenu.explainPanelTitle")}
        </span>
      </div>

      <div className="max-h-20 overflow-y-auto rounded bg-glass-bg/50 px-2 py-1.5 text-xs italic leading-relaxed text-text-muted">
        {selectedText.trim().length > 200
          ? selectedText.trim().slice(0, 200) + "…"
          : selectedText.trim()}
      </div>

      <div className="min-h-[4rem] max-h-56 overflow-y-auto rounded bg-glass-bg px-2 py-2 text-xs leading-relaxed text-text-primary">
        {loading && !text && (
          <span className="flex items-center gap-1.5 text-text-muted">
            <Loader2 size={12} className="animate-spin" />
            {t("reader.annotationMenu.explainLoading")}
          </span>
        )}
        {error && !text && (
          <span className="text-red-400">
            {t("reader.annotationMenu.explainFailed")}
          </span>
        )}
        {text && (
          <p className="whitespace-pre-wrap text-text-secondary">{text}</p>
        )}
      </div>

      <div className="flex justify-end gap-1">
        <button
          className="rounded px-2 py-1 text-xs text-text-muted hover:text-text-secondary transition-colors cursor-pointer"
          onClick={onBack}
        >
          {loading
            ? t("reader.annotationMenu.explainStop")
            : t("reader.annotationMenu.back")}
        </button>
        {text && !loading && (
          <button
            className="rounded bg-accent-purple/20 px-2 py-1 text-xs text-accent-purple transition-colors hover:bg-accent-purple/30 cursor-pointer"
            onClick={() => {
              navigator.clipboard.writeText(text);
              hideContextMenu();
              window.getSelection()?.removeAllRanges();
            }}
          >
            {t("reader.annotationMenu.copy")}
          </button>
        )}
      </div>
    </div>
  );
}
