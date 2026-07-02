import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Languages, Loader2 } from "lucide-react";
import { useAnnotationStore } from "@/stores/annotation-store";
import { useSettingsStore } from "@/stores/settings-store";
import { detectSourceLang } from "@/lib/lang-detect";
import { cn } from "@/lib/cn";

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

interface Props {
  selectedText: string;
  /** Return to the annotation menu's action list. Omitted in the
   *  persistent reader-tools side panel. */
  onBack?: () => void;
  /** Stretch to the container width instead of the popover's fixed
   *  `w-72`. Set when hosted in the reader-tools side panel. */
  fullWidth?: boolean;
}

interface MyMemoryResponse {
  responseStatus?: number;
  responseDetails?: string;
  responseData?: { translatedText?: string };
}

async function translateViaMyMemory(
  text: string,
  source: string,
  target: string,
): Promise<MyMemoryResponse> {
  const langPair = `${source}|${target}`;
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(
    text,
  )}&langpair=${langPair}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as MyMemoryResponse;
}

/**
 * Translate panel — MyMemory free API, source-language auto-detected
 * (Hungarian-flavour chars → "hu", else "en"), target picked from a
 * fixed set persisted in settings-store. Re-translates on target
 * change so the user can flip langs without leaving the panel.
 */
export function AnnotationMenuTranslatePanel({
  selectedText,
  onBack,
  fullWidth = false,
}: Props) {
  const { t } = useTranslation();
  const targetLanguage = useSettingsStore((s) => s.translateTargetLanguage);
  const setTargetLanguage = useSettingsStore(
    (s) => s.setTranslateTargetLanguage,
  );
  const hideContextMenu = useAnnotationStore((s) => s.hideContextMenu);

  const [translated, setTranslated] = useState("");
  const [translating, setTranslating] = useState(false);
  const [error, setError] = useState("");

  const runTranslate = useCallback(
    async (target: string) => {
      const trimmed = selectedText.trim();
      if (!trimmed) return;
      setTranslating(true);
      setTranslated("");
      setError("");
      try {
        const data = await translateViaMyMemory(
          trimmed,
          detectSourceLang(trimmed),
          target,
        );
        if (
          data.responseStatus === 200 &&
          data.responseData?.translatedText
        ) {
          setTranslated(data.responseData.translatedText);
        } else {
          setError(
            data.responseDetails || t("reader.annotationMenu.translateFailed"),
          );
        }
      } catch {
        setError(t("reader.annotationMenu.translateConnectFailed"));
      } finally {
        setTranslating(false);
      }
    },
    [selectedText, t],
  );

  // First translation runs on mount with the current target. If the
  // user flips the target via the picker below, we re-translate.
  useEffect(() => {
    void runTranslate(targetLanguage);
  }, [runTranslate, targetLanguage]);

  const handleLanguageChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      setTargetLanguage(e.target.value);
      // runTranslate will fire automatically via the effect above once
      // targetLanguage updates in the store; no need to call here.
    },
    [setTargetLanguage],
  );

  return (
    <div className={cn("flex flex-col gap-2 p-1", fullWidth ? "w-full" : "w-72")}>
      <div className="flex items-center gap-1.5">
        <Languages size={14} className="text-accent" />
        <span className="text-xs font-medium text-text-primary">
          {t("reader.annotationMenu.translatePanelTitle")}
        </span>
        <span className="ml-auto rounded bg-glass-bg px-1.5 py-0.5 text-2xs uppercase tracking-wide text-text-muted">
          {detectSourceLang(selectedText.trim())}
          <span className="mx-1">→</span>
          {targetLanguage}
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
        {error && <span className="text-danger">{error}</span>}
        {!translating && !error && translated && translated}
      </div>

      {/* Target language picker */}
      <div className="flex items-center gap-2">
        <label
          htmlFor="translate-lang"
          className="text-2xs text-text-muted"
        >
          {t("reader.annotationMenu.translateTargetLabel")}
        </label>
        <select
          id="translate-lang"
          value={targetLanguage}
          onChange={handleLanguageChange}
          className="flex-1 cursor-pointer rounded border border-glass-border bg-glass-bg px-2 py-1 text-xs text-text-primary outline-none focus:border-accent"
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
        {onBack && (
          <button
            className="rounded px-2 py-1 text-xs text-text-muted transition-colors hover:text-text-secondary cursor-pointer"
            onClick={onBack}
          >
            {t("reader.annotationMenu.back")}
          </button>
        )}
        {translated && (
          <button
            className="rounded bg-accent/20 px-2 py-1 text-xs text-accent transition-colors hover:bg-accent/30 cursor-pointer"
            onClick={() => {
              navigator.clipboard.writeText(translated);
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
