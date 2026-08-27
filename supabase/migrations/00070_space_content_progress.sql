-- Manual "activity completion" ticks for the Moodle-style course page
-- (feature 1 of the course-page batch). One row per (content, user) marks
-- that user's item done; deleting the row un-marks it. Owners see nobody
-- else's ticks: this is a personal checklist, not a shared state.

create table if not exists public.space_content_progress (
  content_id   uuid not null references public.space_content(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  completed_at timestamptz not null default now(),
  primary key (content_id, user_id)
);

create index if not exists space_content_progress_user_idx
  on public.space_content_progress (user_id);

alter table public.space_content_progress enable row level security;

drop policy if exists "read own content progress" on public.space_content_progress;
create policy "read own content progress"
  on public.space_content_progress for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "insert own content progress" on public.space_content_progress;
create policy "insert own content progress"
  on public.space_content_progress for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "delete own content progress" on public.space_content_progress;
create policy "delete own content progress"
  on public.space_content_progress for delete
  to authenticated
  using (user_id = auth.uid());
