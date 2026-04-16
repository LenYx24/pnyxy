import { useEffect } from "react";
import { useSettingsStore } from "@/stores/settings-store";
import { applyTheme, getTheme } from "./index";

/**
 * Subscribes to `activeThemeId` + `installedThemes` and applies the
 * resolved theme to `document.documentElement`. Mount once at the
 * app root.
 */
export function useThemeEffect(): void {
  const activeThemeId = useSettingsStore((s) => s.activeThemeId);
  const installedThemes = useSettingsStore((s) => s.installedThemes);

  useEffect(() => {
    const theme = getTheme(activeThemeId, installedThemes);
    applyTheme(theme);
  }, [activeThemeId, installedThemes]);
}
