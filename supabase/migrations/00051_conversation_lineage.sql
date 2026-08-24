-- ============================================================
-- Migration 00051: conversation fork lineage
--
-- Adds parent_conversation_id so a forked / duplicated conversation can
-- be shown as a CHILD of the conversation it branched from. This powers
-- the conversation Graph view's document-rooted tree:
--   document → conversation → forked child conversation(s).
--
-- ON DELETE SET NULL: deleting a parent conversation re-roots its
-- children rather than cascade-deleting them. RLS already scopes
-- chat_conversations by user_id (migration 00019), so no new policy is
-- needed, the column is just another self-referencing FK on rows the
-- user already owns.
-- ============================================================

alter table public.chat_conversations
  add column if not exists parent_conversation_id uuid
    references public.chat_conversations(id) on delete set null;

create index if not exists chat_conversations_parent_idx
  on public.chat_conversations (parent_conversation_id);
