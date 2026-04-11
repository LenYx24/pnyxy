-- ============================================================
-- Add download support columns to catalog_books
-- ============================================================

-- Internet Archive identifier (for public domain multi-format downloads)
alter table public.catalog_books add column ia_id text;

-- Direct download URL (for user-provided file links)
alter table public.catalog_books add column download_url text;

-- Index for IA identifier lookups
create index catalog_books_ia_id_idx on public.catalog_books (ia_id) where ia_id is not null;
