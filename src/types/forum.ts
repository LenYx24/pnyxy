// Forum enums

export type CommunityKind = "topic";
export type CommunityRole = "member" | "mod" | "owner";
export type PostKind = "text" | "link";

// Communities

export interface Community {
  id: string;
  slug: string;
  name: string;
  kind: CommunityKind;
  description: string;
  created_by: string;
  created_at: string;
  member_count: number;
  avatar_url: string | null;
  banner_url: string | null;
}

export interface CommunityInsert {
  slug: string;
  name: string;
  kind?: CommunityKind;
  description?: string;
}

// Memberships

export interface CommunityMembership {
  user_id: string;
  community_id: string;
  role: CommunityRole;
  joined_at: string;
}

// Posts

export interface ForumPost {
  id: string;
  community_id: string;
  author_id: string;
  title: string;
  kind: PostKind;
  body_md: string | null;
  link_url: string | null;
  book_id: string | null;
  catalog_book_id: string | null;
  created_at: string;
  edited_at: string | null;
  is_removed: boolean;
  score_cached: number;
  comment_count: number;
  last_activity: string;
}

export interface ForumPostInsert {
  community_id: string;
  title: string;
  kind?: PostKind;
  body_md?: string | null;
  link_url?: string | null;
  book_id?: string | null;
  catalog_book_id?: string | null;
}

export interface ForumPostWithAuthor extends ForumPost {
  author?: { display_name: string | null; avatar_url: string | null };
  community?: { slug: string; name: string } | null;
}

// Comments

export interface ForumComment {
  id: string;
  post_id: string;
  parent_id: string | null;
  author_id: string;
  body_md: string;
  created_at: string;
  edited_at: string | null;
  is_removed: boolean;
  score_cached: number;
}

export interface ForumCommentInsert {
  post_id: string;
  parent_id?: string | null;
  body_md: string;
}

export interface ForumCommentWithAuthor extends ForumComment {
  author?: { display_name: string | null; avatar_url: string | null };
  children?: ForumCommentWithAuthor[];
}
