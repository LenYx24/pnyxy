-- ============================================================
-- 00055_shared_answers.sql
-- "Share this answer": a user can publish a {question, answer} pair
-- from a chat into a public prompt gallery (optionally scoped to a
-- space/course) so other users can see useful answers. MVP: share +
-- browse; voting is a later addition (upvotes column reserved).
-- ============================================================

create table public.shared_answers (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  -- null = global gallery; otherwise scoped to a space/course gallery
  space_id    uuid references public.spaces(id) on delete set null,
  question    text not null,
  answer      text not null,
  model       text,
  upvotes     integer not null default 0,
  created_at  timestamptz not null default now()
);

create index shared_answers_space_idx on public.shared_answers (space_id, created_at desc);
create index shared_answers_recent_idx on public.shared_answers (created_at desc);

-- ── RLS ───────────────────────────────────────────────────
alter table public.shared_answers enable row level security;

-- Global (space_id null) answers are readable by any signed-in user;
-- space-scoped answers follow the space's visibility.
create policy "read shared answers"
  on public.shared_answers for select
  to authenticated
  using (
    space_id is null
    or public.space_is_public(space_id)
    or public.is_space_member(space_id)
    or public.is_space_owner(space_id)
  );

create policy "share own answer"
  on public.shared_answers for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "delete own shared answer"
  on public.shared_answers for delete
  to authenticated
  using (auth.uid() = user_id);
