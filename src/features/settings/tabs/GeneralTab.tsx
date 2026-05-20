import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Download } from "lucide-react";
import { useSettingsStore } from "@/stores/settings-store";
import type { FitMode, EpubFlow } from "@/stores/settings-store";
import {
  EPUB_COLUMN_WIDTH_IDS,
  EPUB_FONT_FAMILY_IDS,
  type EpubColumnWidth,
  type EpubFontFamily,
} from "@/lib/epub-typography";
import { Toggle, Slider } from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  isSupportedLanguage,
  setLanguage,
  SUPPORTED_LANGUAGES,
  type SupportedLanguage,
} from "@/lib/i18n";
import { exportUserData } from "@/lib/export-user-data";

type ExportStatus =
  | { kind: "idle" }
  | { kind: "exporting" }
  | { kind: "success" }
  | { kind: "partial"; count: number }
  | { kind: "error"; message: string };

export function GeneralTab() {
  const { t, i18n } = useTranslation();
  const [exportStatus, setExportStatus] = useState<ExportStatus>({
    kind: "idle",
  });

  const handleExport = async () => {
    setExportStatus({ kind: "exporting" });
    try {
      const { payload } = await exportUserData();
      if (payload.errors.length > 0) {
        setExportStatus({ kind: "partial", count: payload.errors.length });
      } else {
        setExportStatus({ kind: "success" });
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setExportStatus({ kind: "error", message });
    }
  };
  const currentLang: SupportedLanguage = isSupportedLanguage(
    i18n.resolvedLanguage,
  )
    ? i18n.resolvedLanguage
    : "en";
  const {
    pageScrollBehavior,
    scrollAnimationDuration,
    defaultFitMode,
    epubFlow,
    epubFontScale,
    epubLineHeight,
    epubFontFamily,
    epubColumnWidth,
    experimental_allowAnnotationsForAllFormats,
    experimental_allowWhiteboardForAllFormats,
    setPageScrollBehavior,
    setScrollAnimationDuration,
    setDefaultFitMode,
    setEpubFlow,
    setEpubFontScale,
    setEpubLineHeight,
    setEpubFontFamily,
    setEpubColumnWidth,
    setExperimentalAnnotations,
    setExperimentalWhiteboard,
  } = useSettingsStore();

  const fitModeOptions: { value: FitMode; label: string; description: string }[] = [
    {
      value: "fit-width",
      label: t("settings.reader.fitWidth"),
      description: t("settings.reader.fitWidthHint"),
    },
    {
      value: "fit-page",
      label: t("settings.reader.fitPage"),
      description: t("settings.reader.fitPageHint"),
    },
  ];

  const epubFlowOptions: { value: EpubFlow; label: string; description: string }[] = [
    {
      value: "scrolled",
      label: t("settings.reader.epubFlowScrolled"),
      description: t("settings.reader.epubFlowScrolledHint"),
    },
    {
      value: "paginated",
      label: t("settings.reader.epubFlowPaginated"),
      description: t("settings.reader.epubFlowPaginatedHint"),
    },
  ];

  // Categorical font-family / column-width pickers. Labels come from
  // i18n; the actual CSS lives in lib/epub-typography.ts so the
  // settings UI doesn't have to know how stacks are spelled.
  const epubFontFamilyOptions: { value: EpubFontFamily; label: string }[] =
    EPUB_FONT_FAMILY_IDS.map((id) => ({
      value: id,
      label: t(`settings.reader.epubFontFamily_${id}`),
    }));
  const epubColumnWidthOptions: { value: EpubColumnWidth; label: string }[] =
    EPUB_COLUMN_WIDTH_IDS.map((id) => ({
      value: id,
      label: t(`settings.reader.epubColumnWidth_${id}`),
    }));

  return (
    <div className="space-y-6">
      <section className="space-y-3 sm:rounded-xl sm:border sm:border-glass-border sm:bg-glass-bg/50 sm:p-6">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">
            {t("settings.language.label")}
          </h2>
          <p className="mt-0.5 text-xs text-text-muted">
            {t("settings.language.description")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {SUPPORTED_LANGUAGES.map((lang) => (
            <button
              key={lang}
              onClick={() => void setLanguage(lang)}
              className={cn(
                "flex-1 min-w-[8rem] rounded-lg border px-3 py-2 text-sm font-medium transition-colors cursor-pointer",
                currentLang === lang
                  ? "border-accent-purple bg-accent-purple/10 text-accent-purple"
                  : "border-glass-border bg-glass-bg text-text-secondary hover:bg-glass-hover hover:text-text-primary",
              )}
            >
              {t(`settings.language.${lang}`)}
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-4 sm:rounded-xl sm:border sm:border-glass-border sm:bg-glass-bg/50 sm:p-6">
        <h2 className="text-lg font-semibold text-text-primary">
          {t("settings.navigation.heading")}
        </h2>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-text-primary">
              {t("settings.navigation.animatedScroll")}
            </p>
            <p className="text-xs text-text-muted">
              {t("settings.navigation.animatedScrollHint")}
            </p>
          </div>
          <Toggle
            checked={pageScrollBehavior === "smooth"}
            onChange={(checked) =>
              setPageScrollBehavior(checked ? "smooth" : "instant")
            }
          />
        </div>

        {pageScrollBehavior === "smooth" && (
          <div className="space-y-2 pl-0">
            <p className="text-sm font-medium text-text-primary">
              {t("settings.navigation.animationDuration")}
            </p>
            <Slider
              value={scrollAnimationDuration}
              onChange={setScrollAnimationDuration}
              min={100}
              max={1000}
              step={50}
              valueLabel={`${scrollAnimationDuration}ms`}
            />
          </div>
        )}
      </section>

      <section className="space-y-4 sm:rounded-xl sm:border sm:border-glass-border sm:bg-glass-bg/50 sm:p-6">
        <h2 className="text-lg font-semibold text-text-primary">
          {t("settings.reader.heading")}
        </h2>

        <div>
          <p className="text-sm font-medium text-text-primary mb-1">
            {t("settings.reader.fitMode")}
          </p>
          <p className="text-xs text-text-muted mb-3">
            {t("settings.reader.fitModeHint")}
          </p>
          <div className="flex gap-2">
            {fitModeOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setDefaultFitMode(opt.value)}
                className={cn(
                  "flex-1 rounded-lg border px-3 py-2.5 text-left transition-colors cursor-pointer",
                  defaultFitMode === opt.value
                    ? "border-accent-purple bg-accent-purple/10 text-accent-purple"
                    : "border-glass-border bg-glass-bg text-text-secondary hover:bg-glass-hover hover:text-text-primary",
                )}
              >
                <span className="block text-sm font-medium">{opt.label}</span>
                <span className="block text-xs opacity-70 mt-0.5">{opt.description}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="text-sm font-medium text-text-primary mb-1">
            {t("settings.reader.epubFlow")}
          </p>
          <p className="text-xs text-text-muted mb-3">
            {t("settings.reader.epubFlowHint")}
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            {epubFlowOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setEpubFlow(opt.value)}
                className={cn(
                  "flex-1 rounded-lg border px-3 py-2.5 text-left transition-colors cursor-pointer",
                  epubFlow === opt.value
                    ? "border-accent-purple bg-accent-purple/10 text-accent-purple"
                    : "border-glass-border bg-glass-bg text-text-secondary hover:bg-glass-hover hover:text-text-primary",
                )}
              >
                <span className="block text-sm font-medium">{opt.label}</span>
                <span className="block text-xs opacity-70 mt-0.5">{opt.description}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm font-medium text-text-primary">
              {t("settings.reader.epubFontScale")}
            </p>
            <button
              type="button"
              onClick={() => setEpubFontScale(1.0)}
              className="text-xs text-text-muted hover:text-accent-purple cursor-pointer"
            >
              {t("settings.reader.reset")}
            </button>
          </div>
          <p className="text-xs text-text-muted">
            {t("settings.reader.epubFontScaleHint")}
          </p>
          <Slider
            value={Math.round(epubFontScale * 100)}
            onChange={(v) => setEpubFontScale(v / 100)}
            min={70}
            max={160}
            step={5}
            valueLabel={`${Math.round(epubFontScale * 100)}%`}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm font-medium text-text-primary">
              {t("settings.reader.epubLineHeight")}
            </p>
            <button
              type="button"
              onClick={() => setEpubLineHeight(1.5)}
              className="text-xs text-text-muted hover:text-accent-purple cursor-pointer"
            >
              {t("settings.reader.reset")}
            </button>
          </div>
          <p className="text-xs text-text-muted">
            {t("settings.reader.epubLineHeightHint")}
          </p>
          <Slider
            value={Math.round(epubLineHeight * 10)}
            onChange={(v) => setEpubLineHeight(v / 10)}
            min={10}
            max={22}
            step={1}
            valueLabel={epubLineHeight.toFixed(1)}
          />
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium text-text-primary">
            {t("settings.reader.epubFontFamily")}
          </p>
          <p className="text-xs text-text-muted">
            {t("settings.reader.epubFontFamilyHint")}
          </p>
          <div className="flex flex-wrap gap-2">
            {epubFontFamilyOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setEpubFontFamily(opt.value)}
                className={cn(
                  "flex-1 min-w-[6rem] rounded-lg border px-3 py-2 text-sm font-medium transition-colors cursor-pointer",
                  epubFontFamily === opt.value
                    ? "border-accent-purple bg-accent-purple/10 text-accent-purple"
                    : "border-glass-border bg-glass-bg text-text-secondary hover:bg-glass-hover hover:text-text-primary",
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium text-text-primary">
            {t("settings.reader.epubColumnWidth")}
          </p>
          <p className="text-xs text-text-muted">
            {t("settings.reader.epubColumnWidthHint")}
          </p>
          <div className="flex flex-wrap gap-2">
            {epubColumnWidthOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setEpubColumnWidth(opt.value)}
                className={cn(
                  "flex-1 min-w-[6rem] rounded-lg border px-3 py-2 text-sm font-medium transition-colors cursor-pointer",
                  epubColumnWidth === opt.value
                    ? "border-accent-purple bg-accent-purple/10 text-accent-purple"
                    : "border-glass-border bg-glass-bg text-text-secondary hover:bg-glass-hover hover:text-text-primary",
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="space-y-4 sm:rounded-xl sm:border sm:border-glass-border sm:bg-glass-bg/50 sm:p-6">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">
            {t("settings.experimental.heading")}
          </h2>
          <p className="text-xs text-text-muted mt-0.5">
            {t("settings.experimental.description")}
          </p>
        </div>

        <div className="flex items-center justify-between">
          <div className="pr-4">
            <p className="text-sm font-medium text-text-primary">
              {t("settings.experimental.annotationsAllFormats")}
            </p>
            <p className="text-xs text-text-muted">
              {t("settings.experimental.annotationsAllFormatsHint")}
            </p>
          </div>
          <Toggle
            checked={experimental_allowAnnotationsForAllFormats}
            onChange={setExperimentalAnnotations}
          />
        </div>

        <div className="flex items-center justify-between">
          <div className="pr-4">
            <p className="text-sm font-medium text-text-primary">
              {t("settings.experimental.whiteboardAllFormats")}
            </p>
            <p className="text-xs text-text-muted">
              {t("settings.experimental.whiteboardAllFormatsHint")}
            </p>
          </div>
          <Toggle
            checked={experimental_allowWhiteboardForAllFormats}
            onChange={setExperimentalWhiteboard}
          />
        </div>
      </section>

      <section className="space-y-3 sm:rounded-xl sm:border sm:border-glass-border sm:bg-glass-bg/50 sm:p-6">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">
            {t("settings.data.heading")}
          </h2>
          <p className="mt-0.5 text-xs text-text-muted">
            {t("settings.data.description")}
          </p>
        </div>
        <button
          type="button"
          onClick={handleExport}
          disabled={exportStatus.kind === "exporting"}
          className="inline-flex items-center gap-2 rounded-lg border border-glass-border bg-glass-bg px-3 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-glass-hover hover:border-accent-purple/50 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
        >
          <Download size={14} />
          {exportStatus.kind === "exporting"
            ? t("settings.data.exportingButton")
            : t("settings.data.exportButton")}
        </button>
        {exportStatus.kind === "success" && (
          <p className="text-xs text-green-500">
            {t("settings.data.exportSuccess")}
          </p>
        )}
        {exportStatus.kind === "partial" && (
          <p className="text-xs text-amber-400">
            {t("settings.data.exportPartial", { count: exportStatus.count })}
          </p>
        )}
        {exportStatus.kind === "error" && (
          <p className="text-xs text-red-400">
            {t("settings.data.exportError", { message: exportStatus.message })}
          </p>
        )}
      </section>
    </div>
  );
}
