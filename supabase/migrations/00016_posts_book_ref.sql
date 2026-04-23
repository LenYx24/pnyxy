-- ============================================================
-- 00016_posts_book_ref.sql
-- Per-book forum namespacing.
--
-- Posts still belong to a community (required), but may
-- optionally reference a specific book so the book page can
-- show only discussions about that book.
-- ============================================================

alter table public.posts
  add column if not exists book_id uuid
    references public.books(id) on delete set null,
  add column if not exists catalog_book_id uuid
    references public.catalog_books(id) on delete set null;

-- Only one of the two may be set per row.
alter table public.posts
  add constraint posts_book_or_catalog_book check (
    book_id is null or catalog_book_id is null
  );

-- Fast lookup of posts for a given book on the book page.
create index if not exists posts_book_id_idx
  on public.posts (book_id, last_activity desc)
  where book_id is not null;

create index if not exists posts_catalog_book_id_idx
  on public.posts (catalog_book_id, last_activity desc)
  where catalog_book_id is not null;
