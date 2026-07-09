-- ============================================================
-- 00053_resources.sql
-- Library "resources": saved web pages / YouTube links that live in
-- the library alongside books, notes, quizzes and chats. A resource is
-- just a URL the user saved; web pages optionally carry an extracted
-- markdown `content` (via the ingest-url edge function) so the reader/
-- AI can ground on them later. YouTube stores metadata + an embed.
--
-- Mirrors chat_conversations: owner-only RLS, foldered via folder_id,
-- fractional sort_order for drag-and-drop ordering.
-- ============================================================

create type public.resource_kind as enum ('web', 'youtube');

create table public.resources (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  -- null = library root; folder deletion drops the resource back to root
  folder_id     uuid references public.folders(id) on delete set null,
  kind          public.resource_kind not null,
  url           text not null,
  title         text not null default '',
  description   text,
  thumbnail_url text,
  -- extracted article markdown (web); null for youtube or not-yet-ingested
  content       text,
  -- fractional midpoints for DnD ordering, matching chats
  sort_order    double precision not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index resources_user_idx on public.resources (user_id, updated_at desc);
create index resources_folder_idx on public.resources (folder_id);

-- ── RLS ───────────────────────────────────────────────────
alter table public.resources enable row level security;

create policy "Users manage their own resources"
  on public.resources for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
