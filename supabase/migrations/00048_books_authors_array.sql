-- ============================================================
-- 00048_books_authors_array.sql
-- Structured multi-author support for uploaded books.
--
-- `books` historically had a single `author text` column, while the
-- shared `catalog_books` table already used `authors text[]`. This
-- brings uploaded books in line: an `authors text[]` array becomes the
-- source of truth. The legacy `author` column is KEPT and continues to
-- be written by the app (as the comma-joined display string) so any
-- reader not yet migrated to `authors` still shows every author.
-- ============================================================

alter table public.books
  add column authors text[] not null default '{}';

-- Backfill: wrap each existing non-empty author as a single array
-- element. We deliberately DON'T split on commas, a stored value like
-- "Kosztolányi, Dezső" is one person, and splitting would corrupt it.
-- Books that actually have multiple authors can be re-edited.
update public.books
   set authors = array[author]
 where author is not null and btrim(author) <> '';
