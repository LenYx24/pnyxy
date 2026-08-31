import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, RotateCcw } from "lucide-react";
import { useSettingsStore } from "@/stores/settings-store";
import type { FitMode, EpubFlow } from "@/stores/settings-store";
import {
  EPUB_COLUMN_WIDTH_IDS,
  EPUB_FONT_FAMILY_IDS,
  type EpubColumnWidth,
  type EpubFontFamily,
} from "@/lib/epub-typography";
import { Button, Toggle } from "@/components/ui";
import {
  isSupportedLanguage,
  setLanguage,
  SUPPORTED_LANGUAGES,
  type SupportedLanguage,
} from "@/lib/i18n";
import { exportUserData } from "@/lib/export-user-data";
import { useAuthStore } from "@/stores/auth-store";
import { DeleteAccountSection } from "./DeleteAccountSection";
import { useFeatures } from "@/lib/use-features";
import {
  FEATURE_KEYS,
  FEATURE_META,
  serverUnlockedFeatures,
} from "@/lib/features";
import {
  Disclosure,
  OptionChips,
  SettingRow,
  SettingsSection,
  SliderWithInput,
  StatusLine,
} from "../ui";

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
  const isAdmin = useAuthStore((s) => s.profile?.role === "admin");
  const serverUnlocked = serverUnlockedFeatures(
    useAuthStore((s) => s.profile?.preferences),
  );
  const features = useFeatures();
  const featureOverrides = useSettingsStore((s) => s.featureOverrides);
  const setFeatureOverride = useSettingsStore((s) => s.setFeatureOverride);
  const adminShowAllFeatures = useSettingsStore((s) => s.adminShowAllFeatures);
  const setAdminShowAllFeatures = useSettingsStore(
    (s) => s.setAdminShowAllFeatures,
  );
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
    setOnboardingCompleted,
  } = useSettingsStore();

  const fitModeOptions: { value: FitMode; label: string; title: string }[] = [
    {
      value: "fit-width",
      label: t("settings.reader.fitWidth"),
      title: t("settings.reader.fitWidthHint"),
    },
    {
      value: "fit-page",
      label: t("settings.reader.fitPage"),
      title: t("settings.reader.fitPageHint"),
    },
  ];

  const epubFlowOptions: { value: EpubFlow; label: string; title: string }[] = [
    {
      value: "scrolled",
      label: t("settings.reader.epubFlowScrolled"),
      title: t("settings.reader.epubFlowScrolledHint"),
    },
    {
      value: "paginated",
      label: t("settings.reader.epubFlowPaginated"),
      title: t("settings.reader.epubFlowPaginatedHint"),
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

  const resetLink = (onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      className="cursor-pointer text-[13px] text-text-muted transition-colors hover:text-text-primary"
    >
      {t("settings.reader.reset")}
    </button>
  );

  return (
    <div className="space-y-8">
      <SettingsSection>
        <SettingRow
          label={t("settings.language.label")}
          hint={t("settings.language.description")}
          control={
            <OptionChips
              value={currentLang}
              options={SUPPORTED_LANGUAGES.map((lang) => ({
                value: lang,
                label: t(`settings.language.${lang}`),
              }))}
              onChange={(lang) => void setLanguage(lang)}
            />
          }
        />
      </SettingsSection>

      <SettingsSection title={t("settings.reader.heading")}>
        <SettingRow
          label={t("settings.reader.fitMode")}
          hint={t("settings.reader.fitModeHint")}
          control={
            <OptionChips
              value={defaultFitMode}
              options={fitModeOptions}
              onChange={setDefaultFitMode}
            />
          }
        />
      </SettingsSection>

      <SettingsSection title={t("settings.pageTurning.heading")}>
        <SettingRow
          label={t("settings.pageTurning.animatedScroll")}
          hint={t("settings.pageTurning.animatedScrollHint")}
          control={
            <Toggle
              checked={pageScrollBehavior === "smooth"}
              onChange={(checked) =>
                setPageScrollBehavior(checked ? "smooth" : "instant")
              }
            />
          }
        />
        {pageScrollBehavior === "smooth" && (
          <SettingRow
            label={t("settings.pageTurning.animationDuration")}
            stacked
          >
            <SliderWithInput
              value={scrollAnimationDuration}
              onChange={setScrollAnimationDuration}
              min={100}
              max={1000}
              step={50}
              unit="ms"
              ariaLabel={t("settings.pageTurning.animationDuration")}
            />
          </SettingRow>
        )}
      </SettingsSection>

      <Disclosure title={t("settings.reader.epubHeading")}>
        <SettingRow
          label={t("settings.reader.epubFlow")}
          hint={t("settings.reader.epubFlowHint")}
          control={
            <OptionChips
              value={epubFlow}
              options={epubFlowOptions}
              onChange={setEpubFlow}
            />
          }
        />
        <SettingRow
          label={t("settings.reader.epubFontScale")}
          hint={t("settings.reader.epubFontScaleHint")}
          control={resetLink(() => setEpubFontScale(1.0))}
        >
          <SliderWithInput
            value={Math.round(epubFontScale * 100)}
            onChange={(v) => setEpubFontScale(v / 100)}
            min={70}
            max={160}
            step={5}
            unit="%"
            ariaLabel={t("settings.reader.epubFontScale")}
          />
        </SettingRow>
        <SettingRow
          label={t("settings.reader.epubLineHeight")}
          hint={t("settings.reader.epubLineHeightHint")}
          control={resetLink(() => setEpubLineHeight(1.5))}
        >
          <SliderWithInput
            value={epubLineHeight}
            onChange={setEpubLineHeight}
            min={1}
            max={2.2}
            step={0.1}
            decimals={1}
            ariaLabel={t("settings.reader.epubLineHeight")}
          />
        </SettingRow>
        <SettingRow
          label={t("settings.reader.epubFontFamily")}
          hint={t("settings.reader.epubFontFamilyHint")}
          stacked
        >
          <OptionChips
            value={epubFontFamily}
            options={epubFontFamilyOptions}
            onChange={setEpubFontFamily}
          />
        </SettingRow>
        <SettingRow
          label={t("settings.reader.epubColumnWidth")}
          hint={t("settings.reader.epubColumnWidthHint")}
          stacked
        >
          <OptionChips
            value={epubColumnWidth}
            options={epubColumnWidthOptions}
            onChange={setEpubColumnWidth}
          />
        </SettingRow>
      </Disclosure>

      <SettingsSection title={t("settings.data.heading")}>
        <SettingRow
          label={t("settings.data.heading")}
          hint={t("settings.data.description")}
          control={
            <Button
              variant="secondary"
              onClick={handleExport}
              disabled={exportStatus.kind === "exporting"}
            >
              <Download size={16} />
              {exportStatus.kind === "exporting"
                ? t("settings.data.exportingButton")
                : t("settings.data.exportButton")}
            </Button>
          }
        />
        {exportStatus.kind === "success" && (
          <StatusLine tone="success">
            {t("settings.data.exportSuccess")}
          </StatusLine>
        )}
        {exportStatus.kind === "partial" && (
          <StatusLine tone="warning">
            {t("settings.data.exportPartial", { count: exportStatus.count })}
          </StatusLine>
        )}
        {exportStatus.kind === "error" && (
          <StatusLine tone="danger">
            {t("settings.data.exportError", { message: exportStatus.message })}
          </StatusLine>
        )}
        {exportStatus.kind !== "idle" && exportStatus.kind !== "exporting" && (
          <div className="pb-3" />
        )}
      </SettingsSection>

      <SettingsSection title={t("settings.onboarding.heading")}>
        <SettingRow
          label={t("settings.onboarding.heading")}
          hint={t("settings.onboarding.description")}
          control={
            <Button
              variant="secondary"
              onClick={() => setOnboardingCompleted(false)}
            >
              <RotateCcw size={16} />
              {t("settings.onboarding.restartButton")}
            </Button>
          }
        />
      </SettingsSection>

      {isAdmin && (
        <SettingsSection
          caption={t("settings.features.adminCaption")}
          title={t("settings.features.heading")}
          description={t("settings.features.description")}
        >
          <SettingRow
            label={t("settings.features.showAll")}
            hint={t("settings.features.showAllHint")}
            control={
              <Toggle
                checked={adminShowAllFeatures}
                onChange={setAdminShowAllFeatures}
              />
            }
          />
          <div className="my-1 rounded-control bg-bg-secondary/60 px-1">
            {FEATURE_KEYS.map((key) => {
              const override = featureOverrides[key];
              const notes = [
                serverUnlocked.includes(key)
                  ? t("settings.features.serverUnlocked")
                  : null,
                override !== undefined
                  ? t("settings.features.overridden")
                  : null,
              ].filter(Boolean);
              return (
                <SettingRow
                  key={key}
                  className="px-3"
                  label={
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span>{FEATURE_META[key].label}</span>
                      <span className="font-mono text-2xs font-normal text-text-muted-2">
                        {key}
                      </span>
                    </span>
                  }
                  hint={
                    <>
                      {FEATURE_META[key].hint}
                      {notes.length > 0 && (
                        <span className="text-text-muted-2">
                          {" "}
                          ({notes.join(", ")})
                        </span>
                      )}
                    </>
                  }
                  control={
                    <>
                      {override !== undefined && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setFeatureOverride(key, undefined)}
                        >
                          {t("settings.features.reset")}
                        </Button>
                      )}
                      <Toggle
                        checked={features[key]}
                        onChange={(v) => setFeatureOverride(key, v)}
                      />
                    </>
                  }
                />
              );
            })}
          </div>
        </SettingsSection>
      )}

      <SettingsSection
        title={t("settings.experimental.heading")}
        description={t("settings.experimental.description")}
      >
        <SettingRow
          label={t("settings.experimental.annotationsAllFormats")}
          hint={t("settings.experimental.annotationsAllFormatsHint")}
          control={
            <Toggle
              checked={experimental_allowAnnotationsForAllFormats}
              onChange={setExperimentalAnnotations}
            />
          }
        />
        <SettingRow
          label={t("settings.experimental.whiteboardAllFormats")}
          hint={t("settings.experimental.whiteboardAllFormatsHint")}
          control={
            <Toggle
              checked={experimental_allowWhiteboardForAllFormats}
              onChange={setExperimentalWhiteboard}
            />
          }
        />
      </SettingsSection>

      <DeleteAccountSection />
    </div>
  );
}
