/**
 * Shared class strings for the Pnyxy Neutral form controls. The CSS
 * lives in styles/index.css (`.field`, `.chip`); these constants exist
 * so TS call sites can compose them with `cn()` without retyping the
 * class names. Never use native browser styling for inputs.
 */

/** Text input / select / textarea: surface-2 fill, no border, 12 px
 *  radius, focus = one tone step up + 2 px accent-soft ring. */
export const fieldClass = "field";

/** Compact variant for toolbars and dense rows. */
export const fieldSmClass = "field px-2.5 py-1.5 text-xs";

/** Pill chip, 999 radius, surface-2 fill. */
export const chipClass = "chip";
export const chipActiveClass = "chip chip-active";
export const chipAccentClass = "chip chip-accent";

/** Segmented control: the group is a surface-2 pill, the active item
 *  a surface-3 pill inside it. */
export const segmentedGroupClass =
  "inline-flex items-center gap-0.5 rounded-control bg-bg-tertiary p-0.5";
export const segmentedItemClass =
  "rounded-[10px] px-3 py-1.5 text-xs font-medium text-text-muted transition-colors hover:text-text-primary cursor-pointer";
export const segmentedItemActiveClass =
  "bg-surface-3 text-text-primary";

/** Modal sheet: 24 px radius, surface-2, the one shadow, no border. */
export const modalSurfaceClass = "rounded-page bg-bg-tertiary shadow-page";
export const modalBackdropClass = "bg-black/50";
