/**
 * Roadmap = a directed acyclic graph of learning materials.
 *
 * Phase 1 is local-only (IndexedDB). Phase 3 will introduce spaces / orgs;
 * `ownerSpaceId` and `visibility` already live on the type so the storage
 * layer doesn't need a migration when that lands.
 */

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

/**
 * A learning resource the AI cited for a node (or the user added).
 * Books are the primary case — the AI proposes title + author + a
 * page or chapter range, and the client tries to match it against
 * the user's library (uploaded PDFs) and the public catalog. The
 * match status drives the UI: matched → tappable link to the book
 * page, unmatched → grey info-only badge.
 */
export interface ResourceRef {
  kind: "book" | "url" | "youtube" | "other";
  title: string;
  author?: string;
  /** Page-range when the AI gave concrete page numbers. Either this
   *  or `section` is set on PDF-style references; the other side may
   *  be undefined. Auto-progress detection only works when this is
   *  present (mapping `book_resume_state.page` into 0-100%). */
  pageRange?: { from: number; to: number };
  /** Chapter title / section label when the AI gave a human label
   *  rather than page numbers (typical for EPUBs and structured
   *  textbooks). No auto-progress for this form. */
  section?: string;
  /** Free-form URL for kind="url" / "youtube". */
  url?: string;
  /**
   * Populated by the post-generation lookup (`roadmap-resource-lookup`).
   *   - `library`: uploaded user PDF; `bookId` = `books.id` UUID,
   *      `docId` = the reader's adapter id (file_hash) for resume lookup.
   *   - `catalog`: open catalog book; both ids equal the catalog UUID.
   *   - `none`: AI cited a book we don't have. Shown grey, info-only.
   *   - `pending`: lookup hasn't run yet (e.g. first paint after AI
   *      generation, before the post-process completes).
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
  /**
   * Type-specific payload — kept loose for now so Phase 2 can add fields
   * (videoUrl, bookId, chapterRange, etc.) without changing the storage layer.
   *
   * Conventions today:
   *   - `payload.references: ResourceRef[]` — AI-cited learning materials
   *     for this node. Optional; absent = no references.
   */
  payload?: Record<string, unknown> & { references?: ResourceRef[] };
  /**
   * Optional manual layout position. Auto-layout (dagre) is the default;
   * if the user drags a node, we persist its position here.
   */
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
  /** Forward-compat for Phase 3 (spaces/schools). Always null in Phase 1. */
  ownerSpaceId: string | null;
  visibility: Visibility;
  nodes: RoadmapNode[];
  edges: RoadmapEdge[];
  createdAt: number;
  updatedAt: number;
}

/**
 * User-tunable schedule preferences. The scheduler uses these to project
 * concrete target dates onto each node after enrollment.
 */
export interface SchedulePrefs {
  /** Hours per Mon–Fri. Fractional allowed (e.g. 0.5 = 30 min). */
  weekdayHours: number;
  /** Hours per Sat–Sun. Ignored when workOnWeekends is false. */
  weekendHours: number;
  workOnWeekends: boolean;
  /**
   * Per-node manual date overrides. Date encoded as YYYY-MM-DD so it's
   * timezone-stable across sync. If a node has an entry here, the scheduler
   * pins it to that date instead of the computed one.
   */
  nodeDateOverrides: Record<NodeId, string>;
  /**
   * Deadline-mode multiplier applied to the derived weekday hours to
   * get weekend hours (`weekendHours = weekdayHours * weekendMultiplier`).
   * 0 = no weekend study. Only meaningful when the enrollment has a
   * `targetEndDate` set — in that mode the UI shows the multiplier
   * knob instead of the raw weekdayHours/weekendHours inputs, and
   * the store keeps both pairs in sync. Unset = manual mode.
   */
  weekendMultiplier?: number;
}

export interface Enrollment {
  id: EnrollmentId;
  roadmapId: RoadmapId;
  userId: string | null;
  /** ISO date (YYYY-MM-DD) when the user enrolled. */
  startDate: string;
  /**
   * Optional finish-by date (YYYY-MM-DD). When set, the deadline UI
   * derives `schedulePrefs.weekdayHours` / `weekendHours` from this
   * date plus the remaining work — the user trades "how many hours
   * per day" for "by when do I want to be done", and the scheduler
   * picks up the derived hours unchanged.
   */
  targetEndDate?: string;
  /**
   * 0–100 integer per node — the user's manually-set progress. Auto-
   * detected progress from book reading is computed separately and
   * composited at render time (display = max(manual, auto)).
   * Migrated from the legacy `completedNodeIds: { [id]: true }` shape
   * on first read; nodes that were marked complete come across as 100.
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
