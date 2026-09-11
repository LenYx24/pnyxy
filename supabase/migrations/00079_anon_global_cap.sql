-- Global daily cap for anonymous AI usage, on top of the per-IP bucket.
--
-- The per-IP anon quota (check_and_record_ai_usage_anon) is keyed on a
-- client-supplied, spoofable IP hash: an attacker can mint fresh buckets by
-- rotating the x-forwarded-for header. That's fine for deterring casual
-- scraping, but it does NOT bound the owner's total API spend. This adds a
-- hard ceiling on the SUM of anon tokens served per day across every bucket,
-- so signed-out "try it" traffic can never drain the owner's provider budget,
-- no matter how many IPs are faked. Raise/lower C_GLOBAL_ANON_DAILY_TOKENS as
-- the real anon volume becomes clear.
--
-- Re-defines the function from 00072 with the extra check inserted after the
-- per-IP checks pass and before the usage is recorded.

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
  -- Hard ceiling on total anon tokens served per UTC day (all buckets).
  -- ~2M tokens is well under a dollar/day of Flash-class usage, enough for
  -- a first-impression demo, and a firm stop against spoofed-IP abuse.
  c_global_daily_cap constant integer := 2000000;
  v_today        date := (now() at time zone 'utc')::date;
  v_token_limit  integer;
  v_req_limit    integer;
  v_global       bigint;
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

  -- Global backstop: total anon tokens across every bucket for today.
  select coalesce(sum(tokens_used), 0) into v_global
  from ai_usage_anon
  where usage_date = v_today;

  if v_global + p_tokens > c_global_daily_cap then
    return query select false, 'global_anon_limit_exceeded'::text,
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

revoke all on function public.check_and_record_ai_usage_anon(text, integer, text)
  from public, anon, authenticated;
