import type { Theme } from "./types";

/**
 * Built-in themes. `pnyxy-dark` reproduces the current `@theme` block
 * verbatim — switching to it is a no-op visually, but it lets us treat
 * themes uniformly in the registry.
 *
 * To add a core theme: add a new entry here. It immediately appears in
 * Settings → Appearance.
 */
export const CORE_THEMES = {
  "pnyxy-dark": {
    id: "pnyxy-dark",
    name: "Pnyxy Dark",
    description: "The default dark theme.",
    author: "Pnyxy",
    apiVersion: 1,
    variant: "dark",
    tokens: {
      "--color-bg-primary": "#0a0a0f",
      "--color-bg-secondary": "#111118",
      "--color-bg-tertiary": "#1a1a24",
      "--color-accent-purple": "#8b5cf6",
      "--color-accent-blue": "#3b82f6",
      "--color-text-primary": "#f0f0f5",
      "--color-text-secondary": "#a0a0b0",
      "--color-text-muted": "#6b6b80",
      "--color-glass-bg": "rgba(255, 255, 255, 0.05)",
      "--color-glass-border": "rgba(255, 255, 255, 0.1)",
      "--color-glass-hover": "rgba(255, 255, 255, 0.08)",
    },
  },
  "pnyxy-light": {
    id: "pnyxy-light",
    name: "Pnyxy Light",
    description: "A warm, parchment-leaning light theme.",
    author: "Pnyxy",
    apiVersion: 1,
    variant: "light",
    tokens: {
      "--color-bg-primary": "#f7f5f0",
      "--color-bg-secondary": "#ffffff",
      "--color-bg-tertiary": "#ece8df",
      "--color-accent-purple": "#7c3aed",
      "--color-accent-blue": "#2563eb",
      "--color-text-primary": "#1c1b22",
      "--color-text-secondary": "#4a4956",
      "--color-text-muted": "#7a7888",
      "--color-glass-bg": "rgba(0, 0, 0, 0.04)",
      "--color-glass-border": "rgba(0, 0, 0, 0.1)",
      "--color-glass-hover": "rgba(0, 0, 0, 0.06)",
    },
  },
  midnight: {
    id: "midnight",
    name: "Midnight",
    description: "Deep navy with cyan accents.",
    author: "Pnyxy",
    apiVersion: 1,
    variant: "dark",
    tokens: {
      "--color-bg-primary": "#06091a",
      "--color-bg-secondary": "#0c1228",
      "--color-bg-tertiary": "#141d3a",
      "--color-accent-purple": "#22d3ee",
      "--color-accent-blue": "#60a5fa",
      "--color-text-primary": "#eaf2ff",
      "--color-text-secondary": "#9aa9c9",
      "--color-text-muted": "#5e6c8a",
      "--color-glass-bg": "rgba(120, 170, 255, 0.06)",
      "--color-glass-border": "rgba(120, 170, 255, 0.14)",
      "--color-glass-hover": "rgba(120, 170, 255, 0.1)",
    },
  },
} as const satisfies Record<string, Theme>;

export type CoreThemeId = keyof typeof CORE_THEMES;

export const DEFAULT_THEME_ID: CoreThemeId = "pnyxy-dark";
