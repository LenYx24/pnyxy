-- ============================================================
-- Migration 00015: spaced-repetition review state per (user, question)
--
-- One row per (user_id, question_id) tracks the user's FSRS state for
-- that question. Written client-side via ts-fsrs after each grading.
-- No server-side algorithm — this table is just persistence.
--
-- RLS: users can only read/write their own reviews.
-- ============================================================

create table public.quiz_reviews (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users on delete cascade,
  question_id       uuid not null references public.quiz_questions on delete cascade,
  stability         real not null default 0,
  difficulty        real not null default 0,
  state             smallint not null default 0, -- 0=new 1=learning 2=review 3=relearning
  last_reviewed_at  timestamptz,
  due_at            timestamptz not null default now(),
  lapses            integer not null default 0,
  reps              integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (user_id, question_id)
);

create index quiz_reviews_user_due_idx
  on public.quiz_reviews (user_id, due_at);

create trigger quiz_reviews_updated_at
  before update on public.quiz_reviews
  for each row execute function public.set_updated_at();

alter table public.quiz_reviews enable row level security;

create policy "Users manage own reviews"
  on public.quiz_reviews for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
