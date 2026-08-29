-- ============================================================
-- 00074_resource_transcript_chat.sql
-- YouTube resources get a stored transcript so the AI side-chat can
-- ground on the spoken content (model-agnostic path), and chat
-- conversations can be tied to a library resource the same way they
-- are tied to a reader document (source_doc_id).
-- ============================================================

-- Caption segments as fetched by the ingest-url edge function:
--   [{ "start": 12.4, "dur": 3.1, "text": "..." }, ...]
-- Null = not fetched yet / no captions on the video.
alter table public.resources
  add column if not exists transcript jsonb,
  -- BCP-47 language tag of the stored track ("hu", "en", ...) so the UI
  -- can say which language the transcript is in; null when unknown.
  add column if not exists transcript_lang text;

-- A conversation opened from the resource viewer's side-chat. The
-- resource going away leaves the conversation as a plain chat.
alter table public.chat_conversations
  add column if not exists source_resource_id uuid
    references public.resources(id) on delete set null;

create index if not exists chat_conversations_source_resource_idx
  on public.chat_conversations (source_resource_id)
  where source_resource_id is not null;
