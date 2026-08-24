-- ============================================================
-- 00034_book_external_resources.sql
-- Per-user external links attached to a book (catalog or uploaded).
--
-- Use cases: a user attaching their YouTube companion videos, blog
-- articles, course pages, supplementary PDFs etc. to a specific book.
-- Resources are PRIVATE per user, they are not surfaced on the
-- catalog browse view.
-- ============================================================

create table public.book_external_resources (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  -- Polymorphic target: either a catalog book or an uploaded book.
  -- Exactly one must be set (enforced by check constraint below).
  catalog_book_id uuid references public.catalog_books(id) on delete cascade,
  book_id         uuid references public.books(id)         on delete cascade,
  url             text not null,
  title           text,
  -- Free-form-but-narrowed kind discriminator. Drives the small
  -- icon shown next to each row in the UI. New kinds can be added
  -- by the client (no schema migration needed), invalid values
  -- will fall back to 'other' on render.
  kind            text not null default 'other'
                  check (kind in ('video', 'article', 'course', 'document', 'other')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint book_external_resources_target_xor
    check ((catalog_book_id is null) <> (book_id is null))
);

create index book_external_resources_user_idx
  on public.book_external_resources (user_id);
create index book_external_resources_catalog_idx
  on public.book_external_resources (catalog_book_id)
  where catalog_book_id is not null;
create index book_external_resources_book_idx
  on public.book_external_resources (book_id)
  where book_id is not null;

create trigger book_external_resources_set_updated_at
  before update on public.book_external_resources
  for each row execute function public.set_updated_at();

alter table public.book_external_resources enable row level security;

-- Strict per-user access. No collaborative / public sharing for
-- external resources at this point, keeps the surface simple and
-- avoids worrying about user-submitted URL spam in the catalog.
create policy "users select own external resources"
  on public.book_external_resources for select
  using (user_id = auth.uid());
create policy "users insert own external resources"
  on public.book_external_resources for insert
  with check (user_id = auth.uid());
create policy "users update own external resources"
  on public.book_external_resources for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
create policy "users delete own external resources"
  on public.book_external_resources for delete
  using (user_id = auth.uid());
