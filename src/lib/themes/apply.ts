import type { Theme, ThemeTokenKey, ThemeTokens } from "./types";

/**
 * Every token a theme is allowed to set. Used by `resetTheme()` to
 * remove inline overrides cleanly so the `@theme` defaults take over
 * again, and as the allowlist that `sanitizeThemeTokens()` checks
 * keys against before anything reaches `CSSStyleDeclaration.setProperty`.
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

const ALLOWED_TOKEN_KEYS = new Set<string>(ALL_TOKEN_KEYS);

/**
 * Values that could smuggle behaviour through a CSS custom property:
 * remote resource loads (`url(`, `image-set(`), stylesheet imports
 * (`@import`), the legacy IE `expression()` script sink, CSS escape
 * sequences (backslash), and `<` (no legitimate token value needs it,
 * and it forecloses any markup-sniffing edge case in a consumer that
 * mishandles the value). Case-insensitive since CSS function/at-rule
 * names aren't case sensitive.
 */
const UNSAFE_TOKEN_VALUE = /url\(|image-set\(|@import|expression\(|\\|</i;

/** A theme may only set a token that's in the known allowlist and
 * whose key looks like a custom property (defense in depth against a
 * manifest that smuggles a non-`--` key through `Object.entries`). */
export function isAllowedThemeTokenKey(key: string): key is ThemeTokenKey {
  return key.startsWith("--") && ALLOWED_TOKEN_KEYS.has(key);
}

/** A token value is safe to hand to `setProperty` when it doesn't
 * contain any of the sinks in `UNSAFE_TOKEN_VALUE`. */
export function isSafeThemeTokenValue(value: string): boolean {
  return typeof value === "string" && !UNSAFE_TOKEN_VALUE.test(value);
}

/**
 * Strip any token whose key isn't on the allowlist or whose value
 * trips the unsafe-value check. Used both when a community theme is
 * installed from the registry (so bad data never enters storage) and
 * again at apply time (defense in depth against tampered storage or a
 * bundled/core theme regression).
 */
export function sanitizeThemeTokens(tokens: ThemeTokens): ThemeTokens {
  const out: ThemeTokens = {};
  for (const [key, value] of Object.entries(tokens)) {
    if (typeof value !== "string") continue;
    if (!isAllowedThemeTokenKey(key)) continue;
    if (!isSafeThemeTokenValue(value)) continue;
    out[key] = value;
  }
  return out;
}

/** Sanitize every token on a theme, returning a new `Theme` object. */
export function sanitizeTheme(theme: Theme): Theme {
  return { ...theme, tokens: sanitizeThemeTokens(theme.tokens) };
}

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

/** Tokens the most recent `applyTheme()` call actually set, so
 * `resetTheme()` can remove exactly those (and nothing it never
 * touched, nothing it forgot). */
const appliedTokenKeys = new Set<ThemeTokenKey>();

/**
 * Set every (allowlisted, value-safe) token from `theme.tokens` on
 * `document.documentElement`. A theme can come from an untrusted
 * source (a community registry entry, or storage someone tampered
 * with) so every key/value pair is re-validated here even though
 * `sanitizeTheme()` is also applied at install time.
 */
export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  // Clear everything the previous applyTheme() set first, so a switch
  // from a theme that overrode N tokens to one that overrides M < N
  // tokens doesn't leave stragglers.
  resetTheme();
  const safeTheme = sanitizeTheme(theme);
  const tokens = { ...derivedTokens(safeTheme), ...safeTheme.tokens };
  for (const [key, value] of Object.entries(tokens)) {
    if (typeof value !== "string") continue;
    if (!isAllowedThemeTokenKey(key) || !isSafeThemeTokenValue(value)) continue;
    root.style.setProperty(key, value);
    appliedTokenKeys.add(key);
  }
  root.dataset.theme = theme.id;
  if (theme.variant) {
    root.dataset.themeVariant = theme.variant;
  } else {
    delete root.dataset.themeVariant;
  }
}

/** Remove every token the last `applyTheme()` set so @theme defaults apply. */
export function resetTheme(): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const key of appliedTokenKeys) {
    root.style.removeProperty(key);
  }
  appliedTokenKeys.clear();
}
