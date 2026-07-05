import { CORE_THEMES, DEFAULT_THEME_ID } from "./core";
import type { Theme } from "./types";

export { CORE_THEMES, DEFAULT_THEME_ID } from "./core";
export type { CoreThemeId } from "./core";
export { applyTheme, resetTheme } from "./apply";
export type { Theme, ThemeTokens, ThemeTokenKey, ThemeApiVersion } from "./types";

/**
 * Look up a theme by id, searching core themes first then the
 * supplied installed-themes map. Falls back to the default theme so
 * the app always has something to render.
 */
export function getTheme(
  id: string,
  installed: Record<string, Theme> = {},
): Theme {
  return (
    (CORE_THEMES as Record<string, Theme>)[id] ??
    installed[id] ??
    CORE_THEMES[DEFAULT_THEME_ID]
  );
}

/**
 * Initial value for `installedThemes` in the settings store. Empty by
 * default, community themes are added via `installTheme()`. Exists
 * mostly for symmetry with `buildDefaultPluginSettings()` and so the
 * settings migration has a single function to call.
 */
export function buildInstalledThemesDefaults(): Record<string, Theme> {
  return {};
}
