-- ============================================================
-- 00032_chat_message_attachments.sql
-- Multimodal user messages, paste an image into the composer or
-- attach via the paperclip button and it gets sent alongside the
-- text to whichever provider supports vision (Claude Sonnet 4.5
-- and GPT-4o mini today).
--
-- Stored as jsonb instead of a separate table because:
--   1. Attachments are conceptually part of the message turn, the
--      lifecycle is identical to the message itself (delete, branch,
--      etc.) so a side table would just need cascading FKs.
--   2. We don't query "all attachments across messages" today, so
--      indexed columns aren't justified.
--   3. Inline base64 keeps the data path simple, no signed-URL
--      lifetime tracking, no orphaned-blob cleanup.
--
-- Each entry has:
--   { kind: "image", media_type: string, data: string (base64), name?: string }
--
-- Future shapes can be added (kind: "pdf", kind: "audio", …) without
-- another migration since jsonb is schemaless on the column itself.
-- ============================================================

alter table public.chat_messages
  add column attachments jsonb;
