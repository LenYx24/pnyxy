export type SpaceKind = "org" | "subspace" | "course" | "topic";
export type SpaceVisibility = "public" | "restricted" | "private";
export type SpaceRole = "owner" | "moderator" | "contributor" | "member";

/** A node in the community / course hierarchy (migration 00052). */
export interface Space {
  id: string;
  parent_id: string | null;
  owner_id: string;
  kind: SpaceKind;
  name: string;
  slug: string | null;
  description: string | null;
  visibility: SpaceVisibility;
  /** Verified badge; admin-only (never self-grantable). */
  official: boolean;
  created_at: string;
  updated_at: string;
}

export interface SpaceMember {
  space_id: string;
  user_id: string;
  role: SpaceRole;
  created_at: string;
}

/** Kinds of library content that can be attached to a course space (migration 00054). */
export type SpaceContentKind =
  | "book"
  | "resource"
  | "quiz"
  | "roadmap"
  | "note"
  | "whiteboard"
  | "link";

export interface SpaceContent {
  id: string;
  space_id: string;
  kind: SpaceContentKind;
  /** Generic ref to the underlying content (catalog book / resource / quiz / roadmap id). */
  ref_id: string | null;
  title: string;
  subtitle: string | null;
  url: string | null;
  sort_order: number;
  added_by: string | null;
  created_at: string;
}

/** A course run on the time axis (migration 00056). */
export type OfferingStatus = "draft" | "active" | "archived";

export interface Offering {
  id: string;
  space_id: string;
  term_label: string;
  starts_at: string | null;
  ends_at: string | null;
  status: OfferingStatus;
  sort_order: number;
  created_at: string;
}

/** A shared chat {question, answer} pair in the prompt gallery (migration 00055). */
export interface SharedAnswer {
  id: string;
  user_id: string;
  /** null = global gallery; otherwise scoped to a space/course. */
  space_id: string | null;
  question: string;
  answer: string;
  model: string | null;
  upvotes: number;
  created_at: string;
}
