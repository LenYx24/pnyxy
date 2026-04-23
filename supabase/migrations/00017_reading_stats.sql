-- ============================================================
-- 00017_reading_stats.sql
-- Public leaderboards: per-user aggregate reading stats.
--
-- The source of truth for daily records stays in the client
-- (localStorage via streak-store) — this table is a cached
-- rollup for fast leaderboard queries. Clients upsert their
-- own row; RLS allows anyone to read.
-- ============================================================

create table public.reading_stats (
  user_id          uuid primary key references public.profiles(id) on delete cascade,
  current_streak   int not null default 0,
  longest_streak   int not null default 0,
  total_seconds    bigint not null default 0,
  longest_attention_seconds int not null default 0,
  last_read_date   date,
  updated_at       timestamptz not null default now()
);

create index reading_stats_longest_streak_idx
  on public.reading_stats (longest_streak desc, updated_at desc);
create index reading_stats_current_streak_idx
  on public.reading_stats (current_streak desc, updated_at desc);
create index reading_stats_total_seconds_idx
  on public.reading_stats (total_seconds desc, updated_at desc);

alter table public.reading_stats enable row level security;

-- Anyone authenticated or anonymous can read; the profile join only
-- exposes display_name / avatar_url, which are already public.
create policy "Anyone can read reading_stats"
  on public.reading_stats for select using (true);

-- Users can only upsert their own row.
create policy "Users upsert their own stats"
  on public.reading_stats for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users update their own stats"
  on public.reading_stats for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
