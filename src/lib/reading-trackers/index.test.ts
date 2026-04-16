/**
 * Registry helpers: getTracker and buildDefaultTrackerSettings.
 */
import { describe, expect, it } from "vitest";
import {
  buildDefaultTrackerSettings,
  DEFAULT_TRACKER_ID,
  getTracker,
  TRACKERS,
} from "./index";
import { toggleTracker } from "./toggle-tracker";

describe("TRACKERS / DEFAULT_TRACKER_ID", () => {
  it("exposes 'toggle' as the default tracker id", () => {
    expect(DEFAULT_TRACKER_ID).toBe("toggle");
    expect(TRACKERS[DEFAULT_TRACKER_ID]).toBe(toggleTracker);
  });
});

describe("getTracker", () => {
  it("returns the requested tracker when its id is registered", () => {
    expect(getTracker("toggle")).toBe(toggleTracker);
  });

  it("falls back to the toggle tracker for an unknown id", () => {
    expect(getTracker("nonexistent")).toBe(toggleTracker);
  });

  it("falls back to the toggle tracker for an empty string", () => {
    expect(getTracker("")).toBe(toggleTracker);
  });
});

describe("buildDefaultTrackerSettings", () => {
  it("returns one entry per registered tracker", () => {
    const out = buildDefaultTrackerSettings();
    expect(Object.keys(out)).toEqual(Object.keys(TRACKERS));
  });

  it("populates each entry with that tracker's defaultSettings", () => {
    const out = buildDefaultTrackerSettings();
    expect(out.toggle).toEqual(toggleTracker.defaultSettings);
  });

  it("returns a fresh shallow copy of each defaultSettings object", () => {
    const out = buildDefaultTrackerSettings();
    expect(out.toggle).not.toBe(toggleTracker.defaultSettings);
    // Mutating the output must not leak back into the tracker.
    (out.toggle as { enabled: boolean }).enabled = false;
    expect(
      (toggleTracker.defaultSettings as { enabled: boolean }).enabled,
    ).toBe(true);
  });
});
