-- ============================================================
-- 00058_shared_answer_votes.sql
-- Upvoting for the prompt gallery: one vote per user per shared answer,
-- with a trigger keeping shared_answers.upvotes (from 00055) in sync so
-- the gallery can sort/show counts cheaply. The trigger is SECURITY
-- DEFINER so a voter can bump a count on an answer they don't own
-- (shared_answers has no UPDATE policy for non-owners).
-- ============================================================

create table public.shared_answer_votes (
  shared_answer_id uuid not null references public.shared_answers(id) on delete cascade,
  user_id          uuid not null references public.profiles(id) on delete cascade,
  created_at       timestamptz not null default now(),
  primary key (shared_answer_id, user_id)
);

alter table public.shared_answer_votes enable row level security;

create policy "read own votes"
  on public.shared_answer_votes for select
  to authenticated
  using (auth.uid() = user_id);

create policy "insert own vote"
  on public.shared_answer_votes for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "delete own vote"
  on public.shared_answer_votes for delete
  to authenticated
  using (auth.uid() = user_id);

create or replace function public.sync_shared_answer_upvotes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'INSERT') then
    update public.shared_answers
      set upvotes = upvotes + 1
      where id = new.shared_answer_id;
  elsif (tg_op = 'DELETE') then
    update public.shared_answers
      set upvotes = greatest(0, upvotes - 1)
      where id = old.shared_answer_id;
  end if;
  return null;
end;
$$;

create trigger shared_answer_votes_count
  after insert or delete on public.shared_answer_votes
  for each row execute function public.sync_shared_answer_upvotes();
