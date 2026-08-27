-- Replace the "error encoded as a message-text prefix" pattern with a real
-- field. Null = no error. When set, chat-stream.ts stores a short
-- machine-ish reason ("stream_failed", "empty_response", "cut:max_tokens",
-- "cut:content_filter") or a human-readable notice for the partial-stream
-- cut case; MessageBubble renders it and offers a retry.
ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS error text;
