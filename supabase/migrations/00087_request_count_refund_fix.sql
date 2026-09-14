-- ============================================================
-- Migration 00087: stop the token-refund from cancelling the
-- request count.
--
-- The proxy pre-bills (input + maxOutputTokens) then, after EVERY
-- successful stream, refunds the unused output tokens
-- (refundUsage(model, unused) in ai-chat-proxy). The refund also did
-- `request_count = request_count - 1`, so each successful turn was
-- +1 (check_and_record) then -1 (refund) = net 0. The result: the
-- per-model request_count never grew, so "N questions left today"
-- never went down (e.g. it sat at the model's request cap forever).
--
-- Fix: only decrement request_count on a FULL refund, i.e. when the
-- refunded amount covers the whole last charge. A total upstream
-- failure refunds the full estimatedTotal (p_tokens >= last_charge_tokens)
-- and should undo the attempt so the auto-route fallback does not count
-- a model that never served. A success refunds only the unused output
-- (p_tokens < last_charge_tokens) and must keep the request counted.
-- Token-capping and the last_charge_tokens one-shot guard are unchanged.
-- ============================================================

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
  -- Cap at the last charge so a refund can never mint quota. Only a full
  -- refund (a failed attempt) rolls back the request count; a partial
  -- success refund of unused output tokens leaves the request counted.
  update ai_usage_user
     set tokens_used        = greatest(tokens_used - least(p_tokens, last_charge_tokens), 0),
         request_count      = greatest(
           request_count - (case when p_tokens >= last_charge_tokens then 1 else 0 end),
           0
         ),
         last_charge_tokens = 0
   where user_id = p_user_id
     and usage_date = v_today
     and model = p_model
     and last_charge_tokens > 0;
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
         request_count      = greatest(
           request_count - (case when p_tokens >= last_charge_tokens then 1 else 0 end),
           0
         ),
         last_charge_tokens = 0
   where ip_hash = p_ip_hash
     and usage_date = v_today
     and model = p_model
     and last_charge_tokens > 0;
end;
$$;
