-- ============================================================
-- Migration: Admin roles, user reports & bans
-- ============================================================

-- ── 1. User roles ───────────────────────────────────────────

create type public.user_role as enum ('user', 'admin');

alter table public.profiles
  add column role public.user_role not null default 'user';

-- Helper: returns true when the current JWT user is an admin.
-- SECURITY DEFINER so RLS policies can call it without extra grants.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'
  );
$$;

-- Admin RLS on profiles: admins can view all profiles
create policy "Admins can view all profiles"
  on public.profiles for select
  using ( public.is_admin() );

-- Admin RLS on profiles: admins can update any profile
create policy "Admins can update any profile"
  on public.profiles for update
  using ( public.is_admin() );

-- ── 2. Admin RLS for catalog_books ──────────────────────────

create policy "Admins can read all catalog books"
  on public.catalog_books for select
  using ( public.is_admin() );

create policy "Admins can update any catalog book"
  on public.catalog_books for update
  using ( public.is_admin() );

-- ── 3. User reports ─────────────────────────────────────────

create type public.report_status as enum (
  'pending', 'dismissed', 'warned', 'temp_banned', 'permabanned'
);

create table public.user_reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reported_user_id uuid not null references public.profiles(id) on delete cascade,
  reasons     text[] not null default '{}',
  message     text,
  status      public.report_status not null default 'pending',
  admin_action text,
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  created_at  timestamptz not null default now(),

  constraint no_self_report check (reporter_id <> reported_user_id)
);

-- Prevent duplicate pending reports from the same reporter → reported pair
create unique index idx_one_pending_report_per_pair
  on public.user_reports (reporter_id, reported_user_id)
  where status = 'pending';

alter table public.user_reports enable row level security;

-- Users can insert reports (but not self-reports — enforced by check constraint)
create policy "Users can create reports"
  on public.user_reports for insert
  with check ( auth.uid() = reporter_id );

-- Users can read their own reports
create policy "Users can read own reports"
  on public.user_reports for select
  using ( auth.uid() = reporter_id );

-- Admins can read all reports
create policy "Admins can read all reports"
  on public.user_reports for select
  using ( public.is_admin() );

-- Admins can update any report (resolve)
create policy "Admins can update any report"
  on public.user_reports for update
  using ( public.is_admin() );

-- ── 4. User bans ────────────────────────────────────────────

create table public.user_bans (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  reason      text not null,
  banned_by   uuid not null references public.profiles(id) on delete set null,
  banned_until timestamptz, -- null = permaban
  created_at  timestamptz not null default now()
);

alter table public.user_bans enable row level security;

-- Users can read their own bans
create policy "Users can read own bans"
  on public.user_bans for select
  using ( auth.uid() = user_id );

-- Admins can full CRUD on bans
create policy "Admins can read all bans"
  on public.user_bans for select
  using ( public.is_admin() );

create policy "Admins can insert bans"
  on public.user_bans for insert
  with check ( public.is_admin() );

create policy "Admins can update bans"
  on public.user_bans for update
  using ( public.is_admin() );

create policy "Admins can delete bans"
  on public.user_bans for delete
  using ( public.is_admin() );

-- Helper: returns true when a given user has an active ban
create or replace function public.is_banned(check_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_bans
    where user_id = check_user_id
      and (banned_until is null or banned_until > now())
  );
$$;
