-- ============================================================
-- Shared book catalog & user-library junction
-- ============================================================

-- Source enum for catalog_books
create type public.catalog_source as enum ('open_library', 'google_books', 'user_submitted');

-- Moderation status enum
create type public.catalog_status as enum ('pending', 'verified', 'rejected');

-- ── catalog_books ───────────────────────────────────────────
create table public.catalog_books (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  authors     text[] not null default '{}',
  description text,
  cover_url   text,

  isbn_10     text,
  isbn_13     text,
  publisher   text,
  published_date text,
  page_count  integer,
  language    text default 'en',
  categories  text[] not null default '{}',

  source      public.catalog_source not null default 'user_submitted',
  source_id   text,

  submitted_by uuid references auth.users on delete set null,
  status       public.catalog_status not null default 'pending',

  verified_at  timestamptz,
  verified_by  uuid references auth.users on delete set null,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Index for full-text search on title
create index catalog_books_title_idx on public.catalog_books using gin (to_tsvector('english', title));
-- Index for ISBN lookups
create index catalog_books_isbn_13_idx on public.catalog_books (isbn_13) where isbn_13 is not null;
create index catalog_books_isbn_10_idx on public.catalog_books (isbn_10) where isbn_10 is not null;
-- Index for source_id dedup
create unique index catalog_books_source_idx on public.catalog_books (source, source_id) where source_id is not null;

-- Updated-at trigger (reuse the function from 00001 if it exists, otherwise create)
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger catalog_books_updated_at
  before update on public.catalog_books
  for each row execute function public.set_updated_at();

-- RLS
alter table public.catalog_books enable row level security;

-- Everyone can read verified books
create policy "Anyone can read verified catalog books"
  on public.catalog_books for select
  using (status = 'verified');

-- Authenticated users can read their own pending submissions
create policy "Users can read own pending submissions"
  on public.catalog_books for select
  using (auth.uid() = submitted_by);

-- Authenticated users can insert (as pending)
create policy "Authenticated users can submit books"
  on public.catalog_books for insert
  with check (auth.uid() is not null and status = 'pending');

-- Only the submitter can update their own pending books
create policy "Users can update own pending submissions"
  on public.catalog_books for update
  using (auth.uid() = submitted_by and status = 'pending');

-- ── user_library ────────────────────────────────────────────
create table public.user_library (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users on delete cascade,
  catalog_book_id uuid not null references public.catalog_books on delete cascade,
  added_at        timestamptz not null default now(),

  unique (user_id, catalog_book_id)
);

create index user_library_user_idx on public.user_library (user_id);

-- RLS
alter table public.user_library enable row level security;

-- Users can read their own library entries
create policy "Users can read own library"
  on public.user_library for select
  using (auth.uid() = user_id);

-- Users can add books to their library
create policy "Users can add to own library"
  on public.user_library for insert
  with check (auth.uid() = user_id);

-- Users can remove books from their library
create policy "Users can remove from own library"
  on public.user_library for delete
  using (auth.uid() = user_id);
