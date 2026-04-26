-- ============================================================
-- Migration 00024: per-quiz randomization flags
--
-- Quiz authors can opt into shuffled question order, shuffled
-- option order (mcq4 only), or both. Both flags default to false
-- so existing quizzes keep their authored order.
-- ============================================================

alter table public.quizzes
  add column randomize_questions boolean not null default false,
  add column randomize_options   boolean not null default false;
