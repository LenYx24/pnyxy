/**
 * TypeScript types matching the Supabase database schema.
 *
 * These mirror the tables defined in supabase/migrations/00001_initial_schema.sql
 * and re-use existing client-side types (HighlightColor, DocumentFormat, etc.)
 * where applicable.
 *
 * Regenerate with:
 *   npx supabase gen types typescript --project-id <id> > src/types/supabase.ts
 */

import type { HighlightColor, TextSelection, CommentMessage } from "./annotation";
import type { DocumentFormat } from "./document";
import type { WhiteboardBackground, WhiteboardElement } from "./whiteboard";
import type { CatalogBook, CatalogBookInsert, UserLibraryEntry } from "./catalog";

// ── Enums ───────────────────────────────────────────────────

export type BookVisibility = "private" | "public";
export type UserRole = "user" | "admin";
export type StorageTier = "free" | "premium";
export type ReportStatus = "pending" | "dismissed" | "warned" | "temp_banned" | "permabanned";
export type ReportReason = "spam" | "harassment" | "inappropriate_content" | "impersonation" | "other";

// Re-export for convenience — these match the Postgres enums
export type { HighlightColor, DocumentFormat };

// ── Profiles ────────────────────────────────────────────────

export interface Profile {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  preferences: Record<string, unknown>;
  role: UserRole;
  storage_tier: StorageTier;
  created_at: string;
  updated_at: string;
}

// ── Categories ──────────────────────────────────────────────

export interface Category {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  sort_order: number;
  parent_id: string | null;
  created_by: string | null;
  description: string | null;
  created_at: string;
}

// ── Books ───────────────────────────────────────────────────

export interface Book {
  id: string;
  user_id: string;
  title: string;
  author: string | null;
  format: DocumentFormat;
  page_count: number | null;
  cover_url: string | null;
  file_hash: string | null;
  visibility: BookVisibility;
  category_id: string | null;
  folder_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface BookInsert {
  title: string;
  format?: DocumentFormat;
  author?: string | null;
  page_count?: number | null;
  cover_url?: string | null;
  file_hash?: string | null;
  visibility?: BookVisibility;
  category_id?: string | null;
  folder_id?: string | null;
  metadata?: Record<string, unknown>;
}

export interface BookUpdate {
  title?: string;
  author?: string | null;
  format?: DocumentFormat;
  page_count?: number | null;
  cover_url?: string | null;
  file_hash?: string | null;
  visibility?: BookVisibility;
  category_id?: string | null;
  folder_id?: string | null;
  metadata?: Record<string, unknown>;
}

// ── Book Files ──────────────────────────────────────────────

export interface BookFile {
  id: string;
  book_id: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number | null;
  is_primary: boolean;
  created_at: string;
}

// ── Folders ─────────────────────────────────────────────────

export interface Folder {
  id: string;
  user_id: string;
  parent_id: string | null;
  name: string;
  color: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

// ── Folder Items ────────────────────────────────────────────

export interface FolderItem {
  id: string;
  folder_id: string;
  book_id: string;
  added_at: string;
}

// ── Status Tags ─────────────────────────────────────────────

export type BookStatusTag =
  | "currently_reading"
  | "want_to_read"
  | "done"
  | "abandoned"
  | "hiatus"
  | "favorites";

export interface UserBookTag {
  id: string;
  user_id: string;
  catalog_book_id: string | null;
  book_id: string | null;
  tag: BookStatusTag;
  created_at: string;
}

// ── Category Junctions ──────────────────────────────────────

export interface CatalogBookCategory {
  id: string;
  catalog_book_id: string;
  category_id: string;
}

export interface BookCategory {
  id: string;
  book_id: string;
  category_id: string;
}

// ── Highlights ──────────────────────────────────────────────

export interface DbHighlight {
  id: string;
  user_id: string;
  book_id: string;
  color: HighlightColor;
  selection: TextSelection;
  page_number: number | null;
  created_at: string;
}

// ── Comments ────────────────────────────────────────────────

export interface DbComment {
  id: string;
  user_id: string;
  book_id: string;
  highlight_id: string | null;
  selection: TextSelection | null;
  messages: CommentMessage[];
  resolved: boolean;
  created_at: string;
  updated_at: string;
}

// ── Notes ───────────────────────────────────────────────────

export interface DbNote {
  id: string;
  user_id: string;
  book_id: string | null;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
}

// ── Whiteboards ─────────────────────────────────────────────

export interface DbWhiteboard {
  id: string;
  user_id: string;
  book_id: string | null;
  title: string;
  elements: WhiteboardElement[];
  background: WhiteboardBackground;
  created_at: string;
  updated_at: string;
}

// ── Reading Progress ────────────────────────────────────────

export interface ReadingProgress {
  id: string;
  user_id: string;
  book_id: string;
  current_page: number;
  total_time_seconds: number;
  last_read_at: string;
  created_at: string;
  updated_at: string;
}

// ── User Reports ───────────────────────────────────────────

export interface UserReport {
  id: string;
  reporter_id: string;
  reported_user_id: string;
  reasons: string[];
  message: string | null;
  status: ReportStatus;
  admin_action: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
}

// ── User Bans ──────────────────────────────────────────────

export interface UserBan {
  id: string;
  user_id: string;
  reason: string;
  banned_by: string;
  banned_until: string | null;
  created_at: string;
}

// ── Database type map (for generic helpers) ─────────────────

export interface Database {
  public: {
    Tables: {
      profiles: { Row: Profile };
      categories: { Row: Category };
      books: { Row: Book; Insert: BookInsert; Update: BookUpdate };
      book_files: { Row: BookFile };
      folders: { Row: Folder };
      folder_items: { Row: FolderItem };
      user_book_tags: { Row: UserBookTag };
      catalog_book_categories: { Row: CatalogBookCategory };
      book_categories: { Row: BookCategory };
      highlights: { Row: DbHighlight };
      comments: { Row: DbComment };
      notes: { Row: DbNote };
      whiteboards: { Row: DbWhiteboard };
      reading_progress: { Row: ReadingProgress };
      catalog_books: { Row: CatalogBook; Insert: CatalogBookInsert };
      user_library: { Row: UserLibraryEntry };
      user_reports: { Row: UserReport };
      user_bans: { Row: UserBan };
    };
  };
}
