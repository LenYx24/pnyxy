/**
 * Pure-logic tests for the toggle tracker. It has no state of its
 * own, every decision is a function of the `TrackerContext` + the
 * event args.
 */
import { describe, expect, it } from "vitest";
import { toggleTracker, type ToggleTrackerSettings } from "./toggle-tracker";
import type { TrackerContext } from "./types";

function ctx(
  overrides: Partial<TrackerContext> & {
    settings?: ToggleTrackerSettings;
  } = {},
): TrackerContext {
  return {
    currentProgress: 0,
    totalPages: 100,
    settings: (overrides.settings ?? { enabled: true }) as unknown as Record<
      string,
      unknown
    >,
    ...overrides,
  };
}

describe("toggleTracker — metadata", () => {
  it("has the expected id and default settings", () => {
    expect(toggleTracker.id).toBe("toggle");
    expect(toggleTracker.defaultSettings).toEqual({ enabled: true });
  });

  it("has a human-readable name and description", () => {
    expect(typeof toggleTracker.name).toBe("string");
    expect(toggleTracker.name.length).toBeGreaterThan(0);
    expect(typeof toggleTracker.description).toBe("string");
  });
});

describe("toggleTracker.onPageChange", () => {
  it("returns the new page when it is ahead of currentProgress and tracker is enabled", () => {
    const result = toggleTracker.onPageChange?.(
      ctx({ currentProgress: 3 }),
      3,
      5,
    );
    expect(result).toBe(5);
  });

  it("never moves progress backwards", () => {
    const result = toggleTracker.onPageChange?.(
      ctx({ currentProgress: 10 }),
      10,
      4,
    );
    expect(result).toBe(10);
  });

  it("keeps progress when the new page equals currentProgress", () => {
    const result = toggleTracker.onPageChange?.(
      ctx({ currentProgress: 7 }),
      7,
      7,
    );
    expect(result).toBe(7);
  });

  it("returns undefined when disabled, regardless of direction", () => {
    const disabled = ctx({
      currentProgress: 1,
      settings: { enabled: false },
    });
    expect(toggleTracker.onPageChange?.(disabled, 1, 5)).toBeUndefined();
    expect(toggleTracker.onPageChange?.(disabled, 5, 1)).toBeUndefined();
  });
});

describe("toggleTracker.onManualSet", () => {
  it("always returns the requested page", () => {
    expect(
      toggleTracker.onManualSet?.(ctx({ currentProgress: 50 }), 10),
    ).toBe(10);
    expect(
      toggleTracker.onManualSet?.(ctx({ currentProgress: 2 }), 80),
    ).toBe(80);
  });

  it("works even when tracking is disabled (manual override)", () => {
    const disabled = ctx({
      currentProgress: 50,
      settings: { enabled: false },
    });
    expect(toggleTracker.onManualSet?.(disabled, 10)).toBe(10);
  });
});
