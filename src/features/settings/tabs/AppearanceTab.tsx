import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui";
import { useSettingsStore } from "@/stores/settings-store";
import { CORE_THEMES } from "@/lib/themes";
import type { Theme } from "@/lib/themes";
import { ThemeCard } from "../ThemeCard";
import { BrowseCommunityModal } from "../BrowseCommunityModal";
import { useLibraryPrefs } from "@/features/library/useLibraryPrefs";
import { getUserCss, setUserCss } from "@/lib/user-css";
import { SectionCaption, SettingRow, SettingsSection, SliderWithInput } from "../ui";

export function AppearanceTab() {
  const { t } = useTranslation();
  const activeThemeId = useSettingsStore((s) => s.activeThemeId);
  const installedThemes = useSettingsStore((s) => s.installedThemes);
  const setActiveTheme = useSettingsStore((s) => s.setActiveTheme);
  const uninstallTheme = useSettingsStore((s) => s.uninstallTheme);

  // Library cover size used to live in the library toolbar; moved
  // here because users set it once and don't want it taking up
  // header space on the actual library.
  const { cardSize, setCardSize } = useLibraryPrefs();

  const [browseOpen, setBrowseOpen] = useState(false);

  // User-supplied CSS. Live-apply on every keystroke so the user
  // sees changes immediately, broken CSS rules are silently
  // ignored by the browser, so there's no "syntax error" state to
  // guard against.
  const [customCss, setCustomCss] = useState<string>(() => getUserCss());
  const handleCssChange = (value: string) => {
    setCustomCss(value);
    setUserCss(value);
  };
  const handleCssReset = () => {
    setCustomCss("");
    setUserCss("");
  };

  // Core themes always shown first; community themes after.
  const coreList = Object.values(CORE_THEMES) as Theme[];
  const communityList = Object.values(installedThemes).filter(
    (t) => !(t.id in CORE_THEMES),
  );

  return (
    <section className="space-y-8">
      <SettingsSection
        description={t("settings.appearanceSection.description")}
        actions={
          <Button variant="secondary" size="sm" onClick={() => setBrowseOpen(true)}>
            <Plus size={14} />
            {t("settings.appearanceSection.browseCommunity")}
          </Button>
        }
        plain
      >
        <div className="space-y-5">
          <div className="space-y-2">
            <SectionCaption className="px-1">
              {t("settings.appearanceSection.coreThemes")}
            </SectionCaption>
            {/* Neutral themes are listed first (CORE_THEMES object order). */}
            <p className="px-1 text-[13px] text-text-muted">
              {t("settings.appearanceSection.neutralHint")}
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {coreList.map((theme) => (
                <ThemeCard
                  key={theme.id}
                  theme={theme}
                  isActive={theme.id === activeThemeId}
                  onApply={() => setActiveTheme(theme.id)}
                />
              ))}
            </div>
          </div>

          {communityList.length > 0 && (
            <div className="space-y-2">
              <SectionCaption className="px-1">
                {t("settings.appearanceSection.installedThemes")}
              </SectionCaption>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {communityList.map((theme) => (
                  <ThemeCard
                    key={theme.id}
                    theme={theme}
                    isActive={theme.id === activeThemeId}
                    onApply={() => setActiveTheme(theme.id)}
                    onUninstall={() => uninstallTheme(theme.id)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </SettingsSection>

      {browseOpen && (
        <BrowseCommunityModal mode="themes" onClose={() => setBrowseOpen(false)} />
      )}

      <SettingsSection title={t("settings.appearanceSection.library.heading")}>
        <SettingRow
          label={t("settings.appearanceSection.library.coverSize", {
            value: cardSize,
          })}
          hint={t("settings.appearanceSection.library.coverSizeHelp")}
          stacked
        >
          <SliderWithInput
            value={cardSize}
            onChange={setCardSize}
            min={140}
            max={320}
            step={10}
            unit="px"
            ariaLabel={t("settings.appearanceSection.library.coverSizeHelp")}
          />
        </SettingRow>
      </SettingsSection>

      {/* Custom CSS: power-user escape hatch. Rules go into a
          single <style> tag in <head> on every page load. Tailwind
          utility classes are stable selectors; the CSS variables
          on :root (--accent, --bg-primary, …) are the
          friendlier surface to override. Stored to localStorage
          per-device. */}
      <SettingsSection title={t("settings.appearanceSection.customCss.heading")}>
        <SettingRow
          label={t("settings.appearanceSection.customCss.heading")}
          hint={t("settings.appearanceSection.customCss.help")}
          control={
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCssReset}
              disabled={customCss.length === 0}
            >
              {t("settings.appearanceSection.customCss.reset")}
            </Button>
          }
        >
          <textarea
            value={customCss}
            onChange={(e) => handleCssChange(e.target.value)}
            placeholder={t("settings.appearanceSection.customCss.placeholder")}
            spellCheck={false}
            className="field block min-h-[140px] resize-y bg-bg-secondary p-3 font-mono text-xs"
          />
        </SettingRow>
      </SettingsSection>
    </section>
  );
}
