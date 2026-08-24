-- ============================================================
-- 00036_unify_chat_folders.sql
-- Collapse `chat_folders` into the existing library `folders` tree.
--
-- The original 00029 migration gave chat its own folder hierarchy,
-- separate from the library's. The product direction is now: a
-- single namespace where books and chat conversations live in the
-- same folders, so a user can scope a conversation to "Cooking" or
-- "Eating" alongside the books on those topics.
--
-- Migration shape:
--   1. Copy chat_folders rows into the library `folders` table,
--      preserving primary keys AND assigning each one to the user's
--      default org (folders.org_id is NOT NULL since 00027, chat
--      folders never had that column, so we have to backfill it).
--   2. Re-point chat_conversations.folder_id's foreign key to
--      `folders` instead of `chat_folders`.
--   3. For each user with conversations that have no folder, create
--      a single "LLM chats" library folder (also in their default
--      org) and drop those conversations into it.
--   4. Drop the now-unused `chat_folders` table.
-- ============================================================

-- ── 1. Copy chat folders into folders, preserving IDs ────────
-- Join against organizations to pick each user's default workspace
-- as the destination for the migrated folder. Every user has a
-- default org from migration 00026's backfill + auth.user trigger,
-- so the join always finds exactly one match.
insert into public.folders
  (id, user_id, parent_id, name, sort_order, org_id, created_at, updated_at)
select
  cf.id, cf.user_id, cf.parent_id, cf.name, 0, o.id, cf.created_at, cf.updated_at
from public.chat_folders cf
join public.organizations o
  on o.user_id = cf.user_id and o.is_default
on conflict (id) do nothing;

-- ── 2. Swap the FK target ────────────────────────────────────
alter table public.chat_conversations
  drop constraint if exists chat_conversations_folder_id_fkey;

alter table public.chat_conversations
  add constraint chat_conversations_folder_id_fkey
  foreign key (folder_id) references public.folders(id) on delete set null;

-- ── 3. Backfill an "LLM chats" folder per user with loose convos ─
-- The folder lives in the user's default org. Same join pattern as
-- above; if a user somehow has no default org we skip them rather
-- than abort the whole migration (defensive, shouldn't happen).
do $$
declare
  v_user_id uuid;
  v_org_id uuid;
  v_llm_folder_id uuid;
begin
  for v_user_id in
    select distinct user_id
    from public.chat_conversations
    where folder_id is null
  loop
    select id into v_org_id
      from public.organizations
     where user_id = v_user_id and is_default
     limit 1;
    if v_org_id is null then
      continue;
    end if;

    insert into public.folders (user_id, name, sort_order, org_id)
    values (v_user_id, 'LLM chats', 0, v_org_id)
    returning id into v_llm_folder_id;

    update public.chat_conversations
       set folder_id = v_llm_folder_id
     where user_id = v_user_id
       and folder_id is null;
  end loop;
end $$;

-- ── 4. Drop the old chat_folders table ───────────────────────
drop table if exists public.chat_folders cascade;
