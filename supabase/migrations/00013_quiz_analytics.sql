-- ============================================================
-- Migration 00013: quiz analytics for owners
--
-- `quiz_most_missed` returns per-question attempt/wrong counts for a
-- quiz the caller owns. It aggregates across every user who has ever
-- answered — which RLS on quiz_attempt_answers would otherwise hide —
-- so it's a SECURITY DEFINER function that checks ownership itself.
-- Only aggregates are exposed; no individual attempts leak.
-- ============================================================

create or replace function public.quiz_most_missed(p_quiz_id uuid)
returns table (
  question_id       uuid,
  question_text     text,
  question_position integer,
  attempts          integer,
  wrong             integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  if not exists (
    select 1
    from public.quizzes
    where id = p_quiz_id
      and user_id = auth.uid()
  ) then
    raise exception 'not_owner';
  end if;

  return query
    select
      qq.id            as question_id,
      qq.question_text as question_text,
      qq.position      as question_position,
      coalesce(count(qaa.id), 0)::int                                 as attempts,
      coalesce(count(*) filter (where qaa.is_correct = false), 0)::int as wrong
    from public.quiz_questions qq
    left join public.quiz_attempt_answers qaa
      on qaa.question_id = qq.id
    where qq.quiz_id = p_quiz_id
    group by qq.id, qq.question_text, qq.position
    order by qq.position asc;
end;
$$;

revoke all on function public.quiz_most_missed(uuid) from public;
grant execute on function public.quiz_most_missed(uuid) to authenticated;
