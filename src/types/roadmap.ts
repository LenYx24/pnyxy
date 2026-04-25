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
   */
  payload?: Record<string, unknown>;
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
}

export interface Enrollment {
  id: EnrollmentId;
  roadmapId: RoadmapId;
  userId: string | null;
  /** ISO date (YYYY-MM-DD) when the user enrolled. */
  startDate: string;
  /** Set semantics — stored as object map for IDB-friendly serialization. */
  completedNodeIds: Record<NodeId, true>;
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
