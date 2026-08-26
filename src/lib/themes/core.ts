import type { Theme } from "./types";

/**
 * Built-in themes. `pnyxy-neutral` reproduces the `@theme` block in
 * styles/index.css verbatim; the two Neutral entries come first because
 * Settings > Appearance lists them in object order.
 *
 * To add a core theme: add a new entry here. It immediately appears in
 * Settings → Appearance.
 */
export const CORE_THEMES = {
  "pnyxy-neutral": {
    id: "pnyxy-neutral",
    name: "Pnyxy Neutral",
    description:
      "Neutral desk, content brings the color. No borders, depth from tone steps and one shadow.",
    author: "Pnyxy",
    apiVersion: 1,
    variant: "dark",
    tokens: {
      // desk / surface-1 / surface-2 / surface-3
      "--color-bg-primary": "#131315",
      "--color-bg-secondary": "#1a1a1d",
      "--color-bg-tertiary": "#222226",
      "--color-surface-3": "#2a2a2f",
      "--color-accent": "#5fb3c6",
      "--color-accent-blue": "#5fb3c6",
      "--color-accent-soft": "rgba(95, 179, 198, 0.14)",
      "--color-streak": "#e0a54a",
      "--color-text-primary": "#ececee",
      "--color-text-secondary": "#c9c9cf",
      "--color-text-muted": "#9a9aa3",
      "--color-text-muted-2": "#7d7d86",
      "--color-glass-bg": "rgba(255, 255, 255, 0.04)",
      "--color-glass-border": "rgba(255, 255, 255, 0.04)",
      "--color-glass-hover": "#2a2a2f",
      "--shadow-page":
        "0 8px 30px rgba(0, 0, 0, 0.45)",
    },
  },
  "pnyxy-neutral-light": {
    id: "pnyxy-neutral-light",
    name: "Pnyxy Neutral Light",
    description:
      "The neutral desk in daylight: soft grey desk, white pages, same single accent.",
    author: "Pnyxy",
    apiVersion: 1,
    variant: "light",
    tokens: {
      "--color-bg-primary": "#ececec",
      "--color-bg-secondary": "#f4f4f4",
      "--color-bg-tertiary": "#ffffff",
      "--color-surface-3": "#f0f0f1",
      "--color-accent": "#2f8fa5",
      "--color-accent-blue": "#2f8fa5",
      "--color-accent-soft": "rgba(47, 143, 165, 0.12)",
      "--color-streak": "#e0a54a",
      "--color-text-primary": "#1c1c1e",
      "--color-text-secondary": "#3a3a3f",
      "--color-text-muted": "#5f5f68",
      "--color-text-muted-2": "#767680",
      "--color-glass-bg": "rgba(0, 0, 0, 0.03)",
      "--color-glass-border": "rgba(0, 0, 0, 0.04)",
      "--color-glass-hover": "#e4e4e6",
      "--shadow-page":
        "0 8px 30px rgba(0, 0, 0, 0.10)",
    },
  },
  "pnyxy-neutral-well": {
    id: "pnyxy-neutral-well",
    name: "Pnyxy Neutral Well",
    description:
      "Inverted neutral: lighter chrome as the frame, darker content area as the stage (the Gemini arrangement).",
    author: "Pnyxy",
    apiVersion: 1,
    variant: "dark",
    tokens: {
      // desk (rail, panels) is the lighter step; the sheet is the dark well
      "--color-bg-primary": "#1c1c1f",
      "--color-bg-secondary": "#121214",
      "--color-bg-tertiary": "#242428",
      "--color-surface-3": "#2d2d32",
      "--color-accent": "#5fb3c6",
      "--color-accent-blue": "#5fb3c6",
      "--color-accent-soft": "rgba(95, 179, 198, 0.14)",
      "--color-streak": "#e0a54a",
      "--color-text-primary": "#ececee",
      "--color-text-secondary": "#c9c9cf",
      "--color-text-muted": "#9a9aa3",
      "--color-text-muted-2": "#7d7d86",
      "--color-glass-bg": "rgba(255, 255, 255, 0.04)",
      "--color-glass-border": "rgba(255, 255, 255, 0.04)",
      "--color-glass-hover": "#2d2d32",
      // a well does not lift; a faint edge shadow keeps the corner readable
      "--shadow-page": "0 0 0 1px rgba(0, 0, 0, 0.35)",
    },
  },
  "pnyxy-neutral-well-high-contrast": {
    id: "pnyxy-neutral-well-high-contrast",
    name: "Pnyxy Well High Contrast",
    description:
      "The inverted (Well) arrangement with near-white text at every level.",
    author: "Pnyxy",
    apiVersion: 1,
    variant: "dark",
    tokens: {
      "--color-bg-primary": "#1c1c1f",
      "--color-bg-secondary": "#121214",
      "--color-bg-tertiary": "#242428",
      "--color-surface-3": "#313137",
      "--color-accent": "#7cc7d8",
      "--color-accent-blue": "#7cc7d8",
      "--color-accent-soft": "rgba(124, 199, 216, 0.18)",
      "--color-streak": "#eab662",
      "--color-text-primary": "#ffffff",
      "--color-text-secondary": "#eeeef1",
      "--color-text-muted": "#c8c8d0",
      "--color-text-muted-2": "#ababb5",
      "--color-glass-bg": "rgba(255, 255, 255, 0.06)",
      "--color-glass-border": "rgba(255, 255, 255, 0.08)",
      "--color-glass-hover": "#313137",
      "--shadow-page": "0 0 0 1px rgba(0, 0, 0, 0.35)",
    },
  },
  "pnyxy-dark": {
    id: "pnyxy-dark",
    name: "Pnyxy Dark",
    description: "Neutral deep-black background with cool cyan accents.",
    author: "Pnyxy",
    apiVersion: 1,
    variant: "dark",
    tokens: {
      // Backgrounds: the original Pnyxy Dark, neutral near-black.
      "--color-bg-primary": "#0a0a0f",
      "--color-bg-secondary": "#111118",
      "--color-bg-tertiary": "#1a1a24",
      // Accents + text: picked up from Midnight so the default no
      // longer reads as "default Tailwind purple". Cyan/icy palette
      // over a neutral dark surface. Accent is darker than Midnight's
      // to stay legible with white text on top (≥4.5:1 contrast).
      "--color-accent": "#0891b2",
      "--color-accent-blue": "#60a5fa",
      // Text contrast retuned 2026-05 (secondary #9aa9c9→#c8d3ee,
      // muted #5e6c8a→#9da9c8 to clear WCAG AA), then lifted again
      // 2026-06 for crisper hierarchy/readability: secondary
      // #c8d3ee→#d8e1f5 (~12:1) and muted #9da9c8→#b0bbd8 (~7:1).
      // Hierarchy now leans on weight/size too, not brightness alone.
      // Keep in sync with @theme defaults in styles/index.css. The
      // high-contrast variant (pnyxy-dark-high-contrast) is there for
      // users who want even more headroom.
      "--color-text-primary": "#eaf2ff",
      "--color-text-secondary": "#d8e1f5",
      "--color-text-muted": "#b0bbd8",
      // Glass stays neutral (no blue tint) so it sits naturally on
      // the true-black background.
      "--color-glass-bg": "rgba(255, 255, 255, 0.05)",
      "--color-glass-border": "rgba(255, 255, 255, 0.1)",
      "--color-glass-hover": "rgba(255, 255, 255, 0.08)",
    },
  },
  // id kept from the old Pnyxy Dark based variant so stored selections
  // upgrade in place; the look is now Neutral geometry with near-white
  // text everywhere (the Gemini approach: hierarchy from size/weight,
  // not from dimming, secondary ~15:1, muted ~10:1 on the sheet).
  "pnyxy-dark-high-contrast": {
    id: "pnyxy-dark-high-contrast",
    name: "Pnyxy High Contrast",
    description:
      "The neutral desk with near-white text at every level, for bright rooms and maximum legibility.",
    author: "Pnyxy",
    apiVersion: 1,
    variant: "dark",
    tokens: {
      "--color-bg-primary": "#131315",
      "--color-bg-secondary": "#1a1a1d",
      "--color-bg-tertiary": "#232327",
      "--color-surface-3": "#303036",
      "--color-accent": "#7cc7d8",
      "--color-accent-blue": "#7cc7d8",
      "--color-accent-soft": "rgba(124, 199, 216, 0.18)",
      "--color-streak": "#eab662",
      "--color-text-primary": "#ffffff",
      "--color-text-secondary": "#eeeef1",
      "--color-text-muted": "#c8c8d0",
      "--color-text-muted-2": "#ababb5",
      "--color-glass-bg": "rgba(255, 255, 255, 0.06)",
      "--color-glass-border": "rgba(255, 255, 255, 0.08)",
      "--color-glass-hover": "#303036",
      "--shadow-page": "0 8px 30px rgba(0, 0, 0, 0.45)",
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
      "--color-accent": "#7c3aed",
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
      "Warm parchment background with dark sepia text, low contrast and no pure white, designed for long reading sessions.",
    author: "Pnyxy",
    apiVersion: 1,
    variant: "light",
    tokens: {
      // Paper-like background with no pure white anywhere.
      "--color-bg-primary": "#f4ecd8",
      "--color-bg-secondary": "#ebe2cc",
      "--color-bg-tertiary": "#d8cdb3",
      // Warm-amber accent so links/buttons sit naturally on parchment.
      "--color-accent": "#a85a1f",
      "--color-accent-blue": "#7c5b2a",
      // Dark sepia text instead of black, lowers contrast just enough
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
      "Warm amber-tinted dark theme with no blue spectrum, evening-friendly, candlelight feel.",
    author: "Pnyxy",
    apiVersion: 1,
    variant: "dark",
    tokens: {
      // Very dark warm brown instead of cool black, fewer short-
      // wavelength photons, easier on circadian rhythm at night.
      "--color-bg-primary": "#1a120a",
      "--color-bg-secondary": "#251a10",
      "--color-bg-tertiary": "#322415",
      // Amber + warm gold accents; deliberately no blue.
      "--color-accent": "#d4923a",
      "--color-accent-blue": "#e8b663",
      // Warm cream text, soft on dark warm bg.
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
      "--color-accent": "#22d3ee",
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
      "--color-accent": "#ff6b9d",
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
      "--color-accent": "#64ffda",
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
      "--color-accent": "#e0916f",
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
      "--color-accent": "#ff8b3d",
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

/**
 * Default for new installs. Existing users keep whatever `activeThemeId`
 * the settings store persisted; the store never overwrites a stored id.
 */
export const DEFAULT_THEME_ID: CoreThemeId = "pnyxy-neutral";
