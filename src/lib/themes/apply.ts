import type { Theme, ThemeTokenKey } from "./types";

/**
 * Every token a theme is allowed to set. Used by `resetTheme()` to
 * remove inline overrides cleanly so the `@theme` defaults take over
 * again.
 */
const ALL_TOKEN_KEYS: ThemeTokenKey[] = [
  "--color-bg-primary",
  "--color-bg-secondary",
  "--color-bg-tertiary",
  "--color-accent-purple",
  "--color-accent-blue",
  "--color-text-primary",
  "--color-text-secondary",
  "--color-text-muted",
  "--color-glass-bg",
  "--color-glass-border",
  "--color-glass-hover",
  "--font-sans",
];

/** Set every token from `theme.tokens` on `document.documentElement`. */
export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  // Clear everything first so a switch from a theme that overrode N
  // tokens to one that overrides M < N tokens doesn't leave stragglers.
  resetTheme();
  for (const [key, value] of Object.entries(theme.tokens)) {
    if (typeof value === "string") {
      root.style.setProperty(key, value);
    }
  }
  root.dataset.theme = theme.id;
  if (theme.variant) {
    root.dataset.themeVariant = theme.variant;
  } else {
    delete root.dataset.themeVariant;
  }
}

/** Remove every theme-managed token so @theme defaults apply. */
export function resetTheme(): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const key of ALL_TOKEN_KEYS) {
    root.style.removeProperty(key);
  }
}
