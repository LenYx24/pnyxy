import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Copy, Languages, Volume2, X, Loader2 } from "lucide-react";
import { useSettingsStore } from "@/stores/settings-store";
import { useTtsStore } from "@/stores/tts-store";
import { detectSourceLang } from "@/lib/lang-detect";

async function translateText(
  text: string,
  source: string,
  target: string,
): Promise<string> {
  const src = source === "auto" ? detectSourceLang(text) : source;
  if (src === target) return text;
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${src}|${target}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as {
    responseData?: { translatedText?: string };
  };
  const translated = data.responseData?.translatedText;
  if (!translated) throw new Error("No translation returned");
  return translated;
}

export interface EpubSelectionState {
  text: string;
  /** Viewport-relative anchor rect, popover is placed above (or below if no room). */
  rect: { left: number; top: number; width: number; height: number };
}

interface EpubSelectionPopoverProps {
  selection: EpubSelectionState | null;
  onDismiss: () => void;
}

const POPOVER_WIDTH = 240;
const POPOVER_GAP = 8;

export function EpubSelectionPopover({
  selection,
  onDismiss,
}: EpubSelectionPopoverProps) {
  const { t } = useTranslation();
  const popoverRef = useRef<HTMLDivElement>(null);
  const translateSource = useSettingsStore((s) => s.translateSourceLanguage);
  const translateTarget = useSettingsStore((s) => s.translateTargetLanguage);

  const [translated, setTranslated] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Reset transient state every time the popover opens for a new selection.
  useEffect(() => {
    if (!selection) return;
    setTranslated(null);
    setTranslating(false);
    setTranslateError(null);
    setCopied(false);
  }, [selection]);

  // Tap outside dismisses. We listen on pointerdown so it fires before
  // any click handler inside the iframe could re-open us.
  useEffect(() => {
    if (!selection) return;
    const onPointerDown = (e: PointerEvent) => {
      const el = popoverRef.current;
      if (el && e.target instanceof Node && el.contains(e.target)) return;
      onDismiss();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [selection, onDismiss]);

  const handleCopy = useCallback(async () => {
    if (!selection) return;
    try {
      await navigator.clipboard.writeText(selection.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }, [selection]);

  const handleReadAloud = useCallback(() => {
    if (!selection) return;
    useTtsStore.getState().speak(selection.text);
    onDismiss();
  }, [selection, onDismiss]);

  const handleTranslate = useCallback(async () => {
    if (!selection) return;
    setTranslating(true);
    setTranslateError(null);
    try {
      const result = await translateText(
        selection.text,
        translateSource,
        translateTarget,
      );
      setTranslated(result);
    } catch (err) {
      setTranslateError(err instanceof Error ? err.message : "Failed");
    } finally {
      setTranslating(false);
    }
  }, [selection, translateSource, translateTarget]);

  if (!selection) return null;

  // Place above the selection by default; flip below if it would clip
  // off the top of the viewport. Popover height isn't known until paint,
  // so we measure a conservative 140px upper bound for the flip decision.
  const ESTIMATED_HEIGHT = 140;
  const placeAbove =
    selection.rect.top - ESTIMATED_HEIGHT - POPOVER_GAP > POPOVER_GAP;
  const top = placeAbove
    ? Math.max(POPOVER_GAP, selection.rect.top - ESTIMATED_HEIGHT - POPOVER_GAP)
    : Math.min(
        window.innerHeight - ESTIMATED_HEIGHT - POPOVER_GAP,
        selection.rect.top + selection.rect.height + POPOVER_GAP,
      );

  const desiredLeft =
    selection.rect.left + selection.rect.width / 2 - POPOVER_WIDTH / 2;
  const left = Math.max(
    POPOVER_GAP,
    Math.min(desiredLeft, window.innerWidth - POPOVER_WIDTH - POPOVER_GAP),
  );

  return createPortal(
    <div
      ref={popoverRef}
      role="dialog"
      aria-label={t("reader.epubSelection.label")}
      className="fixed z-[1000] rounded-xl border border-glass-border bg-glass-bg p-2 shadow-xl backdrop-blur-xl"
      style={{ top, left, width: POPOVER_WIDTH }}
    >
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={handleCopy}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-medium text-text-primary hover:bg-glass-hover cursor-pointer"
        >
          <Copy size={14} />
          {copied ? t("reader.epubSelection.copied") : t("reader.epubSelection.copy")}
        </button>
        <button
          type="button"
          onClick={handleTranslate}
          disabled={translating}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-medium text-text-primary hover:bg-glass-hover cursor-pointer disabled:opacity-50"
        >
          {translating ? <Loader2 size={14} className="animate-spin" /> : <Languages size={14} />}
          {t("reader.epubSelection.translate")}
        </button>
        <button
          type="button"
          onClick={handleReadAloud}
          aria-label={t("reader.epubSelection.readAloud")}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-text-primary hover:bg-glass-hover cursor-pointer"
        >
          <Volume2 size={14} />
        </button>
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t("reader.epubSelection.dismiss")}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted hover:bg-glass-hover hover:text-text-primary cursor-pointer"
        >
          <X size={14} />
        </button>
      </div>

      {(translated || translateError) && (
        <div className="mt-2 max-h-32 overflow-auto rounded-lg bg-bg-primary/40 px-2 py-1.5 text-xs text-text-secondary">
          {translateError ? (
            <span className="text-danger">{translateError}</span>
          ) : (
            translated
          )}
        </div>
      )}
    </div>,
    document.body,
  );
}
