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
  /** Join code for private spaces (00065). RLS only returns it to
   *  members/owner via the spaces select policy; may be absent. */
  invite_code?: string | null;
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
  | "link"
  /** Uploaded course file in the space-files bucket (url = storage path, 00069). */
  | "file"
  /** Plain text notice / heading inside a section (00069). */
  | "label";

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
  /** Section on the course page; null = the implicit "General" group (00069). */
  section_id?: string | null;
  added_by: string | null;
  created_at: string;
}

/** One user's manual completion tick on a course item (migration 00070). */
export interface SpaceContentProgress {
  content_id: string;
  user_id: string;
  completed_at: string;
}

/** An ordered, titled block on the Moodle-style course page (migration 00069). */
export interface SpaceSection {
  id: string;
  space_id: string;
  title: string;
  description: string | null;
  sort_order: number;
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
