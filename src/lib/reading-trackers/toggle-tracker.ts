import type { ReadingTracker } from "./types";

export interface ToggleTrackerSettings {
  enabled: boolean;
}

/**
 * Simple on/off tracker:
 *   - When `enabled`, every page change advances `progressPage` (but
 *     only forward, it never decreases).
 *   - When disabled, page changes are ignored, you can browse
 *     freely without affecting your progress.
 *   - "Set as current progress" works regardless of the toggle so
 *     users can always correct the value manually.
 */
export const toggleTracker: ReadingTracker = {
  id: "toggle",
  name: "Toggle",
  description:
    "Advance progress while tracking is on; pause it to browse without affecting your reading position.",
  defaultSettings: { enabled: true } satisfies ToggleTrackerSettings,

  onPageChange(ctx, _from, to) {
    const settings = ctx.settings as unknown as ToggleTrackerSettings;
    if (!settings.enabled) return;
    return Math.max(ctx.currentProgress, to);
  },

  onManualSet(_ctx, page) {
    return page;
  },
};
