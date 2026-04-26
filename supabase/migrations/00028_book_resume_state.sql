-- ============================================================
-- 00028_book_resume_state.sql
-- Cross-device "last reading position" sync.
--
-- Keyed by (user_id, doc_id). `doc_id` is whatever id the
-- reader adapter computes — for PDFs that's a content hash,
-- for EPUBs it's the book's `book.key()`. Same content on a
-- different device produces the same id, so opening the book
-- on phone after reading on desktop drops you exactly where
-- you left off.
--
-- Distinct from the older `reading_progress` table — that one
-- was meant for plan-progress aggregates (and currently isn't
-- written by anything; cleaning that up is a separate task).
-- ============================================================

create table public.book_resume_state (
  user_id       uuid not null references auth.users on delete cascade,
  doc_id        text not null,
  -- Page number (1-indexed). For EPUBs this is the spine-position
  -- equivalent the adapter exposes — the canonical position is
  -- `cfi` and `page` is just a convenience for UI display.
  page          integer not null default 1,
  -- Fraction (0..1) of the way down the current page. Lets resume
  -- be pixel-precise instead of just "top of page N".
  scroll_offset double precision,
  -- EPUB Canonical Fragment Identifier — the canonical position
  -- inside an EPUB's spine. Null for PDFs.
  cfi           text,
  updated_at    timestamptz not null default now(),
  primary key (user_id, doc_id)
);

create index book_resume_state_user_idx
  on public.book_resume_state (user_id, updated_at desc);

create trigger book_resume_state_set_updated_at
  before update on public.book_resume_state
  for each row execute function public.set_updated_at();

-- ── RLS ─────────────────────────────────────────────────────
alter table public.book_resume_state enable row level security;

create policy "Resume state readable by owner"
  on public.book_resume_state for select
  to authenticated
  using (user_id = auth.uid());

create policy "Resume state insertable by owner"
  on public.book_resume_state for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "Resume state updatable by owner"
  on public.book_resume_state for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "Resume state deletable by owner"
  on public.book_resume_state for delete
  to authenticated
  using (user_id = auth.uid());
