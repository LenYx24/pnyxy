// Roadmap = a DAG of learning materials.

export type RoadmapId = string;
export type NodeId = string;
export type EdgeId = string;
export type EnrollmentId = string;

export type NodeType =
  | "text" // Free-form learning unit
  | "url" // Generic external link with og: preview (Phase 2)
  | "youtube" // YouTube video (Phase 2)
  | "khan-academy" // Khan Academy lesson (Phase 2)
  | "pnyxy-book" // Library book (Phase 2)
  | "pnyxy-quiz" // Internal quiz (Phase 2)
  | "pnyxy-chapter"; // Chapter range from a book (Phase 2)

// AI-cited or user-added resource for a node. match status drives the UI.
export interface ResourceRef {
  kind: "book" | "url" | "youtube" | "other";
  title: string;
  author?: string;
  /** Concrete page numbers. Required for auto-progress (maps book_resume_state.page to 0-100%). */
  pageRange?: { from: number; to: number };
  /** Chapter/section label instead of page numbers. No auto-progress. */
  section?: string;
  url?: string;
  /**
   * Filled by roadmap-resource-lookup post-generation.
   *   - library: user PDF; bookId = books.id, docId = adapter id (file_hash).
   *   - catalog: catalog book; both ids = catalog UUID.
   *   - none: book not available, grey info-only.
   *   - pending: lookup hasn't run yet.
   */
  match?:
    | { source: "library"; bookId: string; docId: string }
    | { source: "catalog"; bookId: string; docId: string }
    | { source: "none" }
    | { source: "pending" };
}

export interface RoadmapNode {
  id: NodeId;
  type: NodeType;
  title: string;
  description: string;
  /** User's estimate of effort. Drives the post-enrollment scheduler. */
  estimatedMinutes: number;
  /** Type-specific payload, kept loose. payload.references holds AI-cited materials. */
  payload?: Record<string, unknown> & { references?: ResourceRef[] };
  /** Manual layout position. Default is dagre auto-layout; set once a node is dragged. */
  position?: { x: number; y: number };
}

export interface RoadmapEdge {
  id: EdgeId;
  source: NodeId;
  target: NodeId;
}

export type Visibility = "private" | "unlisted" | "public-listed" | "space-only";

export interface Roadmap {
  id: RoadmapId;
  title: string;
  description: string;
  /** UUID of the user who owns this roadmap. Null for templates. */
  ownerUserId: string | null;
  /** Spaces/schools (Phase 3). Always null for now. */
  ownerSpaceId: string | null;
  visibility: Visibility;
  nodes: RoadmapNode[];
  edges: RoadmapEdge[];
  createdAt: number;
  updatedAt: number;
}

/** Schedule preferences. The scheduler projects target dates onto each node from these. */
export interface SchedulePrefs {
  /** Hours per Mon-Fri. Fractional allowed (e.g. 0.5 = 30 min). */
  weekdayHours: number;
  /** Hours per Sat-Sun. Ignored when workOnWeekends is false. */
  weekendHours: number;
  workOnWeekends: boolean;
  /** Per-node date pins (YYYY-MM-DD, timezone-stable). Override the computed date. */
  nodeDateOverrides: Record<NodeId, string>;
  /**
   * Deadline-mode multiplier: weekendHours = weekdayHours * weekendMultiplier.
   * 0 = no weekend study. Only meaningful with a targetEndDate set. Unset = manual mode.
   */
  weekendMultiplier?: number;
}

export interface Enrollment {
  id: EnrollmentId;
  roadmapId: RoadmapId;
  userId: string | null;
  /** ISO date (YYYY-MM-DD) when the user enrolled. */
  startDate: string;
  /** Finish-by date (YYYY-MM-DD). When set, the deadline UI derives weekday/weekend hours from it. */
  targetEndDate?: string;
  /**
   * 0-100 manual progress per node. Auto-detected book-reading progress is
   * composited at render time (display = max(manual, auto)).
   */
  nodeProgress: Record<NodeId, number>;
  schedulePrefs: SchedulePrefs;
  createdAt: number;
  updatedAt: number;
}

export const DEFAULT_SCHEDULE_PREFS: SchedulePrefs = {
  weekdayHours: 1,
  weekendHours: 2,
  workOnWeekends: false,
  nodeDateOverrides: {},
};
