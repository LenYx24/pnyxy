-- ============================================================
-- Migration 00011: fix ambiguous column references in
-- check_and_record_ai_usage_{user,anon}.
--
-- The RETURNS TABLE clause declares OUT params named
-- `tokens_used` and `request_count` that collide with the
-- same-named columns on ai_usage_user / ai_usage_anon,
-- making the UPDATE ... SET tokens_used = tokens_used + ...
-- ambiguous. Qualify the RHS with the table name.
-- ============================================================

CREATE OR REPLACE FUNCTION check_and_record_ai_usage_user(
  p_tokens integer
) RETURNS TABLE (
  allowed         boolean,
  reason          text,
  tokens_used     integer,
  request_count   integer,
  tokens_limit    integer,
  request_limit   integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id      uuid := auth.uid();
  v_today        date := (now() AT TIME ZONE 'utc')::date;
  v_token_limit  constant integer := 50000;
  v_req_limit    constant integer := 200;
  v_row          ai_usage_user%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN QUERY SELECT false, 'not_authenticated'::text, 0, 0, v_token_limit, v_req_limit;
    RETURN;
  END IF;

  INSERT INTO ai_usage_user (user_id, usage_date)
  VALUES (v_user_id, v_today)
  ON CONFLICT (user_id, usage_date) DO NOTHING;

  SELECT * INTO v_row
  FROM ai_usage_user
  WHERE user_id = v_user_id AND usage_date = v_today
  FOR UPDATE;

  IF v_row.request_count + 1 > v_req_limit THEN
    RETURN QUERY SELECT false, 'request_limit_exceeded'::text,
      v_row.tokens_used, v_row.request_count, v_token_limit, v_req_limit;
    RETURN;
  END IF;

  IF v_row.tokens_used + p_tokens > v_token_limit THEN
    RETURN QUERY SELECT false, 'token_limit_exceeded'::text,
      v_row.tokens_used, v_row.request_count, v_token_limit, v_req_limit;
    RETURN;
  END IF;

  UPDATE ai_usage_user
  SET tokens_used   = ai_usage_user.tokens_used + p_tokens,
      request_count = ai_usage_user.request_count + 1,
      updated_at    = now()
  WHERE user_id = v_user_id AND usage_date = v_today
  RETURNING * INTO v_row;

  RETURN QUERY SELECT true, NULL::text,
    v_row.tokens_used, v_row.request_count, v_token_limit, v_req_limit;
END;
$$;

CREATE OR REPLACE FUNCTION check_and_record_ai_usage_anon(
  p_ip_hash text,
  p_tokens  integer
) RETURNS TABLE (
  allowed         boolean,
  reason          text,
  tokens_used     integer,
  request_count   integer,
  tokens_limit    integer,
  request_limit   integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today        date := (now() AT TIME ZONE 'utc')::date;
  v_token_limit  constant integer := 5000;
  v_req_limit    constant integer := 5;
  v_row          ai_usage_anon%ROWTYPE;
BEGIN
  IF p_ip_hash IS NULL OR length(p_ip_hash) = 0 THEN
    RETURN QUERY SELECT false, 'missing_ip'::text, 0, 0, v_token_limit, v_req_limit;
    RETURN;
  END IF;

  INSERT INTO ai_usage_anon (ip_hash, usage_date)
  VALUES (p_ip_hash, v_today)
  ON CONFLICT (ip_hash, usage_date) DO NOTHING;

  SELECT * INTO v_row
  FROM ai_usage_anon
  WHERE ip_hash = p_ip_hash AND usage_date = v_today
  FOR UPDATE;

  IF v_row.request_count + 1 > v_req_limit THEN
    RETURN QUERY SELECT false, 'request_limit_exceeded'::text,
      v_row.tokens_used, v_row.request_count, v_token_limit, v_req_limit;
    RETURN;
  END IF;

  IF v_row.tokens_used + p_tokens > v_token_limit THEN
    RETURN QUERY SELECT false, 'token_limit_exceeded'::text,
      v_row.tokens_used, v_row.request_count, v_token_limit, v_req_limit;
    RETURN;
  END IF;

  UPDATE ai_usage_anon
  SET tokens_used   = ai_usage_anon.tokens_used + p_tokens,
      request_count = ai_usage_anon.request_count + 1,
      updated_at    = now()
  WHERE ip_hash = p_ip_hash AND usage_date = v_today
  RETURNING * INTO v_row;

  RETURN QUERY SELECT true, NULL::text,
    v_row.tokens_used, v_row.request_count, v_token_limit, v_req_limit;
END;
$$;
