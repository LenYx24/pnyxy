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
    description: "Neutral deep-black background with cool cyan accents.",
    author: "Pnyxy",
    apiVersion: 1,
    variant: "dark",
    tokens: {
      // Backgrounds: the original Pnyxy Dark — neutral near-black.
      "--color-bg-primary": "#0a0a0f",
      "--color-bg-secondary": "#111118",
      "--color-bg-tertiary": "#1a1a24",
      // Accents + text: picked up from Midnight so the default no
      // longer reads as "default Tailwind purple". Cyan/icy palette
      // over a neutral dark surface. Accent is darker than Midnight's
      // to stay legible with white text on top (≥4.5:1 contrast).
      "--color-accent-purple": "#0891b2",
      "--color-accent-blue": "#60a5fa",
      "--color-text-primary": "#eaf2ff",
      "--color-text-secondary": "#9aa9c9",
      "--color-text-muted": "#5e6c8a",
      // Glass stays neutral (no blue tint) so it sits naturally on
      // the true-black background.
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
  "nebula-dust": {
    id: "nebula-dust",
    name: "Nebula Dust",
    description: "Warm cosmic plum with nebula pink and star amber accents.",
    author: "Pnyxy",
    apiVersion: 1,
    variant: "dark",
    tokens: {
      "--color-bg-primary": "#0c0814",
      "--color-bg-secondary": "#161122",
      "--color-bg-tertiary": "#241b36",
      "--color-accent-purple": "#ff6b9d",
      "--color-accent-blue": "#ffc857",
      "--color-text-primary": "#faf0f2",
      "--color-text-secondary": "#b8a0ad",
      "--color-text-muted": "#7a6678",
      "--color-glass-bg": "rgba(255, 170, 200, 0.05)",
      "--color-glass-border": "rgba(255, 200, 220, 0.14)",
      "--color-glass-hover": "rgba(255, 180, 210, 0.09)",
    },
  },
  bioluminescent: {
    id: "bioluminescent",
    name: "Bioluminescent",
    description: "Inky void with jellyfish teal and soft cosmic lavender.",
    author: "Pnyxy",
    apiVersion: 1,
    variant: "dark",
    tokens: {
      "--color-bg-primary": "#040712",
      "--color-bg-secondary": "#0c1328",
      "--color-bg-tertiary": "#17243f",
      "--color-accent-purple": "#64ffda",
      "--color-accent-blue": "#b5a6ff",
      "--color-text-primary": "#e6fbf3",
      "--color-text-secondary": "#8fa8bc",
      "--color-text-muted": "#54657a",
      "--color-glass-bg": "rgba(100, 255, 218, 0.05)",
      "--color-glass-border": "rgba(100, 255, 218, 0.13)",
      "--color-glass-hover": "rgba(100, 255, 218, 0.08)",
    },
  },
  "copper-moon": {
    id: "copper-moon",
    name: "Copper Moon",
    description: "Deep plum with metallic copper and starlight blue.",
    author: "Pnyxy",
    apiVersion: 1,
    variant: "dark",
    tokens: {
      "--color-bg-primary": "#0e0a18",
      "--color-bg-secondary": "#1a152a",
      "--color-bg-tertiary": "#2a2443",
      "--color-accent-purple": "#e0916f",
      "--color-accent-blue": "#91c7e3",
      "--color-text-primary": "#f5ede5",
      "--color-text-secondary": "#b0a598",
      "--color-text-muted": "#746a5d",
      "--color-glass-bg": "rgba(224, 145, 111, 0.05)",
      "--color-glass-border": "rgba(224, 145, 111, 0.13)",
      "--color-glass-hover": "rgba(224, 145, 111, 0.08)",
    },
  },
  "solar-flare": {
    id: "solar-flare",
    name: "Solar Flare",
    description: "Near-black void with solar orange and sunspot amber.",
    author: "Pnyxy",
    apiVersion: 1,
    variant: "dark",
    tokens: {
      "--color-bg-primary": "#100608",
      "--color-bg-secondary": "#1c0c10",
      "--color-bg-tertiary": "#2b1318",
      "--color-accent-purple": "#ff8b3d",
      "--color-accent-blue": "#ffd76b",
      "--color-text-primary": "#fff0e6",
      "--color-text-secondary": "#c4a094",
      "--color-text-muted": "#7a5e54",
      "--color-glass-bg": "rgba(255, 139, 61, 0.05)",
      "--color-glass-border": "rgba(255, 139, 61, 0.13)",
      "--color-glass-hover": "rgba(255, 139, 61, 0.08)",
    },
  },
} as const satisfies Record<string, Theme>;

export type CoreThemeId = keyof typeof CORE_THEMES;

export const DEFAULT_THEME_ID: CoreThemeId = "pnyxy-dark";
