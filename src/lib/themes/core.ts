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
      // Text contrast retuned 2026-05: secondary lifted from #9aa9c9
      // to #c8d3ee (~11:1 on bg-primary, was ~7:1) and muted lifted
      // from #5e6c8a to #9da9c8 (~6:1, was ~3:1). The previous muted
      // was failing WCAG AA on bg-tertiary surfaces (LLM bubbles,
      // sidebar metadata). High-contrast variant is available as a
      // separate theme (pnyxy-dark-high-contrast) for users who want
      // even more headroom.
      "--color-text-primary": "#eaf2ff",
      "--color-text-secondary": "#c8d3ee",
      "--color-text-muted": "#9da9c8",
      // Glass stays neutral (no blue tint) so it sits naturally on
      // the true-black background.
      "--color-glass-bg": "rgba(255, 255, 255, 0.05)",
      "--color-glass-border": "rgba(255, 255, 255, 0.1)",
      "--color-glass-hover": "rgba(255, 255, 255, 0.08)",
    },
  },
  "pnyxy-dark-high-contrast": {
    id: "pnyxy-dark-high-contrast",
    name: "Pnyxy Dark — High Contrast",
    description:
      "Pnyxy Dark with maximum text contrast (≥14:1 secondary, ≥8:1 muted) for accessibility and bright environments.",
    author: "Pnyxy",
    apiVersion: 1,
    variant: "dark",
    tokens: {
      "--color-bg-primary": "#0a0a0f",
      "--color-bg-secondary": "#111118",
      "--color-bg-tertiary": "#1a1a24",
      "--color-accent-purple": "#22d3ee",
      "--color-accent-blue": "#93c5fd",
      "--color-text-primary": "#ffffff",
      "--color-text-secondary": "#e0e8f7",
      "--color-text-muted": "#b8c2dc",
      "--color-glass-bg": "rgba(255, 255, 255, 0.07)",
      "--color-glass-border": "rgba(255, 255, 255, 0.18)",
      "--color-glass-hover": "rgba(255, 255, 255, 0.11)",
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
  "comfort-sepia": {
    id: "comfort-sepia",
    name: "Comfort Sepia",
    description:
      "Warm parchment background with dark sepia text — low contrast and no pure white, designed for long reading sessions.",
    author: "Pnyxy",
    apiVersion: 1,
    variant: "light",
    tokens: {
      // Paper-like background with no pure white anywhere.
      "--color-bg-primary": "#f4ecd8",
      "--color-bg-secondary": "#ebe2cc",
      "--color-bg-tertiary": "#d8cdb3",
      // Warm-amber accent so links/buttons sit naturally on parchment.
      "--color-accent-purple": "#a85a1f",
      "--color-accent-blue": "#7c5b2a",
      // Dark sepia text instead of black — lowers contrast just enough
      // to reduce strain without losing legibility (≥7:1 on bg-primary).
      "--color-text-primary": "#3a2e21",
      "--color-text-secondary": "#5c4a36",
      "--color-text-muted": "#8a755e",
      "--color-glass-bg": "rgba(60, 40, 20, 0.05)",
      "--color-glass-border": "rgba(60, 40, 20, 0.14)",
      "--color-glass-hover": "rgba(60, 40, 20, 0.08)",
    },
  },
  "comfort-night": {
    id: "comfort-night",
    name: "Comfort Night",
    description:
      "Warm amber-tinted dark theme with no blue spectrum — evening-friendly, candlelight feel.",
    author: "Pnyxy",
    apiVersion: 1,
    variant: "dark",
    tokens: {
      // Very dark warm brown instead of cool black — fewer short-
      // wavelength photons, easier on circadian rhythm at night.
      "--color-bg-primary": "#1a120a",
      "--color-bg-secondary": "#251a10",
      "--color-bg-tertiary": "#322415",
      // Amber + warm gold accents; deliberately no blue.
      "--color-accent-purple": "#d4923a",
      "--color-accent-blue": "#e8b663",
      // Warm cream text — soft on dark warm bg.
      "--color-text-primary": "#f0e2c8",
      "--color-text-secondary": "#bea886",
      "--color-text-muted": "#806a4f",
      "--color-glass-bg": "rgba(255, 200, 120, 0.05)",
      "--color-glass-border": "rgba(255, 200, 120, 0.14)",
      "--color-glass-hover": "rgba(255, 200, 120, 0.08)",
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
