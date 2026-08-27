-- ============================================================
-- Migration 00072: security hardening (audit follow-up)
--
-- Idempotent on purpose (drop policy if exists / create or replace /
-- if not exists) so it can be re-run on a partially applied database.
--
-- Sections:
--   1. C1  profiles.role + preferences.features are no longer client-writable
--   2. C2  quota RPCs become service-role-only, bounded, refund-capped
--   3. C3  profiles are no longer world-readable; public_profiles view
--   4. H4  storage quota trusts storage.objects metadata, not the client
--   5. M4  spaces / space_members / shared_answers policies + join rate limit
--   6. L   search_path pins + owner-or-admin checks on storage helpers
--   7.     default privileges: new functions are not executable by clients
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- 1. C1: role escalation
--
-- "Users can update own profile" (00001) is row-level only, and the
-- billing trigger (00043/00049) does not cover `role` (00004) nor the
-- server-side feature unlock list in preferences.features
-- (src/lib/features.ts). A user could therefore promote themselves to
-- admin or self-unlock gated features. Reject (not revert) such changes
-- unless the caller is the service role or an admin.
-- ────────────────────────────────────────────────────────────

create or replace function public.protect_role_column()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_privileged boolean;
begin
  -- auth.role() is null in a direct DB session (SQL editor, migrations,
  -- seeds); those are trusted, this guard targets PostgREST callers.
  v_privileged := auth.role() is null
    or auth.role() = 'service_role'
    or public.is_admin();
  if v_privileged then
    return new;
  end if;

  if new.role is distinct from old.role then
    raise exception 'role_change_forbidden';
  end if;

  -- preferences.features is the server-side unlock list. Clients update
  -- preferences as a whole blob, so: a payload that omits the key keeps
  -- the server value (a stale client cache must not wipe an unlock), a
  -- payload that changes it is rejected.
  if new.preferences is null or not (new.preferences ? 'features') then
    if old.preferences is not null and (old.preferences ? 'features') then
      new.preferences := coalesce(new.preferences, '{}'::jsonb)
        || jsonb_build_object('features', old.preferences->'features');
    end if;
  elsif (new.preferences->'features') is distinct from (old.preferences->'features') then
    raise exception 'features_change_forbidden';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_role_column on public.profiles;
create trigger protect_role_column
  before update on public.profiles
  for each row execute function public.protect_role_column();

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);


-- ────────────────────────────────────────────────────────────
-- 2. C2: quota RPCs
--
-- check_and_record_ai_usage_user(integer,text) (00042) and
-- refund_ai_usage_user(integer,text) (00062) were executable by
-- `authenticated` with unbounded token counts: a user could refund
-- themselves an unlimited quota. The proxy is the only legitimate
-- caller, so the RPCs now take an explicit user id, are callable by
-- the service role only, validate the token count, and a refund can
-- never exceed the last charge on that bucket.
-- ────────────────────────────────────────────────────────────

alter table public.ai_usage_user
  add column if not exists last_charge_tokens integer not null default 0;
alter table public.ai_usage_anon
  add column if not exists last_charge_tokens integer not null default 0;

-- Old client-callable signatures: revoke (when still present), then drop.
do $$
begin
  if to_regprocedure('public.check_and_record_ai_usage_user(integer, text)') is not null then
    revoke execute on function public.check_and_record_ai_usage_user(integer, text)
      from public, anon, authenticated;
  end if;
  if to_regprocedure('public.refund_ai_usage_user(integer, text)') is not null then
    revoke execute on function public.refund_ai_usage_user(integer, text)
      from public, anon, authenticated;
  end if;
end;
$$;
drop function if exists public.check_and_record_ai_usage_user(integer, text);
drop function if exists public.refund_ai_usage_user(integer, text);

