-- ============================================================
-- 00022_user_whiteboards.sql
-- Cloud sync for whiteboards (previously IndexedDB-only).
--
-- One row per whiteboard. The primary key matches the client-side
-- WhiteboardData.id (UUID) so local IDB and Supabase share the same
-- identifiers, the client upserts by id and nothing else changes.
--
-- Data is stored as jsonb (the full WhiteboardData blob including
-- elements[], background, title, etc.). We don't break out elements
-- into rows because (a) whiteboards are typically <100 KB, (b)
-- element shapes evolve and a jsonb blob migrates more gracefully
-- than a normalized schema.
--
-- Quota: free tier is capped at 50 whiteboards per user via a
-- BEFORE INSERT trigger. The cap is intentionally generous; going
-- higher is a Premium perk.
-- ============================================================

create table public.user_whiteboards (
  id          uuid primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  title       text not null,
  data        jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index user_whiteboards_user_idx
  on public.user_whiteboards (user_id, updated_at desc);

create trigger user_whiteboards_set_updated_at
  before update on public.user_whiteboards
  for each row execute function public.set_updated_at();

-- ── Quota: 50 whiteboards per user on the free tier ──────────
--
-- Runs BEFORE INSERT so the row never lands when the user is over
-- the cap. Upserts (same id) are fine, they hit UPDATE, not INSERT.
--
-- SECURITY DEFINER because the counting query needs to see all
-- rows for that user_id regardless of the invoking policy set.

create or replace function public.enforce_whiteboard_quota()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
  v_limit constant int := 50;
begin
  select count(*) into v_count
    from public.user_whiteboards
   where user_id = new.user_id;
  if v_count >= v_limit then
    raise exception 'whiteboard_quota_exceeded: max % whiteboards per user', v_limit
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger user_whiteboards_enforce_quota
  before insert on public.user_whiteboards
  for each row execute function public.enforce_whiteboard_quota();

-- ── RLS ───────────────────────────────────────────────────

alter table public.user_whiteboards enable row level security;

create policy "Users manage their own whiteboards"
  on public.user_whiteboards for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
