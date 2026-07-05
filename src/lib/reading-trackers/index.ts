import type { ReadingTracker } from "./types";
import { toggleTracker } from "./toggle-tracker";

/**
 * Registry of available trackers, keyed by id. Add new trackers
 * here, the rest of the app discovers them through this map.
 */
export const TRACKERS = {
  toggle: toggleTracker,
} as const satisfies Record<string, ReadingTracker>;

export type TrackerId = keyof typeof TRACKERS;

export const DEFAULT_TRACKER_ID: TrackerId = "toggle";

/** Look up a tracker by id, falling back to the default if unknown. */
export function getTracker(id: string): ReadingTracker {
  return (TRACKERS as Record<string, ReadingTracker>)[id] ?? toggleTracker;
}

/**
 * Build a `trackerSettings` object populated with every tracker's
 * defaults. Used as the initial value in the settings store and to
 * fill in missing entries after the app adds a new tracker.
 */
export function buildDefaultTrackerSettings(): Record<
  string,
  Record<string, unknown>
> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const tracker of Object.values(TRACKERS) as ReadingTracker[]) {
    out[tracker.id] = { ...tracker.defaultSettings };
  }
  return out;
}

export type { ReadingTracker, TrackerContext } from "./types";
export type { ToggleTrackerSettings } from "./toggle-tracker";
