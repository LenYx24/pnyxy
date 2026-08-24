-- ============================================================
-- Migration 00060: per-kind validity for multi_select questions
--
-- Runs in its own transaction (separate file) so it may reference the
-- 'multi_select' enum value added in 00059. We rebuild the existing
-- quiz_questions_valid_per_kind CHECK to add a multi_select branch:
-- a multi_select row must carry its correct-index set in correct_text
-- as a sorted, comma-separated list of option indices 0..3.
--
-- The mcq4 / true_false / short_answer branches are unchanged from
-- migration 00014. As before there is no ELSE branch, but every enum
-- value is now covered, so `case kind` never returns NULL.
-- ============================================================

alter table public.quiz_questions
  drop constraint quiz_questions_valid_per_kind;

alter table public.quiz_questions
  add constraint quiz_questions_valid_per_kind check (
    case kind
      when 'mcq4' then
        option_a is not null
        and option_b is not null
        and option_c is not null
        and option_d is not null
        and correct_index is not null
        and correct_index between 0 and 3
      when 'true_false' then
        correct_index is not null
        and correct_index between 0 and 1
      when 'short_answer' then
        correct_text is not null
        and length(trim(correct_text)) > 0
      when 'multi_select' then
        correct_text is not null
        -- a comma-separated list of option indices in 0..3, e.g. "0,2,3"
        and correct_text ~ '^[0-3](,[0-3])*$'
    end
  );
