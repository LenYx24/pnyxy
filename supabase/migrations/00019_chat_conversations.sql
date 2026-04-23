-- ============================================================
-- 00019_chat_conversations.sql
-- Standalone LLM chat ("spiderweb" tree-structured conversations).
--
-- Each conversation owns a tree of messages. parent_message_id is
-- the parent in the tree (null for the root). Users can branch
-- from any past message, which creates a new child whose path
-- from the root shares all upstream ancestors.
-- ============================================================

create type public.chat_role as enum ('user', 'assistant', 'system');

create table public.chat_conversations (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  title         text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  /** id of the message currently treated as the "tip" of the active
   *  path — updated whenever the user sends / branches / picks a
   *  different leaf. */
  active_leaf_id uuid
);

create index chat_conversations_user_idx
  on public.chat_conversations (user_id, updated_at desc);

create table public.chat_messages (
  id                uuid primary key default gen_random_uuid(),
  conversation_id   uuid not null references public.chat_conversations(id) on delete cascade,
  parent_message_id uuid references public.chat_messages(id) on delete cascade,
  role              public.chat_role not null,
  content           text not null default '',
  created_at        timestamptz not null default now()
);

create index chat_messages_conv_idx
  on public.chat_messages (conversation_id, created_at);
create index chat_messages_parent_idx
  on public.chat_messages (parent_message_id);

-- FK added after the table exists so the conversation can point at
-- any of its own messages.
alter table public.chat_conversations
  add constraint chat_conversations_active_leaf_fk
    foreign key (active_leaf_id)
    references public.chat_messages(id)
    on delete set null;

-- ── RLS ───────────────────────────────────────────────────

alter table public.chat_conversations enable row level security;
alter table public.chat_messages enable row level security;

create policy "Users manage their own conversations"
  on public.chat_conversations for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Messages inherit ownership from their conversation.
create policy "Users read their own messages"
  on public.chat_messages for select
  to authenticated
  using (
    exists (
      select 1 from public.chat_conversations c
      where c.id = conversation_id and c.user_id = auth.uid()
    )
  );

create policy "Users insert messages to their conversations"
  on public.chat_messages for insert
  to authenticated
  with check (
    exists (
      select 1 from public.chat_conversations c
      where c.id = conversation_id and c.user_id = auth.uid()
    )
  );

create policy "Users update messages in their conversations"
  on public.chat_messages for update
  to authenticated
  using (
    exists (
      select 1 from public.chat_conversations c
      where c.id = conversation_id and c.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.chat_conversations c
      where c.id = conversation_id and c.user_id = auth.uid()
    )
  );

create policy "Users delete messages from their conversations"
  on public.chat_messages for delete
  to authenticated
  using (
    exists (
      select 1 from public.chat_conversations c
      where c.id = conversation_id and c.user_id = auth.uid()
    )
  );
