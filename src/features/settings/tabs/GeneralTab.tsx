import { useTranslation } from "react-i18next";
import { useSettingsStore } from "@/stores/settings-store";
import type { FitMode, EpubFlow } from "@/stores/settings-store";
import { Toggle, Slider } from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  isSupportedLanguage,
  setLanguage,
  SUPPORTED_LANGUAGES,
  type SupportedLanguage,
} from "@/lib/i18n";

export function GeneralTab() {
  const { t, i18n } = useTranslation();
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
    experimental_allowAnnotationsForAllFormats,
    experimental_allowWhiteboardForAllFormats,
    setPageScrollBehavior,
    setScrollAnimationDuration,
    setDefaultFitMode,
    setEpubFlow,
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

  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-xl border border-glass-border bg-glass-bg/50 p-4 sm:p-6">
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

      <section className="space-y-4 rounded-xl border border-glass-border bg-glass-bg/50 p-4 sm:p-6">
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

      <section className="space-y-4 rounded-xl border border-glass-border bg-glass-bg/50 p-4 sm:p-6">
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
      </section>

      <section className="space-y-4 rounded-xl border border-glass-border bg-glass-bg/50 p-4 sm:p-6">
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
    </div>
  );
}
