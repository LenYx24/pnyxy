-- ============================================================
-- 00029_chat_folders.sql
-- Folder organization for the long-running chat conversations.
--
-- A folder is a single-user namespace; folders can nest via
-- `parent_id`. Conversations gain an optional `folder_id` —
-- null means "loose at the root" (the same default everyone
-- has today). Deleting a folder sends its conversations back
-- to the root rather than cascading them away; users have a
-- separate, explicit "delete conversation" action.
--
-- Not org-scoped here: chat scoping to organizations is a
-- separate follow-up that should land alongside scoping for
-- quizzes / plans / vocab in one consistent pass.
-- ============================================================

create table public.chat_folders (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade,
  parent_id   uuid references public.chat_folders(id) on delete cascade,
  name        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index chat_folders_user_idx on public.chat_folders (user_id);
create index chat_folders_parent_idx
  on public.chat_folders (parent_id) where parent_id is not null;

create trigger chat_folders_set_updated_at
  before update on public.chat_folders
  for each row execute function public.set_updated_at();

alter table public.chat_conversations
  add column folder_id uuid references public.chat_folders(id) on delete set null;

create index chat_conversations_folder_idx
  on public.chat_conversations (folder_id) where folder_id is not null;

-- ── RLS ─────────────────────────────────────────────────────
alter table public.chat_folders enable row level security;

create policy "Chat folders readable by owner"
  on public.chat_folders for select
  to authenticated
  using (user_id = auth.uid());

create policy "Chat folders insertable by owner"
  on public.chat_folders for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "Chat folders updatable by owner"
  on public.chat_folders for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "Chat folders deletable by owner"
  on public.chat_folders for delete
  to authenticated
  using (user_id = auth.uid());
