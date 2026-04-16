/**
 * A reading tracker is a small rule object that decides how the
 * "furthest read page" advances in response to reader events. The
 * store owns the actual page numbers; trackers are stateless and
 * just compute the next value from the current one + an event.
 *
 * To add a new tracker: implement this interface in a new file under
 * `src/lib/reading-trackers/` and add it to the registry in
 * `index.ts`. No store or UI changes are required for the data
 * flow — only when a tracker needs new event types or its own
 * controls UI.
 */
export interface TrackerContext {
  /** Current furthest-read page (`progressPage` in the reader store). */
  currentProgress: number;
  totalPages: number;
  /**
   * Per-tracker settings, sourced from
   * `useSettingsStore.trackerSettings[trackerId]`. Shape is defined
   * by each tracker.
   */
  settings: Record<string, unknown>;
}

export interface ReadingTracker {
  id: string;
  name: string;
  description: string;
  /** Initial values for this tracker's settings. */
  defaultSettings: Record<string, unknown>;

  /**
   * The reader's current page changed (scroll, jump, next/prev).
   * Return the new `progressPage`, or `undefined` to leave it alone.
   */
  onPageChange?(
    ctx: TrackerContext,
    from: number,
    to: number,
  ): number | undefined;

  /**
   * A page has been visible for `durationMs` ms. Used by future
   * dwell-time trackers; current toggle tracker ignores this.
   */
  onPageDwell?(
    ctx: TrackerContext,
    page: number,
    durationMs: number,
  ): number | undefined;

  /** User explicitly clicked "set my progress to this page". */
  onManualSet?(ctx: TrackerContext, page: number): number | undefined;
}
