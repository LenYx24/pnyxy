-- ============================================================
-- Migration 00012: user-created quizzes (multiple-choice)
--
-- A quiz belongs to a user. It may optionally be associated with
-- either an uploaded book (books.id) or a public catalog book
-- (catalog_books.id), not both. Public quizzes are discoverable;
-- private quizzes are owner-only.
--
-- Each attempt records the user's score plus their per-question
-- answers so score-history and per-question review both work.
-- ============================================================

create type public.quiz_visibility as enum ('private', 'public');

-- ── quizzes ─────────────────────────────────────────────────
create table public.quizzes (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users on delete cascade,
  title            text not null,
  description      text,
  visibility       quiz_visibility not null default 'private',
  uploaded_book_id uuid references public.books on delete set null,
  catalog_book_id  uuid references public.catalog_books on delete set null,
  question_count   integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint quizzes_at_most_one_book
    check (uploaded_book_id is null or catalog_book_id is null)
);

create index quizzes_user_id_idx          on public.quizzes (user_id);
create index quizzes_visibility_idx       on public.quizzes (visibility);
create index quizzes_uploaded_book_id_idx on public.quizzes (uploaded_book_id)
  where uploaded_book_id is not null;
create index quizzes_catalog_book_id_idx  on public.quizzes (catalog_book_id)
  where catalog_book_id is not null;
create index quizzes_title_search_idx     on public.quizzes
  using gin (to_tsvector('simple', title));

create trigger quizzes_updated_at
  before update on public.quizzes
  for each row execute function public.set_updated_at();

-- ── quiz_questions ──────────────────────────────────────────
-- Multiple-choice only for v1, exactly 4 options, exactly one
-- correct (index 0..3). Extra types (true/false, short-answer,
-- fill-in-blank) will layer on later with a `kind` column.
create table public.quiz_questions (
  id             uuid primary key default gen_random_uuid(),
  quiz_id        uuid not null references public.quizzes on delete cascade,
  position       integer not null,
  question_text  text not null,
  option_a       text not null,
  option_b       text not null,
  option_c       text not null,
  option_d       text not null,
  correct_index  smallint not null check (correct_index between 0 and 3),
  explanation    text,
  created_at     timestamptz not null default now(),
  unique (quiz_id, position)
);

create index quiz_questions_quiz_id_idx on public.quiz_questions (quiz_id);

-- ── quiz_attempts ──────────────────────────────────────────
create table public.quiz_attempts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users on delete cascade,
  quiz_id       uuid not null references public.quizzes on delete cascade,
  score         integer not null default 0,
  total         integer not null,
  started_at    timestamptz not null default now(),
  completed_at  timestamptz
);

create index quiz_attempts_user_idx    on public.quiz_attempts (user_id);
create index quiz_attempts_quiz_idx    on public.quiz_attempts (quiz_id);
create index quiz_attempts_user_quiz_idx
  on public.quiz_attempts (user_id, quiz_id, completed_at desc);

-- ── quiz_attempt_answers ────────────────────────────────────
create table public.quiz_attempt_answers (
  id              uuid primary key default gen_random_uuid(),
  attempt_id      uuid not null references public.quiz_attempts on delete cascade,
  question_id     uuid not null references public.quiz_questions on delete cascade,
  selected_index  smallint not null check (selected_index between 0 and 3),
  is_correct      boolean not null,
  answered_at     timestamptz not null default now(),
  unique (attempt_id, question_id)
);

create index quiz_attempt_answers_attempt_idx
  on public.quiz_attempt_answers (attempt_id);

-- ============================================================
-- RLS
-- ============================================================

alter table public.quizzes               enable row level security;
alter table public.quiz_questions        enable row level security;
alter table public.quiz_attempts         enable row level security;
alter table public.quiz_attempt_answers  enable row level security;

-- ── quizzes policies ────────────────────────────────────────
-- Readable by owner always; readable by anyone when public.
create policy "Quizzes readable by owner"
  on public.quizzes for select
  to authenticated
  using (user_id = auth.uid());

create policy "Public quizzes readable by anyone"
  on public.quizzes for select
  using (visibility = 'public');

create policy "Quizzes insertable by owner"
  on public.quizzes for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "Quizzes updatable by owner"
  on public.quizzes for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "Quizzes deletable by owner"
  on public.quizzes for delete
  to authenticated
  using (user_id = auth.uid());

-- ── quiz_questions policies ─────────────────────────────────
-- Readable when the parent quiz is readable (via EXISTS join).
create policy "Questions readable with parent quiz"
  on public.quiz_questions for select
  using (
    exists (
      select 1 from public.quizzes q
      where q.id = quiz_id
        and (q.visibility = 'public' or q.user_id = auth.uid())
    )
  );

-- Write access: only the quiz owner.
create policy "Questions writable by quiz owner"
  on public.quiz_questions for all
  to authenticated
  using (
    exists (
      select 1 from public.quizzes q
      where q.id = quiz_id and q.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.quizzes q
      where q.id = quiz_id and q.user_id = auth.uid()
    )
  );

-- ── quiz_attempts policies ──────────────────────────────────
-- A user sees only their own attempts.
create policy "Attempts readable by attempter"
  on public.quiz_attempts for select
  to authenticated
  using (user_id = auth.uid());

create policy "Attempts insertable by attempter"
  on public.quiz_attempts for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "Attempts updatable by attempter"
  on public.quiz_attempts for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ── quiz_attempt_answers policies ───────────────────────────
-- Readable only via the attempt's owner.
create policy "Attempt answers readable by attempter"
  on public.quiz_attempt_answers for select
  to authenticated
  using (
    exists (
      select 1 from public.quiz_attempts a
      where a.id = attempt_id and a.user_id = auth.uid()
    )
  );

create policy "Attempt answers writable by attempter"
  on public.quiz_attempt_answers for all
  to authenticated
  using (
    exists (
      select 1 from public.quiz_attempts a
      where a.id = attempt_id and a.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.quiz_attempts a
      where a.id = attempt_id and a.user_id = auth.uid()
    )
  );

-- ============================================================
-- Trigger: keep question_count on quizzes in sync so the browse
-- page can filter/sort without a correlated subquery.
-- ============================================================

create or replace function public.quizzes_refresh_question_count()
returns trigger as $$
declare
  target_id uuid;
begin
  target_id := coalesce(new.quiz_id, old.quiz_id);
  update public.quizzes
     set question_count = (
       select count(*) from public.quiz_questions where quiz_id = target_id
     )
   where id = target_id;
  return coalesce(new, old);
end;
$$ language plpgsql security definer set search_path = public;

create trigger quiz_questions_sync_count
  after insert or delete on public.quiz_questions
  for each row execute function public.quizzes_refresh_question_count();
