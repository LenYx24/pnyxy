-- ============================================================
-- 00026_organizations.sql
-- Personal organizations / workspaces.
--
-- An organization is a single-owner namespace ("Personal",
-- "School", "Work") used to group user-owned content. v1 ships
-- only the container, no scoping of existing tables yet, so
-- switching orgs is a no-op for content visibility. Per-feature
-- scoping (library_folders, user_books, quizzes, reading_plans,
-- vocab, whiteboards, mind maps) lands in follow-up migrations
-- so each table's RLS + backfill can be reviewed in isolation.
--
-- Multi-user sharing is intentionally not modelled here. Each
-- org has exactly one user_id. When sharing arrives, this column
-- becomes the creator and a separate `organization_members`
-- table introduces membership without breaking existing rows.
-- ============================================================

create table public.organizations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade,
  name        text not null,
  -- Palette key (purple, blue, ...) reused from plan-colors so the
  -- whole app speaks the same color vocabulary. Nullable for "no
  -- color" / neutral.
  color       text,
  -- Exactly one default org per user (see partial unique index).
  -- The default org is auto-created on signup and cannot be deleted
  --, only renamed / recolored.
  is_default  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index organizations_user_default_idx
  on public.organizations (user_id) where is_default;

create index organizations_user_id_idx on public.organizations (user_id);

create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();

-- ── Auto-create a default org on signup ─────────────────────
create or replace function public.organizations_create_default()
returns trigger as $$
begin
  insert into public.organizations (user_id, name, is_default)
  values (new.id, 'Personal', true);
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger on_auth_user_created_make_default_org
  after insert on auth.users
  for each row execute function public.organizations_create_default();

-- Backfill: every existing user that doesn't already have a default
-- org gets a "Personal" one. Skipped if the trigger already covered
-- them (idempotent for re-runs and partial-rollback recovery).
insert into public.organizations (user_id, name, is_default)
select u.id, 'Personal', true
from auth.users u
where not exists (
  select 1 from public.organizations o
  where o.user_id = u.id and o.is_default
);

-- ── RLS ─────────────────────────────────────────────────────
alter table public.organizations enable row level security;

create policy "Organizations readable by owner"
  on public.organizations for select
  to authenticated
  using (user_id = auth.uid());

create policy "Organizations insertable by owner"
  on public.organizations for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "Organizations updatable by owner"
  on public.organizations for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "Organizations deletable by owner (non-default)"
  on public.organizations for delete
  to authenticated
  using (user_id = auth.uid() and is_default = false);
