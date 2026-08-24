-- ============================================================
-- 00056_offerings.sql
-- Course "offerings": the time axis for a course space, its runs per
-- term/year (e.g. "2025 ősz"). MVP is informational (term label + dates
-- + status shown on the course page); per-offering enrollment +
-- scheduling of due dates lands later.
-- ============================================================

create type public.offering_status as enum ('draft', 'active', 'archived');

create table public.offerings (
  id          uuid primary key default gen_random_uuid(),
  space_id    uuid not null references public.spaces(id) on delete cascade,
  term_label  text not null,
  starts_at   date,
  ends_at     date,
  status      public.offering_status not null default 'active',
  sort_order  double precision not null default 0,
  created_at  timestamptz not null default now()
);

create index offerings_space_idx on public.offerings (space_id, sort_order);

-- ── RLS ───────────────────────────────────────────────────
alter table public.offerings enable row level security;

create policy "read offerings"
  on public.offerings for select
  to authenticated
  using (
    public.space_is_public(space_id)
    or public.is_space_member(space_id)
    or public.is_space_owner(space_id)
  );

create policy "owner inserts offerings"
  on public.offerings for insert
  to authenticated
  with check (public.is_space_owner(space_id));

create policy "owner updates offerings"
  on public.offerings for update
  to authenticated
  using (public.is_space_owner(space_id))
  with check (public.is_space_owner(space_id));

create policy "owner deletes offerings"
  on public.offerings for delete
  to authenticated
  using (public.is_space_owner(space_id));
