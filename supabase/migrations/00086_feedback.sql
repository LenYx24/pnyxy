-- User feedback / bug reports. Written by the send-feedback edge function
-- (service role) for BOTH signed-in and anonymous senders, so email delivery
-- (Resend) is best-effort and never the only record. The sender (when signed
-- in) sees their own rows on /feedback; admins triage all of them.
create table if not exists public.feedback (
  id         uuid primary key default gen_random_uuid(),
  -- nullable: anonymous feedback has no account.
  user_id    uuid references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  kind       text not null default 'bug' check (kind in ('bug', 'idea', 'other')),
  subject    text,
  body       text not null,
  page_url   text,
  -- salted hash of the sender's IP for anonymous rows (never the raw IP), for
  -- abuse triage; null for signed-in rows.
  ip_hash    text,
  status     text not null default 'open'
    check (status in ('open', 'planned', 'in_progress', 'done', 'declined'))
);

create index if not exists feedback_user_created_idx
  on public.feedback (user_id, created_at desc);
create index if not exists feedback_created_idx
  on public.feedback (created_at desc);

alter table public.feedback enable row level security;

-- Signed-in users read only their own rows. Inserts happen via the edge
-- function with the service role (which bypasses RLS), so there is no
-- client-facing insert policy.
create policy "feedback_select_own" on public.feedback
  for select to authenticated
  using (user_id = auth.uid());

-- Admins read everything (triage). Reuses the existing is_admin() helper
-- (migration 00004); status is admin-updated later, out of band.
create policy "feedback_select_admin" on public.feedback
  for select to authenticated
  using (public.is_admin());

grant select on public.feedback to authenticated;
