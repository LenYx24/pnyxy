/**
 * Stateless rule that decides how the furthest-read page advances from reader
 * events. The store owns the page numbers. Register new trackers in index.ts.
 */
export interface TrackerContext {
  /** Furthest-read page (progressPage in the reader store). */
  currentProgress: number;
  totalPages: number;
  /** Per-tracker settings from useSettingsStore.trackerSettings[trackerId]. */
  settings: Record<string, unknown>;
}

export interface ReadingTracker {
  id: string;
  name: string;
  description: string;
  defaultSettings: Record<string, unknown>;

  /** Page changed. Return new progressPage, or undefined to leave it alone. */
  onPageChange?(
    ctx: TrackerContext,
    from: number,
    to: number,
  ): number | undefined;

  /** Page visible for durationMs. For dwell-time trackers. */
  onPageDwell?(
    ctx: TrackerContext,
    page: number,
    durationMs: number,
  ): number | undefined;

  onManualSet?(ctx: TrackerContext, page: number): number | undefined;
}