create or replace function public.check_and_record_ai_usage_user(
  p_user_id uuid,
  p_tokens  integer,
  p_model   text default 'auto'
) returns table (
  allowed         boolean,
  reason          text,
  tokens_used     integer,
  request_count   integer,
  tokens_limit    integer,
  request_limit   integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today        date := (now() at time zone 'utc')::date;
  v_tier         text;
  v_token_limit  integer;
  v_req_limit    integer;
  v_row          ai_usage_user%rowtype;
begin
  if p_tokens is null or p_tokens < 1 or p_tokens > 2000000 then
    raise exception 'invalid_token_count';
  end if;

  if p_user_id is null then
    select lt.token_limit, lt.request_limit
      into v_token_limit, v_req_limit
    from _ai_usage_limits_for_model(p_model, 'free') lt;
    return query select false, 'not_authenticated'::text, 0, 0, v_token_limit, v_req_limit;
    return;
  end if;

  select storage_tier::text into v_tier from profiles where id = p_user_id;
  v_tier := coalesce(v_tier, 'free');

  select lt.token_limit, lt.request_limit
    into v_token_limit, v_req_limit
  from _ai_usage_limits_for_model(p_model, v_tier) lt;

  insert into ai_usage_user (user_id, usage_date, model)
  values (p_user_id, v_today, p_model)
  on conflict (user_id, usage_date, model) do nothing;

  select * into v_row
  from ai_usage_user
  where user_id = p_user_id
    and usage_date = v_today
    and model = p_model
  for update;

  if v_row.request_count + 1 > v_req_limit then
    return query select false, 'request_limit_exceeded'::text,
      v_row.tokens_used, v_row.request_count, v_token_limit, v_req_limit;
    return;
  end if;

  if v_row.tokens_used + p_tokens > v_token_limit then
    return query select false, 'token_limit_exceeded'::text,
      v_row.tokens_used, v_row.request_count, v_token_limit, v_req_limit;
    return;
  end if;

  update ai_usage_user
  set tokens_used        = ai_usage_user.tokens_used + p_tokens,
      request_count      = ai_usage_user.request_count + 1,
      last_charge_tokens = p_tokens,
      updated_at         = now()
  where user_id = p_user_id
    and usage_date = v_today
    and model = p_model
  returning * into v_row;

  return query select true, null::text,
    v_row.tokens_used, v_row.request_count, v_token_limit, v_req_limit;
end;
$$;

create or replace function public.refund_ai_usage_user(
  p_user_id uuid,
  p_tokens  integer,
  p_model   text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'utc')::date;
begin
  if p_tokens is null or p_tokens < 1 or p_tokens > 2000000 then
    raise exception 'invalid_token_count';
  end if;
  if p_user_id is null then
    return;
  end if;
  -- Cap at the last charge so a refund can never mint quota.
  update ai_usage_user
     set tokens_used        = greatest(tokens_used - least(p_tokens, last_charge_tokens), 0),
         request_count      = greatest(request_count - 1, 0),
         last_charge_tokens = 0
   where user_id = p_user_id
     and usage_date = v_today
     and model = p_model
     and last_charge_tokens > 0;
end;
$$;

create or replace function public.check_and_record_ai_usage_anon(
  p_ip_hash text,
  p_tokens  integer,
  p_model   text default 'auto'
) returns table (
  allowed         boolean,
  reason          text,
  tokens_used     integer,
  request_count   integer,
  tokens_limit    integer,
  request_limit   integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today        date := (now() at time zone 'utc')::date;
  v_token_limit  integer;
  v_req_limit    integer;
  v_row          ai_usage_anon%rowtype;
begin
  if p_tokens is null or p_tokens < 1 or p_tokens > 2000000 then
    raise exception 'invalid_token_count';
  end if;

  select lt.token_limit, lt.request_limit
    into v_token_limit, v_req_limit
  from _ai_usage_limits_for_model(p_model, 'anon') lt;

  if p_ip_hash is null or length(p_ip_hash) = 0 then
    return query select false, 'missing_ip'::text, 0, 0, v_token_limit, v_req_limit;
    return;
  end if;

  insert into ai_usage_anon (ip_hash, usage_date, model)
  values (p_ip_hash, v_today, p_model)
  on conflict (ip_hash, usage_date, model) do nothing;

  select * into v_row
  from ai_usage_anon
  where ip_hash = p_ip_hash
    and usage_date = v_today
    and model = p_model
  for update;

  if v_row.request_count + 1 > v_req_limit then
    return query select false, 'request_limit_exceeded'::text,
      v_row.tokens_used, v_row.request_count, v_token_limit, v_req_limit;
    return;
  end if;

  if v_row.tokens_used + p_tokens > v_token_limit then
    return query select false, 'token_limit_exceeded'::text,
      v_row.tokens_used, v_row.request_count, v_token_limit, v_req_limit;
    return;
  end if;

  update ai_usage_anon
  set tokens_used        = ai_usage_anon.tokens_used + p_tokens,
      request_count      = ai_usage_anon.request_count + 1,
      last_charge_tokens = p_tokens,
      updated_at         = now()
  where ip_hash = p_ip_hash
    and usage_date = v_today
    and model = p_model
  returning * into v_row;

  return query select true, null::text,
    v_row.tokens_used, v_row.request_count, v_token_limit, v_req_limit;
end;
$$;

create or replace function public.refund_ai_usage_anon(
  p_ip_hash text,
  p_tokens  integer,
  p_model   text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'utc')::date;
begin
  if p_tokens is null or p_tokens < 1 or p_tokens > 2000000 then
    raise exception 'invalid_token_count';
  end if;
  update ai_usage_anon
     set tokens_used        = greatest(tokens_used - least(p_tokens, last_charge_tokens), 0),
         request_count      = greatest(request_count - 1, 0),
         last_charge_tokens = 0
   where ip_hash = p_ip_hash
     and usage_date = v_today
     and model = p_model
     and last_charge_tokens > 0;
end;
$$;

-- Service role only for every quota-mutating RPC.
revoke execute on function public.check_and_record_ai_usage_user(uuid, integer, text)
  from public, anon, authenticated;
revoke execute on function public.refund_ai_usage_user(uuid, integer, text)
  from public, anon, authenticated;
revoke execute on function public.check_and_record_ai_usage_anon(text, integer, text)
  from public, anon, authenticated;
revoke execute on function public.refund_ai_usage_anon(text, integer, text)
  from public, anon, authenticated;
grant execute on function public.check_and_record_ai_usage_user(uuid, integer, text) to service_role;
grant execute on function public.refund_ai_usage_user(uuid, integer, text) to service_role;
grant execute on function public.check_and_record_ai_usage_anon(text, integer, text) to service_role;
grant execute on function public.refund_ai_usage_anon(text, integer, text) to service_role;

-- The read-only usage RPC (Settings > AI usage, composer quota bar)
-- stays client-callable; it only reports auth.uid()'s own rows.
grant execute on function public.get_my_ai_usage_today() to authenticated;


-- ────────────────────────────────────────────────────────────
-- 3. C3: profiles exposure
--
-- "Public profile fields readable by all" (00010) exposed EVERY column
-- of profiles (email-adjacent data, billing ids, role, preferences) to
-- any signed-in user. Replace it with a view that projects only the
-- public columns. The view runs as its owner (security_invoker = false)
-- so it can read the table regardless of the caller's RLS.
-- ────────────────────────────────────────────────────────────

drop policy if exists "Public profile fields readable by all" on public.profiles;

create or replace view public.public_profiles
with (security_invoker = false)
as
  select id, display_name, avatar_url, created_at
  from public.profiles;

grant select on public.public_profiles to anon, authenticated;


-- ────────────────────────────────────────────────────────────
-- 4. H4: storage quota
--
-- check_storage_limit (00006) trusted the client-supplied size_bytes;
-- a client could insert size_bytes = 0 for a 2 GB upload. Take the
-- size from the already-uploaded storage object instead (the client
-- uploads to `book-files` BEFORE inserting the book_files row, see
-- src/stores/upload-store.ts and src/features/book/AttachFileButton.tsx).
-- The service role (seeds, admin tooling) keeps the supplied value.
-- ────────────────────────────────────────────────────────────

-- Internal, unchecked helpers for the trigger (execute revoked below).
create or replace function public._storage_usage_unchecked(uid uuid)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(bf.size_bytes), 0)::bigint
  from book_files bf
  join books b on b.id = bf.book_id
  where b.user_id = uid;
$$;

create or replace function public._storage_limit_unchecked(uid uuid)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select case p.storage_tier
    when 'free'    then 104857600    -- 100 MB
    when 'premium' then 26843545600  -- 25 GB
  end
  from profiles p
  where p.id = uid;
$$;

revoke execute on function public._storage_usage_unchecked(uuid) from public, anon, authenticated;
revoke execute on function public._storage_limit_unchecked(uuid) from public, anon, authenticated;

create or replace function public.check_storage_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_id      uuid;
  current_usage bigint;
  max_limit     bigint;
  object_size   bigint;
begin
  select b.user_id into owner_id
  from books b where b.id = new.book_id;

  -- Null auth.role() = direct DB session (seeds, SQL editor): trusted.
  if auth.role() is not null and auth.role() <> 'service_role' then
    select (o.metadata->>'size')::bigint into object_size
    from storage.objects o
    where o.bucket_id = 'book-files'
      and o.name = new.storage_path;
    if object_size is null then
      raise exception 'object_not_found';
    end if;
    new.size_bytes := object_size;
  end if;

  current_usage := public._storage_usage_unchecked(owner_id);
  max_limit     := public._storage_limit_unchecked(owner_id);

  if (current_usage + coalesce(new.size_bytes, 0)) > max_limit then
    raise exception 'Storage limit exceeded. Used: % bytes, Limit: % bytes', current_usage, max_limit;
  end if;

  return new;
end;
$$;

-- Trigger enforce_storage_limit (00006) references the function by name.


-- ────────────────────────────────────────────────────────────
-- 5. M4: spaces
-- ────────────────────────────────────────────────────────────

-- Self-join is member-role only; the owner can add anyone with any role.
drop policy if exists "space_members_insert" on public.space_members;
create policy "space_members_insert" on public.space_members
  for insert to authenticated
  with check (
    (user_id = auth.uid() and role = 'member' and public.space_is_public(space_id))
    or public.is_space_owner(space_id)
  );

-- A child space can only be attached under a space you own (no
-- squatting inside someone else's org tree). Admins are exempt.
drop policy if exists "spaces_insert" on public.spaces;
create policy "spaces_insert" on public.spaces
  for insert to authenticated
  with check (
    public.is_admin()
    or (
      owner_id = auth.uid()
      and (parent_id is null or public.is_space_owner(parent_id))
    )
  );

drop policy if exists "spaces_update" on public.spaces;
create policy "spaces_update" on public.spaces
  for update to authenticated
  using (owner_id = auth.uid() or public.is_admin())
  with check (
    public.is_admin()
    or (
      owner_id = auth.uid()
      and (parent_id is null or public.is_space_owner(parent_id))
    )
  );

-- Only share into a space you belong to.
drop policy if exists "share own answer" on public.shared_answers;
create policy "share own answer"
  on public.shared_answers for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and (
      space_id is null
      or public.is_space_member(space_id)
      or public.is_space_owner(space_id)
    )
  );

drop policy if exists "space owner deletes shared answer" on public.shared_answers;
create policy "space owner deletes shared answer"
  on public.shared_answers for delete
  to authenticated
  using (space_id is not null and public.is_space_owner(space_id));

-- Invite-code join rate limit. Codes stay 8 hex chars (32 bits) for
-- now, owners can rotate them; the follow-up is 128-bit codes
-- (rotate_space_invite_code in 00065) once the pilot links are
-- reissued. Until then, brute force is throttled per user.
create table if not exists public.space_join_attempts (
  user_id      uuid not null references auth.users(id) on delete cascade,
  attempted_at timestamptz not null default now()
);
create index if not exists space_join_attempts_user_time_idx
  on public.space_join_attempts (user_id, attempted_at);
alter table public.space_join_attempts enable row level security;
-- No policies: only join_space_with_code (security definer) touches it.

create or replace function public.join_space_with_code(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user  uuid := auth.uid();
  v_space uuid;
  v_fails integer;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  select count(*) into v_fails
  from public.space_join_attempts
  where user_id = v_user
    and attempted_at > now() - interval '1 hour';
  if v_fails > 10 then
    raise exception 'too_many_attempts';
  end if;

  select id into v_space
  from public.spaces
  where invite_code = lower(trim(p_code));

  if v_space is null then
    insert into public.space_join_attempts (user_id) values (v_user);
    raise exception 'invalid_invite_code';
  end if;

  insert into public.space_members (space_id, user_id, role)
  values (v_space, v_user, 'member')
  on conflict do nothing;

  delete from public.space_join_attempts where user_id = v_user;
  return v_space;
end;
$$;
grant execute on function public.join_space_with_code(text) to authenticated;


-- ────────────────────────────────────────────────────────────
-- 6. L: storage helpers are owner-or-admin only, search_path pinned
--
-- get_user_storage_usage / get_user_storage_limit (00006, 00042) are
-- SECURITY DEFINER with no caller check: anyone could look up another
-- user's storage tier and usage by id. The client only ever asks for
-- its own (src/stores/upload-store.ts).
-- ────────────────────────────────────────────────────────────

create or replace function public.get_user_storage_usage(uid uuid)
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if uid is distinct from auth.uid() and not public.is_admin() then
    raise exception 'forbidden';
  end if;
  return public._storage_usage_unchecked(uid);
end;
$$;

create or replace function public.get_user_storage_limit(uid uuid)
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if uid is distinct from auth.uid() and not public.is_admin() then
    raise exception 'forbidden';
  end if;
  return public._storage_limit_unchecked(uid);
end;
$$;

grant execute on function public.get_user_storage_usage(uuid) to authenticated;
grant execute on function public.get_user_storage_limit(uuid) to authenticated;

-- Pin search_path on the older SECURITY DEFINER trigger function too.
alter function public.protect_billing_columns() set search_path = public;


-- ────────────────────────────────────────────────────────────
-- 7. Default privileges
--
-- Postgres grants EXECUTE on new functions to PUBLIC by default, which
-- is why every RPC was client-callable unless someone remembered to
-- revoke. From now on functions created by the migration role start
-- out non-executable for clients: every future migration must grant
-- execute to authenticated / anon / service_role explicitly.
-- ────────────────────────────────────────────────────────────

alter default privileges in schema public
  revoke execute on functions from public, anon, authenticated;
