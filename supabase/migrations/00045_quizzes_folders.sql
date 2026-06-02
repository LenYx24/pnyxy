-- ============================================================
-- 00045_quizzes_folders.sql
-- Bring quizzes into the unified library `folders` tree.
--
-- Same shape as notes (00044): a nullable folder_id referencing the
-- shared folders table (on delete set null → a deleted folder sends
-- its quizzes back to the root, never destroys them) plus a
-- double-precision sort_order for fractional-midpoint drag reorder.
--
-- Quizzes are Supabase-direct (the quiz-store reads them straight from
-- this table), unlike notes/whiteboards which are local-first — so the
-- column lives here and the store patches it on move. Quizzes carry no
-- org_id today (org scoping is separate future work); like notes they
-- scope into a workspace implicitly via folder_id, and root-level
-- quizzes stay global to the user.
-- ============================================================

-- ── Columns ────────────────────────────────────────────────
alter table public.quizzes
  add column folder_id uuid references public.folders(id) on delete set null,
  add column sort_order double precision not null default 0;

-- ── Backfill folder placement from the quiz's book ─────────
-- A quiz tied to an uploaded book inherits that book's folder.
update public.quizzes q
set folder_id = b.folder_id
from public.books b
where q.uploaded_book_id = b.id
  and b.folder_id is not null;

-- A quiz tied to a catalog book inherits the folder of that user's
-- own library entry for the catalog book (scoped by user_id so we
-- don't pull in another user's placement). Only fill rows still at
-- the root after the uploaded-book pass.
update public.quizzes q
set folder_id = ul.folder_id
from public.user_library ul
where q.catalog_book_id = ul.catalog_book_id
  and ul.user_id = q.user_id
  and ul.folder_id is not null
  and q.folder_id is null;

-- ── Backfill sort_order ────────────────────────────────────
-- Newest quiz (largest updated_at) gets the lowest sort_order so the
-- most-recently-touched quizzes sit at the top — matches fetchMine's
-- existing updated_at-desc ordering.
update public.quizzes q
set sort_order = sub.rn
from (
  select
    id,
    row_number() over (
      partition by user_id
      order by updated_at desc
    ) as rn
  from public.quizzes
) sub
where q.id = sub.id;

-- ── Indexes ────────────────────────────────────────────────
create index if not exists quizzes_folder_id_idx
  on public.quizzes (folder_id);
create index if not exists quizzes_user_sort_order_idx
  on public.quizzes (user_id, sort_order asc);
