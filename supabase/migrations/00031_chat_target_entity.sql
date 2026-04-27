-- ============================================================
-- 00031_chat_target_entity.sql
-- A conversation can be tied to an editable artifact (a roadmap
-- or a quiz) so the AI can apply tool-use edits to it. When set,
-- the chat store injects the artifact's current state into the
-- system prompt and enables the matching tool dispatcher.
--
-- target_roadmap_id is text because roadmaps live in IndexedDB
-- (phase 1) — we just store the client-generated UUID as text and
-- never join against it. target_quiz_id is reserved for the quiz
-- variant landing in the next session; kept nullable so this
-- migration ships independently.
-- ============================================================

alter table public.chat_conversations
  add column target_roadmap_id text,
  add column target_quiz_id uuid references public.quizzes(id) on delete set null;
