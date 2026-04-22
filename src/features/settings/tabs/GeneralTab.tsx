import { useTranslation } from "react-i18next";
import { useSettingsStore } from "@/stores/settings-store";
import type { FitMode } from "@/stores/settings-store";
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
    experimental_allowAnnotationsForAllFormats,
    experimental_allowWhiteboardForAllFormats,
    setPageScrollBehavior,
    setScrollAnimationDuration,
    setDefaultFitMode,
    setExperimentalAnnotations,
    setExperimentalWhiteboard,
  } = useSettingsStore();

  const fitModeOptions: { value: FitMode; label: string; description: string }[] = [
    { value: "fit-width", label: "Fit Width", description: "Scale pages to fill the viewer width" },
    { value: "fit-page", label: "Fit Page", description: "Scale pages to fit entirely in view" },
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

      {/* Navigation section */}
      <section className="space-y-4 rounded-xl border border-glass-border bg-glass-bg/50 p-4 sm:p-6">
        <h2 className="text-lg font-semibold text-text-primary">Navigation</h2>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-text-primary">
              Animated page scroll
            </p>
            <p className="text-xs text-text-muted">
              Smoothly animate when navigating between pages
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
              Animation duration
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

      {/* Reader section */}
      <section className="space-y-4 rounded-xl border border-glass-border bg-glass-bg/50 p-4 sm:p-6">
        <h2 className="text-lg font-semibold text-text-primary">Reader</h2>

        <div>
          <p className="text-sm font-medium text-text-primary mb-1">
            Default fit mode
          </p>
          <p className="text-xs text-text-muted mb-3">
            How new documents are scaled when first opened
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
      </section>

      {/* Experimental / Developer section */}
      <section className="space-y-4 rounded-xl border border-glass-border bg-glass-bg/50 p-4 sm:p-6">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">
            Experimental / Developer
          </h2>
          <p className="text-xs text-text-muted mt-0.5">
            Unfinished features intended for testing. Expect rough edges.
          </p>
        </div>

        <div className="flex items-center justify-between">
          <div className="pr-4">
            <p className="text-sm font-medium text-text-primary">
              Allow annotations for all formats
            </p>
            <p className="text-xs text-text-muted">
              Enables highlight/comment UI on TXT, Markdown, and EPUB
              documents. Persisted anchors aren't reflow-aware yet, so
              highlights may drift after edits.
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
              Allow whiteboard for all formats
            </p>
            <p className="text-xs text-text-muted">
              Enables draw mode and whiteboard creation on non-paginated
              documents. Whiteboards anchor to pages, so behavior may be
              unpredictable on reflowable content.
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
