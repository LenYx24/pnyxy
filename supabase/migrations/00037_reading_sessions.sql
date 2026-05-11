-- ============================================================
-- 00037_reading_sessions.sql
-- Per-book reading session timer with session-level granularity.
--
-- Keyed by `doc_id` (text) to match book_resume_state — same id
-- works whether the entry is an uploaded book uuid, a catalog
-- book uuid, or a PDF content hash, so the timer is consistent
-- across both reader-tracked and manually-tracked books.
--
-- Two derived stats hang off this table:
--   • Per-book reading streak (consecutive days with a closed
--     session for this doc).
--   • Estimated finish date (pages-per-day pace from recent
--     sessions times pages remaining).
-- Both are computed client-side from the rows in here — no
-- materialised view yet, the volume is per-user and tiny.
-- ============================================================

create table public.reading_sessions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users on delete cascade,
  doc_id           text not null,
  started_at       timestamptz not null,
  -- Null while the session is in progress. Stop flow sets it to
  -- now() and computes duration_seconds client-side. Crashed /
  -- abandoned sessions stay null until the user manually clears
  -- them — see `closeStaleSessions` in the client.
  ended_at         timestamptz,
  duration_seconds int,
  -- Page snapshots at start/end. Optional because manual-track
  -- users on physical books may not bother setting them every
  -- time, and the pace calc just skips sessions without both.
  start_page       int,
  end_page         int,
  created_at       timestamptz not null default now()
);

create index reading_sessions_user_doc_idx
  on public.reading_sessions (user_id, doc_id, started_at desc);

create index reading_sessions_user_started_idx
  on public.reading_sessions (user_id, started_at desc);

-- At most one in-progress session per user. The reading UI gates
-- "Start" on this — if the partial unique blocks the insert, we
-- surface the existing active session instead.
create unique index reading_sessions_one_active
  on public.reading_sessions (user_id) where ended_at is null;

alter table public.reading_sessions enable row level security;

create policy "Users read own reading_sessions"
  on public.reading_sessions for select
  to authenticated using (user_id = auth.uid());

create policy "Users insert own reading_sessions"
  on public.reading_sessions for insert
  to authenticated with check (user_id = auth.uid());

create policy "Users update own reading_sessions"
  on public.reading_sessions for update
  to authenticated using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "Users delete own reading_sessions"
  on public.reading_sessions for delete
  to authenticated using (user_id = auth.uid());
