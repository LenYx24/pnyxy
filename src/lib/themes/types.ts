/**
 * A theme is pure data: a map of CSS custom properties applied to
 * `document.documentElement`. The Tailwind v4 `@theme` block in
 * `src/styles/index.css` defines the defaults; a theme overrides any
 * subset of those tokens at runtime via `applyTheme()`.
 *
 * To add a new core theme: implement `Theme` in a new file under
 * `src/lib/themes/` and register it in `core.ts`. No Tailwind recompile
 * is needed — applying a theme is a single pass of `setProperty`.
 */

export type ThemeApiVersion = 1;

/**
 * Every CSS custom property that themes are allowed to override.
 * Mirrors the tokens declared in `src/styles/index.css` `@theme`.
 *
 * Keep this union in sync with the `@theme` block. Adding a token
 * here that doesn't exist in CSS is harmless (just sets a custom
 * property nothing reads); leaving one out means themes can't
 * override it.
 */
export type ThemeTokenKey =
  // Background colors
  | "--color-bg-primary"
  | "--color-bg-secondary"
  | "--color-bg-tertiary"
  // Accent colors
  | "--color-accent"
  | "--color-accent-blue"
  // Text colors
  | "--color-text-primary"
  | "--color-text-secondary"
  | "--color-text-muted"
  // Glass/border
  | "--color-glass-bg"
  | "--color-glass-border"
  | "--color-glass-hover"
  // Font
  | "--font-sans";

export type ThemeTokens = Partial<Record<ThemeTokenKey, string>>;

export interface Theme {
  id: string;
  name: string;
  description?: string;
  author?: string;
  /** Theme manifest API version. Currently always `1`. */
  apiVersion: ThemeApiVersion;
  /**
   * UI hint: which palette family this theme belongs to. Useful for
   * grouping in the Appearance grid; not enforced.
   */
  variant?: "dark" | "light" | "auto";
  /** Token overrides. Anything omitted falls through to the @theme defaults. */
  tokens: ThemeTokens;
}
