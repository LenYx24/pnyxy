-- ============================================================
-- 00073_edge_rate_limits.sql
-- Generic per-key daily rate limiter for edge functions that don't
-- already have a purpose-built quota table: send-feedback (10/day
-- signed-in, 2/day anon by hashed IP) and ingest-url (30/day
-- signed-in). One row per (key, day); bump_rate_limit atomically
-- increments the counter and returns whether the caller is still
-- under p_limit.
--
-- SECURITY DEFINER so the increment is race-safe under concurrent
-- requests (single upsert with ON CONFLICT DO UPDATE), granted to
-- service_role only: edge functions call it with the service-role
-- client, never a user-scoped one, so a signed-in user can't bump
-- another user's key or otherwise forge an always-allowed check.
-- ============================================================

create table if not exists public.edge_rate_limits (
  key          text not null,
  window_start date not null default current_date,
  count        int  not null default 0,
  primary key (key, window_start)
);

alter table public.edge_rate_limits enable row level security;
-- No policies: row level security with zero policies denies every
-- row to anon/authenticated. Only service_role (which bypasses RLS
-- entirely) and the SECURITY DEFINER function below can touch it.

create or replace function public.bump_rate_limit(p_key text, p_limit int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  insert into public.edge_rate_limits (key, window_start, count)
  values (p_key, current_date, 1)
  on conflict (key, window_start)
    do update set count = edge_rate_limits.count + 1
  returning count into v_count;

  return v_count <= p_limit;
end;
$$;

-- Functions are execute-able by PUBLIC by default in Postgres; strip
-- that and grant only to service_role.
revoke all on function public.bump_rate_limit(text, int) from public;
grant execute on function public.bump_rate_limit(text, int) to service_role;

revoke all on public.edge_rate_limits from anon, authenticated;
