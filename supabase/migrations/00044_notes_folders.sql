-- ============================================================
-- 00044_notes_folders.sql
-- Bring notes into the unified library `folders` tree.
--
-- Until now notes were a flat, book-agnostic list (the local-first
-- note-store mirrors them to `public.notes` via the sync queue, with
-- book_id always null). The product direction is now: every document-
-- like artifact — books, chat conversations, and notes — lives in the
-- same folder tree so a user can group "all things about a book"
-- together and browse them from the desktop app's filetree.
--
-- This mirrors the shape that chat already adopted:
--   * folder_id  → references the shared `folders` table, nullable,
--                  `on delete set null` so deleting a folder sends its
--                  notes back to the root rather than destroying them.
--   * sort_order → double precision, lower = earlier, fractional
--                  midpoint inserts for drag-reorder (see 00041).
--
-- Notes are intentionally NOT org-scoped here. They have never carried
-- an org_id (the sync handler writes user_id only, and the local Note
-- model has no org), and forcing one now would break offline note
-- creation. A note scopes into a workspace implicitly via its
-- folder_id (folders are org-scoped since 00027); root-level notes
-- remain global to the user, exactly as they are today. Proper note
-- org-scoping is tracked as separate follow-up work.
-- ============================================================

-- ── Columns ────────────────────────────────────────────────
alter table public.notes
  add column folder_id uuid references public.folders(id) on delete set null,
  add column sort_order double precision not null default 0;

-- ── Backfill folder placement from the note's book ─────────
-- A note tied to a book inherits that book's folder, so existing
-- per-book notes land next to the book they belong to instead of
-- piling up at the root. Notes with no book (the common case today)
-- stay at the root (folder_id null).
update public.notes n
set folder_id = b.folder_id
from public.books b
where n.book_id = b.id
  and b.folder_id is not null;

-- ── Backfill sort_order ────────────────────────────────────
-- Newest note (largest updated_at) gets the lowest sort_order so the
-- most-recently-touched notes sit at the top — matches the note-
-- store's existing updatedAt-desc ordering.
update public.notes n
set sort_order = sub.rn
from (
  select
    id,
    row_number() over (
      partition by user_id
      order by updated_at desc
    ) as rn
  from public.notes
) sub
where n.id = sub.id;

-- ── Indexes ────────────────────────────────────────────────
-- Supports the per-user, per-folder fetch + ascending sort the
-- library tree does when listing a folder's notes.
create index if not exists notes_folder_id_idx
  on public.notes (folder_id);
create index if not exists notes_user_sort_order_idx
  on public.notes (user_id, sort_order asc);
