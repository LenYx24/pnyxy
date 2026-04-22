-- ============================================================
-- Migration 00014: additional quiz question kinds
--
-- Adds support for:
--   - true_false   (2 options; correct_index is 0 or 1)
--   - short_answer (free-text; matched case-insensitively on the client)
--
-- Strategy: reuse the existing mcq columns for mcq4 + true_false, add
-- a new correct_text column for short_answer, relax NOT NULL on the
-- mcq columns, and enforce per-kind validity with a single CHECK.
-- Existing rows default to 'mcq4' so nothing needs migrating.
-- ============================================================

create type public.quiz_question_kind as enum (
  'mcq4',
  'true_false',
  'short_answer'
);

alter table public.quiz_questions
  add column kind public.quiz_question_kind not null default 'mcq4',
  add column correct_text text,
  alter column option_a drop not null,
  alter column option_b drop not null,
  alter column option_c drop not null,
  alter column option_d drop not null,
  alter column correct_index drop not null;

-- The inline `correct_index between 0 and 3` stays; it's null-tolerant
-- so short_answer rows pass without filling it. Add the kind-aware
-- requirement as a separate named constraint.
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
    end
  );

-- ============================================================
-- quiz_attempt_answers: carry user's free-text answer for short_answer
-- questions and allow selected_index to be null in that case.
-- ============================================================

alter table public.quiz_attempt_answers
  add column selected_text text,
  alter column selected_index drop not null;

-- Ensure at least one of the two selected_* columns is populated.
alter table public.quiz_attempt_answers
  add constraint quiz_attempt_answers_has_selection check (
    selected_index is not null or selected_text is not null
  );
