-- ============================================================
-- 00027_org_scope_library.sql
-- Scope library content (folders, uploaded books, catalog
-- additions) to the owner's organizations.
--
-- Done in three explicit steps so the migration is safe to apply
-- to a populated database:
--   1. Add `org_id` as NULLABLE.
--   2. Backfill: every existing row gets its user's default org.
--   3. Tighten to NOT NULL and add the (user_id, org_id) index
--      that the app's filtered fetches will use.
--
-- A trigger then asserts that whatever `org_id` is written
-- actually belongs to the same user_id, so a malicious client
-- can't stamp someone else's org id even though RLS only checks
-- user_id ownership.
-- ============================================================

-- Step 1: add nullable columns. ON DELETE CASCADE so dropping an
-- org also drops its content (which the user can recover by
-- creating a new org and re-importing, same model as Notion's
-- workspace deletion).
alter table public.folders
  add column org_id uuid references public.organizations(id) on delete cascade;
alter table public.books
  add column org_id uuid references public.organizations(id) on delete cascade;
alter table public.user_library
  add column org_id uuid references public.organizations(id) on delete cascade;

-- Step 2: backfill. The previous migration (00026) ensured every
-- user has exactly one default org, so the subquery resolves
-- deterministically.
update public.folders f
   set org_id = (
     select id from public.organizations
      where user_id = f.user_id and is_default
      limit 1
   )
 where org_id is null;

update public.books b
   set org_id = (
     select id from public.organizations
      where user_id = b.user_id and is_default
      limit 1
   )
 where org_id is null;

update public.user_library ul
   set org_id = (
     select id from public.organizations
      where user_id = ul.user_id and is_default
      limit 1
   )
 where org_id is null;

-- Step 3: NOT NULL + indexes.
alter table public.folders      alter column org_id set not null;
alter table public.books        alter column org_id set not null;
alter table public.user_library alter column org_id set not null;

create index folders_user_org_idx
  on public.folders (user_id, org_id);
create index books_user_org_idx
  on public.books (user_id, org_id);
create index user_library_user_org_idx
  on public.user_library (user_id, org_id);

-- ── Cross-user safety guard ─────────────────────────────────
-- RLS only checks user_id = auth.uid(); the database doesn't
-- otherwise verify that the chosen org_id actually belongs to
-- the same user. This trigger raises an exception when a row
-- tries to land an org_id owned by someone else.
create or replace function public.assert_org_belongs_to_user()
returns trigger as $$
begin
  if new.org_id is null then return new; end if;
  if not exists (
    select 1 from public.organizations o
    where o.id = new.org_id and o.user_id = new.user_id
  ) then
    raise exception
      'org_id % does not belong to user_id %', new.org_id, new.user_id;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger folders_assert_org_owner
  before insert or update of org_id, user_id on public.folders
  for each row execute function public.assert_org_belongs_to_user();
create trigger books_assert_org_owner
  before insert or update of org_id, user_id on public.books
  for each row execute function public.assert_org_belongs_to_user();
create trigger user_library_assert_org_owner
  before insert or update of org_id, user_id on public.user_library
  for each row execute function public.assert_org_belongs_to_user();
