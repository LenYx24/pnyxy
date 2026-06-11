import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Library as LibraryIcon, Palette, Plus, Code2 } from "lucide-react";
import { Slider } from "@/components/ui";
import { useSettingsStore } from "@/stores/settings-store";
import { CORE_THEMES } from "@/lib/themes";
import type { Theme } from "@/lib/themes";
import { ThemeCard } from "../ThemeCard";
import { BrowseCommunityModal } from "../BrowseCommunityModal";
import { useLibraryPrefs } from "@/features/library/useLibraryPrefs";
import { getUserCss, setUserCss } from "@/lib/user-css";

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
  // sees changes immediately — broken CSS rules are silently
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
    <section className="space-y-4 sm:rounded-xl sm:border sm:border-glass-border sm:bg-glass-bg/50 sm:p-6">
      <div className="flex items-center gap-2">
        <Palette size={18} className="text-accent" />
        <h2 className="text-lg font-semibold text-text-primary">
          {t("settings.appearanceSection.heading")}
        </h2>
      </div>
      <p className="text-xs text-text-muted">
        {t("settings.appearanceSection.description")}
      </p>

      <div>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">
          {t("settings.appearanceSection.coreThemes")}
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
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
        <div>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">
            {t("settings.appearanceSection.installedThemes")}
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
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

      <div>
        <button
          type="button"
          onClick={() => setBrowseOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-glass-border bg-glass-bg px-3 py-2 text-sm font-medium text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
        >
          <Plus size={14} />
          {t("settings.appearanceSection.browseCommunity")}
        </button>
      </div>

      {browseOpen && (
        <BrowseCommunityModal mode="themes" onClose={() => setBrowseOpen(false)} />
      )}

      <div className="border-t border-glass-border pt-4">
        <div className="mb-2 flex items-center gap-2">
          <LibraryIcon size={16} className="text-accent" />
          <h3 className="text-sm font-semibold text-text-primary">
            {t("settings.appearanceSection.library.heading")}
          </h3>
        </div>
        <p className="mb-3 text-xs text-text-muted">
          {t("settings.appearanceSection.library.coverSizeHelp")}
        </p>
        <Slider
          value={cardSize}
          onChange={setCardSize}
          min={140}
          max={320}
          step={10}
          label={t("settings.appearanceSection.library.coverSize", {
            value: cardSize,
          })}
        />
      </div>

      {/* Custom CSS — power-user escape hatch. Rules go into a
          single <style> tag in <head> on every page load. Tailwind
          utility classes are stable selectors; the CSS variables
          on :root (--accent, --bg-primary, …) are the
          friendlier surface to override. Stored to localStorage
          per-device. */}
      <div className="border-t border-glass-border pt-4">
        <div className="mb-2 flex items-center gap-2">
          <Code2 size={16} className="text-accent" />
          <h3 className="text-sm font-semibold text-text-primary">
            {t("settings.appearanceSection.customCss.heading")}
          </h3>
        </div>
        <p className="mb-2 text-xs text-text-muted">
          {t("settings.appearanceSection.customCss.help")}
        </p>
        <textarea
          value={customCss}
          onChange={(e) => handleCssChange(e.target.value)}
          placeholder={t("settings.appearanceSection.customCss.placeholder")}
          spellCheck={false}
          className="block min-h-[140px] w-full rounded-lg border border-glass-border bg-bg-secondary p-3 font-mono text-xs text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-accent/50"
        />
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={handleCssReset}
            disabled={customCss.length === 0}
            className="rounded-lg border border-glass-border bg-glass-bg px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
          >
            {t("settings.appearanceSection.customCss.reset")}
          </button>
        </div>
      </div>
    </section>
  );
}
