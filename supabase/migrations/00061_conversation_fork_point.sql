-- Fork point marker for branched conversations: the LOCAL copy of the
-- message the fork was made at (last inherited message). The thread UI
-- draws the "fork point" divider under it. The client falls back to
-- writing only active_leaf_id while this column is missing.
alter table public.chat_conversations
  add column if not exists forked_from_message_id uuid
    references public.chat_messages(id) on delete set null;
