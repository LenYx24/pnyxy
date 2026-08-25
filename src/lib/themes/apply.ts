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
  "--color-surface-3",
  "--color-accent",
  "--color-accent-blue",
  "--color-accent-soft",
  "--color-streak",
  "--color-text-primary",
  "--color-text-secondary",
  "--color-text-muted",
  "--color-text-muted-2",
  "--color-glass-bg",
  "--color-glass-border",
  "--color-glass-hover",
  "--shadow-page",
  "--font-sans",
];

/**
 * Tokens introduced with the Neutral language (UI v2). Older core
 * themes and community themes only know the v1 set, so when a theme
 * doesn't set one of these we derive it from the tokens it does set
 * instead of letting the Neutral @theme default bleed through (a
 * #2a2a2f hover step on a navy Midnight surface would look wrong).
 */
function derivedTokens(theme: Theme): Partial<Record<ThemeTokenKey, string>> {
  const t = theme.tokens;
  const out: Partial<Record<ThemeTokenKey, string>> = {};
  if (!t["--color-surface-3"] && t["--color-bg-tertiary"]) {
    out["--color-surface-3"] =
      `color-mix(in srgb, ${t["--color-bg-tertiary"]} 88%, ${t["--color-text-primary"] ?? "#ffffff"})`;
  }
  if (!t["--color-text-muted-2"] && t["--color-text-muted"]) {
    out["--color-text-muted-2"] =
      `color-mix(in srgb, ${t["--color-text-muted"]} 80%, ${t["--color-bg-primary"] ?? "transparent"})`;
  }
  if (!t["--color-accent-soft"] && t["--color-accent"]) {
    out["--color-accent-soft"] =
      `color-mix(in srgb, ${t["--color-accent"]} 14%, transparent)`;
  }
  if (!t["--shadow-page"] && theme.variant === "light") {
    out["--shadow-page"] =
      "0 8px 30px rgba(0, 0, 0, 0.10)";
  }
  return out;
}

/** Set every token from `theme.tokens` on `document.documentElement`. */
export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  // Clear everything first so a switch from a theme that overrode N
  // tokens to one that overrides M < N tokens doesn't leave stragglers.
  resetTheme();
  const tokens = { ...derivedTokens(theme), ...theme.tokens };
  for (const [key, value] of Object.entries(tokens)) {
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
