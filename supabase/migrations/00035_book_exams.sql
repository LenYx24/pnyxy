-- ============================================================
-- 00035_book_exams.sql
-- Past exams / practice papers a user uploads alongside a book.
--
-- A user studying from a textbook can attach previous-year exams to
-- it. The PDF lives in the existing `book-files` bucket; metadata
-- (name, year, AI-derived topic list) lives here. Each exam targets
-- exactly one book, either a catalog book or an uploaded one,
-- mirroring `book_external_resources`.
--
-- AI columns:
--   `ai_status` tracks the lifecycle of the optional topic-extraction
--     pass: idle → analyzing → done | failed.
--   `ai_topics` is a JSON array of topic strings the model identified
--     from the exam content. Surfaced in the UI as chips so the user
--     immediately sees "this exam tests X, Y, Z".
-- ============================================================

create table public.book_exams (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  catalog_book_id uuid references public.catalog_books(id) on delete cascade,
  book_id         uuid references public.books(id)         on delete cascade,
  storage_path    text not null,
  file_name       text not null,
  size_bytes      bigint not null default 0,
  page_count      int,
  name            text not null,
  year            int,
  ai_status       text not null default 'idle'
                  check (ai_status in ('idle', 'analyzing', 'done', 'failed')),
  ai_topics       jsonb,
  ai_error        text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint book_exams_target_xor
    check ((catalog_book_id is null) <> (book_id is null))
);

create index book_exams_user_idx
  on public.book_exams (user_id);
create index book_exams_catalog_idx
  on public.book_exams (catalog_book_id)
  where catalog_book_id is not null;
create index book_exams_book_idx
  on public.book_exams (book_id)
  where book_id is not null;

create trigger book_exams_set_updated_at
  before update on public.book_exams
  for each row execute function public.set_updated_at();

alter table public.book_exams enable row level security;

create policy "users select own exams"
  on public.book_exams for select
  using (user_id = auth.uid());
create policy "users insert own exams"
  on public.book_exams for insert
  with check (user_id = auth.uid());
create policy "users update own exams"
  on public.book_exams for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
create policy "users delete own exams"
  on public.book_exams for delete
  using (user_id = auth.uid());
