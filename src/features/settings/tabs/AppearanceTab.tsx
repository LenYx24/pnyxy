import { useState } from "react";
import { Palette, Plus } from "lucide-react";
import { useSettingsStore } from "@/stores/settings-store";
import { CORE_THEMES } from "@/lib/themes";
import type { Theme } from "@/lib/themes";
import { ThemeCard } from "../ThemeCard";
import { BrowseCommunityModal } from "../BrowseCommunityModal";

export function AppearanceTab() {
  const activeThemeId = useSettingsStore((s) => s.activeThemeId);
  const installedThemes = useSettingsStore((s) => s.installedThemes);
  const setActiveTheme = useSettingsStore((s) => s.setActiveTheme);
  const uninstallTheme = useSettingsStore((s) => s.uninstallTheme);

  const [browseOpen, setBrowseOpen] = useState(false);

  // Core themes always shown first; community themes after.
  const coreList = Object.values(CORE_THEMES) as Theme[];
  const communityList = Object.values(installedThemes).filter(
    (t) => !(t.id in CORE_THEMES),
  );

  return (
    <section className="space-y-4 rounded-xl border border-glass-border bg-glass-bg/50 p-4 sm:p-6">
      <div className="flex items-center gap-2">
        <Palette size={18} className="text-accent-purple" />
        <h2 className="text-lg font-semibold text-text-primary">Appearance</h2>
      </div>
      <p className="text-xs text-text-muted">
        Pick a theme. Custom themes can be installed from the community
        registry; switching is instant and persists across sessions.
      </p>

      <div>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">
          Core themes
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
            Installed themes
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
          Browse community themes
        </button>
      </div>

      {browseOpen && (
        <BrowseCommunityModal mode="themes" onClose={() => setBrowseOpen(false)} />
      )}
    </section>
  );
}
