-- ============================================================
-- Migration 00052: Spaces, public community / course hierarchy
--
-- A nestable, multi-user "space" tree that covers BOTH university
-- structure (BME org → VIK subspace → BSz1 course) AND subreddit-style
-- communities (Health org → Nutrition topic). ONE flexible primitive:
-- any space can nest children and (later) hold content; `kind` is just
-- a label. Separate from the existing single-owner personal
-- `organizations` (those stay a private workspace concept).
--
-- Phase 1a here: schema + membership + RLS + browse/create. Deferred:
-- offerings (time axis), role cascade / moderation, content scoping
-- (books/roadmaps/quizzes by space_id), anon (logged-out) public read,
-- nested-create UI.
--
-- RLS recursion note: membership-aware policies would recurse
-- (spaces↔space_members). We break it with SECURITY DEFINER helper
-- functions that query the tables directly (bypassing RLS), so the
-- policies never call back into each other.
-- ============================================================

create type space_kind as enum ('org', 'subspace', 'course', 'topic');
create type space_visibility as enum ('public', 'restricted', 'private');
create type space_role as enum ('owner', 'moderator', 'contributor', 'member');

create table public.spaces (
  id          uuid primary key default gen_random_uuid(),
  parent_id   uuid references public.spaces(id) on delete cascade,
  owner_id    uuid not null references auth.users on delete cascade,
  kind        space_kind not null default 'topic',
  name        text not null,
  -- Optional URL slug for a public page; unique (case-insensitive) when set.
  slug        text,
  description text,
  visibility  space_visibility not null default 'public',
  -- Verified/official badge (e.g. the real BME). Admin-only, enforced
  -- by protect_space_official() below; never self-grantable.
  official    boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index spaces_slug_unique on public.spaces (lower(slug)) where slug is not null;
create index spaces_parent_idx on public.spaces (parent_id);
create index spaces_owner_idx on public.spaces (owner_id);
create index spaces_visibility_idx on public.spaces (visibility);

create table public.space_members (
  space_id   uuid not null references public.spaces(id) on delete cascade,
  user_id    uuid not null references auth.users on delete cascade,
  role       space_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (space_id, user_id)
);
create index space_members_user_idx on public.space_members (user_id);

create trigger spaces_set_updated_at
  before update on public.spaces
  for each row execute function public.set_updated_at();

-- ── SECURITY DEFINER helpers (bypass RLS → no policy recursion) ──

create or replace function public.space_is_public(p_space uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from public.spaces where id = p_space and visibility = 'public'
  );
$$;

create or replace function public.is_space_owner(p_space uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from public.spaces where id = p_space and owner_id = auth.uid()
  );
$$;

create or replace function public.is_space_member(p_space uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from public.space_members
    where space_id = p_space and user_id = auth.uid()
  );
$$;

grant execute on function public.space_is_public(uuid) to authenticated;
grant execute on function public.is_space_owner(uuid) to authenticated;
grant execute on function public.is_space_member(uuid) to authenticated;

-- ── Triggers: owner auto-membership + official protection ──

create or replace function public.spaces_add_owner_member()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.space_members (space_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict do nothing;
  return new;
end;
$$;
create trigger spaces_add_owner_member
  after insert on public.spaces
  for each row execute function public.spaces_add_owner_member();

-- "official" is admin-only: force false for anyone but the service role.
create or replace function public.protect_space_official()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.official := false;
  else
    new.official := old.official;
  end if;
  return new;
end;
$$;
create trigger protect_space_official
  before insert or update on public.spaces
  for each row execute function public.protect_space_official();

-- ── RLS ─────────────────────────────────────────────────────
alter table public.spaces enable row level security;
alter table public.space_members enable row level security;

create policy "spaces_select" on public.spaces for select to authenticated
  using (
    visibility = 'public'
    or owner_id = auth.uid()
    or public.is_space_member(id)
  );
create policy "spaces_insert" on public.spaces for insert to authenticated
  with check (owner_id = auth.uid());
create policy "spaces_update" on public.spaces for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());
create policy "spaces_delete" on public.spaces for delete to authenticated
  using (owner_id = auth.uid());

create policy "space_members_select" on public.space_members for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_space_owner(space_id)
    or public.space_is_public(space_id)
  );
-- Self-join a PUBLIC space, or the owner adds anyone.
create policy "space_members_insert" on public.space_members for insert to authenticated
  with check (
    (user_id = auth.uid() and public.space_is_public(space_id))
    or public.is_space_owner(space_id)
  );
-- Leave a space, or the owner removes anyone.
create policy "space_members_delete" on public.space_members for delete to authenticated
  using (user_id = auth.uid() or public.is_space_owner(space_id));
-- Only the owner changes roles (v1).
create policy "space_members_update" on public.space_members for update to authenticated
  using (public.is_space_owner(space_id))
  with check (public.is_space_owner(space_id));
