-- ============================================================
-- 00030_chat_source_context.sql
-- A conversation can be "about" a specific document, usually
-- because the user clicked "Send to AI chat" from the reader's
-- text-selection menu. Recording the source lets us:
--   1. Show a context pill above the composer ("from <Book>, p.42")
--   2. Resolve [p.N] citations the assistant emits into clickable
--      links back to the reader at /reader/<docId>?page=N.
--   3. Prepend the document title into the system prompt so the
--      model knows what's being asked about.
--
-- All three columns are nullable, existing conversations and
-- chats opened from the standalone /chat page have no source.
-- `source_doc_id` is text rather than uuid because the route
-- param accepts either a catalog UUID or a PDF file hash (same
-- convention as `book_resume_state.doc_id`).
-- ============================================================

alter table public.chat_conversations
  add column source_doc_id text,
  add column source_doc_title text,
  add column source_page integer;
