-- ============================================================
-- Migration 00059: multi_select quiz question kind (enum value)
--
-- Adds the 'multi_select' variant to the quiz_question_kind enum.
-- A multi_select question reuses the four mcq option columns and
-- stores its set of correct option indices as a sorted, comma-
-- separated string in `correct_text` (e.g. "0,2,3"), parsed on the
-- client with parseCorrectIndices/serializeIndices.
--
-- Postgres forbids using a freshly ADDed enum value in the SAME
-- transaction that adds it, so the CHECK constraint that references
-- 'multi_select' lives in the follow-up migration 00060. This file
-- only adds the value; `if not exists` makes it idempotent.
-- ============================================================

alter type public.quiz_question_kind add value if not exists 'multi_select';
