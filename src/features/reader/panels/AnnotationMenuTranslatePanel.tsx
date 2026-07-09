import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeftRight, ChevronDown, Languages, Loader2 } from "lucide-react";
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
 * Translate panel — MyMemory free API. Both source and target languages
 * are user-selectable and persisted in settings-store; the source
 * defaults to "auto" (detected from the text). Re-translates whenever
 * either language changes so the user can flip langs in place.
 */
export function AnnotationMenuTranslatePanel({
  selectedText,
  onBack,
  fullWidth = false,
}: Props) {
  const { t } = useTranslation();
  const sourceLanguage = useSettingsStore((s) => s.translateSourceLanguage);
  const setSourceLanguage = useSettingsStore(
    (s) => s.setTranslateSourceLanguage,
  );
  const targetLanguage = useSettingsStore((s) => s.translateTargetLanguage);
  const setTargetLanguage = useSettingsStore(
    (s) => s.setTranslateTargetLanguage,
  );
  const hideContextMenu = useAnnotationStore((s) => s.hideContextMenu);

  const [translated, setTranslated] = useState("");
  const [translating, setTranslating] = useState(false);
  const [error, setError] = useState("");

  const trimmed = selectedText.trim();
  const effectiveSource =
    sourceLanguage === "auto" ? detectSourceLang(trimmed) : sourceLanguage;

  const runTranslate = useCallback(
    async (source: string, target: string) => {
      const text = selectedText.trim();
      if (!text) return;
      setTranslating(true);
      setTranslated("");
      setError("");
      try {
        const data = await translateViaMyMemory(text, source, target);
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

  // Re-translate on mount and whenever either language changes.
  useEffect(() => {
    void runTranslate(effectiveSource, targetLanguage);
  }, [runTranslate, effectiveSource, targetLanguage]);

  const handleSwap = useCallback(() => {
    // Resolve "auto" to the detected language first so we never move
    // "auto" into the target slot.
    setSourceLanguage(targetLanguage);
    setTargetLanguage(effectiveSource);
  }, [setSourceLanguage, setTargetLanguage, targetLanguage, effectiveSource]);

  return (
    <div className={cn("flex flex-col gap-2.5 p-1", fullWidth ? "w-full" : "w-72")}>
      <div className="flex items-center gap-1.5">
        <Languages size={14} className="text-accent" />
        <span className="text-xs font-medium text-text-primary">
          {t("reader.annotationMenu.translatePanelTitle")}
        </span>
        <span className="ml-auto rounded bg-glass-bg px-1.5 py-0.5 text-2xs uppercase tracking-wide text-text-muted">
          {effectiveSource}
          <span className="mx-1">→</span>
          {targetLanguage}
        </span>
      </div>

      {/* Language pickers: source ⇄ target */}
      <div className="flex items-end gap-2">
        <LangSelect
          label={t("reader.annotationMenu.translateSourceLabel", {
            defaultValue: "From",
          })}
          value={sourceLanguage}
          onChange={(e) => setSourceLanguage(e.target.value)}
          autoLabel={t("reader.annotationMenu.translateAutoDetect", {
            defaultValue: "Auto-detect",
          })}
          autoHint={sourceLanguage === "auto" ? effectiveSource : undefined}
        />
        <button
          type="button"
          onClick={handleSwap}
          title={t("reader.annotationMenu.translateSwap", {
            defaultValue: "Swap languages",
          })}
          className="mb-0.5 shrink-0 rounded-md border border-glass-border bg-glass-bg p-1.5 text-text-muted transition-colors hover:bg-glass-hover hover:text-accent cursor-pointer"
        >
          <ArrowLeftRight size={13} />
        </button>
        <LangSelect
          label={t("reader.annotationMenu.translateTargetLabel")}
          value={targetLanguage}
          onChange={(e) => setTargetLanguage(e.target.value)}
        />
      </div>

      {/* Source text */}
      <div className="max-h-20 overflow-y-auto rounded bg-glass-bg/50 px-2 py-1.5 text-xs italic leading-relaxed text-text-muted">
        {trimmed.length > 200 ? trimmed.slice(0, 200) + "…" : trimmed}
      </div>

      {/* Translation result */}
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

/** A styled language `<select>` with a chevron; the source picker adds
 *  an "auto" option at the top. */
function LangSelect({
  label,
  value,
  onChange,
  autoLabel,
  autoHint,
}: {
  label: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  autoLabel?: string;
  autoHint?: string;
}) {
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="text-2xs uppercase tracking-wide text-text-muted">
        {label}
      </span>
      <div className="relative">
        <select
          value={value}
          onChange={onChange}
          className="w-full cursor-pointer appearance-none rounded-md border border-glass-border bg-bg-tertiary py-1.5 pl-2.5 pr-7 text-xs text-text-primary outline-none transition-colors hover:border-glass-hover focus:border-accent focus:ring-1 focus:ring-accent/30"
        >
          {autoLabel && (
            <option value="auto">
              {autoLabel}
              {autoHint ? ` (${autoHint})` : ""}
            </option>
          )}
          {TRANSLATE_LANGUAGES.map(({ code, label }) => (
            <option key={code} value={code}>
              {label}
            </option>
          ))}
        </select>
        <ChevronDown
          size={13}
          className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-text-muted"
        />
      </div>
    </label>
  );
}
