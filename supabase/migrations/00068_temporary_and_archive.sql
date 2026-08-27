-- Temporary (incognito) chats and conversation archiving.
-- Temporary: hidden from history lists, the client purges them 24h
-- after creation on the next session start. Archived: hidden from the
-- main lists, shown under an "Archive" section, restorable.
ALTER TABLE public.chat_conversations
  ADD COLUMN IF NOT EXISTS is_temporary boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;
