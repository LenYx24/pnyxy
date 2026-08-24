-- ============================================================
-- Migration 00042: premium-tier limits (storage + AI quota)
--
-- Until now `profiles.storage_tier` ('free' | 'premium') only
-- changed the storage cap; AI quotas were identical for every
-- authenticated user. This migration makes the paid tier actually
-- worth paying for on BOTH axes:
--
--   1. Bump the premium storage cap 5 GB -> 25 GB.
--   2. Add a tier dimension to the per-model AI quota helper so
--      premium gets larger daily buckets than free.
--
-- Design notes:
--   * The AI helper is re-keyed from (model, is_anon boolean) to
--     (model, tier text) where tier in ('anon','free','premium').
--     This collapses the anon flag into the tier and, crucially,
--     makes adding a THIRD paid tier later (e.g. 'pro') a one-branch
--     change, no enum churn. `storage_tier` is the de-facto plan
--     column; it drives both storage and AI now.
--   * Premium AI buckets are ~4x the free buckets. The worst-case
--     daily spend at the cap is bounded (and the request caps do the
--     real abuse-limiting); typical usage is a tiny fraction of this.
--     Same accepted tradeoff the free tier already runs on.
-- ============================================================

-- ── 1. Storage: premium 5 GB -> 25 GB ─────────────────────────
-- CREATE OR REPLACE keeps existing GRANTs intact (the frontend
-- calls this via rpc() in upload-store.ts).

CREATE OR REPLACE FUNCTION get_user_storage_limit(uid uuid)
RETURNS bigint AS $$
  SELECT CASE p.storage_tier
    WHEN 'free'    THEN 104857600    -- 100 MB
    WHEN 'premium' THEN 26843545600  -- 25 GB
  END
  FROM profiles p
  WHERE p.id = uid;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ── 2. AI quota helper: re-key (model, is_anon) -> (model, tier) ─
--
-- The signature changes (boolean -> text), so the old overload must
-- be dropped rather than replaced. The three RPCs below are reissued
-- in the same transaction to call the new signature.

DROP FUNCTION IF EXISTS _ai_usage_limits_for_model(text, boolean);

CREATE OR REPLACE FUNCTION _ai_usage_limits_for_model(
  p_model text,
  p_tier  text
) RETURNS TABLE (
  token_limit   integer,
  request_limit integer
)
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  -- Anonymous (IP-bucketed) tier. Tiny buckets to deter scrapers;
  -- anon users can't sign costs away from us.
  IF p_tier = 'anon' THEN
    IF p_model = 'gemini-2.5-flash' THEN
      RETURN QUERY SELECT 20000, 20;
    ELSIF p_model = 'gemini-3-flash-preview' THEN
      RETURN QUERY SELECT 10000, 10;
    ELSE
      RETURN QUERY SELECT 5000, 5;
    END IF;
    RETURN;
  END IF;

  -- Premium tier. ~4x the free buckets. Worst-case daily spend at
  -- the cap (output-heavy): 2.5-flash ~$1.9, 3-flash ~$1.2,
  -- haiku ~$1.0, 4o-mini ~$0.10, bounded, request caps included.
  IF p_tier = 'premium' THEN
    IF p_model = 'gemini-2.5-flash' THEN
      RETURN QUERY SELECT 750000, 3000;
    ELSIF p_model = 'gemini-3-flash-preview' THEN
      RETURN QUERY SELECT 400000, 1500;
    ELSIF p_model = 'gpt-4o-mini' THEN
      RETURN QUERY SELECT 250000, 800;
    ELSIF p_model = 'claude-haiku-4-5' THEN
      RETURN QUERY SELECT 250000, 800;
    ELSE
      RETURN QUERY SELECT 250000, 800;
    END IF;
    RETURN;
  END IF;

  -- Free / authenticated default. Also the fallback for any unknown
  -- tier so a bad value degrades to the safe (smaller) bucket.
  IF p_model = 'gemini-2.5-flash' THEN
    RETURN QUERY SELECT 200000, 1000;
  ELSIF p_model = 'gemini-3-flash-preview' THEN
    RETURN QUERY SELECT 100000, 500;
  ELSIF p_model = 'gpt-4o-mini' THEN
    RETURN QUERY SELECT 50000, 200;
  ELSIF p_model = 'claude-haiku-4-5' THEN
    RETURN QUERY SELECT 50000, 200;
  ELSE
    RETURN QUERY SELECT 50000, 200;
  END IF;
END;
$$;

-- ── 3. Reissue the RPCs to resolve and pass the caller's tier ──

CREATE OR REPLACE FUNCTION check_and_record_ai_usage_user(
  p_tokens integer,
  p_model  text DEFAULT 'auto'
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
  v_tier         text;
  v_token_limit  integer;
  v_req_limit    integer;
  v_row          ai_usage_user%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    -- Report free-tier limits for the (rejected) unauthenticated path.
    SELECT lt.token_limit, lt.request_limit
      INTO v_token_limit, v_req_limit
    FROM _ai_usage_limits_for_model(p_model, 'free') lt;
    RETURN QUERY SELECT false, 'not_authenticated'::text, 0, 0, v_token_limit, v_req_limit;
    RETURN;
  END IF;

  -- Resolve the user's plan tier; fall back to 'free' if the profile
  -- row is somehow missing.
  SELECT storage_tier::text INTO v_tier FROM profiles WHERE id = v_user_id;
  v_tier := COALESCE(v_tier, 'free');

  SELECT lt.token_limit, lt.request_limit
    INTO v_token_limit, v_req_limit
  FROM _ai_usage_limits_for_model(p_model, v_tier) lt;

  INSERT INTO ai_usage_user (user_id, usage_date, model)
  VALUES (v_user_id, v_today, p_model)
  ON CONFLICT (user_id, usage_date, model) DO NOTHING;

  SELECT * INTO v_row
  FROM ai_usage_user
  WHERE user_id = v_user_id
    AND usage_date = v_today
    AND model = p_model
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
  WHERE user_id = v_user_id
    AND usage_date = v_today
    AND model = p_model
  RETURNING * INTO v_row;

  RETURN QUERY SELECT true, NULL::text,
    v_row.tokens_used, v_row.request_count, v_token_limit, v_req_limit;
END;
$$;

CREATE OR REPLACE FUNCTION check_and_record_ai_usage_anon(
  p_ip_hash text,
  p_tokens  integer,
  p_model   text DEFAULT 'auto'
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
  v_token_limit  integer;
  v_req_limit    integer;
  v_row          ai_usage_anon%ROWTYPE;
BEGIN
  SELECT lt.token_limit, lt.request_limit
    INTO v_token_limit, v_req_limit
  FROM _ai_usage_limits_for_model(p_model, 'anon') lt;

  IF p_ip_hash IS NULL OR length(p_ip_hash) = 0 THEN
    RETURN QUERY SELECT false, 'missing_ip'::text, 0, 0, v_token_limit, v_req_limit;
    RETURN;
  END IF;

  INSERT INTO ai_usage_anon (ip_hash, usage_date, model)
  VALUES (p_ip_hash, v_today, p_model)
  ON CONFLICT (ip_hash, usage_date, model) DO NOTHING;

  SELECT * INTO v_row
  FROM ai_usage_anon
  WHERE ip_hash = p_ip_hash
    AND usage_date = v_today
    AND model = p_model
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
  WHERE ip_hash = p_ip_hash
    AND usage_date = v_today
    AND model = p_model
  RETURNING * INTO v_row;

  RETURN QUERY SELECT true, NULL::text,
    v_row.tokens_used, v_row.request_count, v_token_limit, v_req_limit;
END;
$$;

-- Read RPC: report the limits for the caller's own tier so the
-- Settings -> AI usage bars reflect what premium users actually get.
DROP FUNCTION IF EXISTS get_my_ai_usage_today();

CREATE OR REPLACE FUNCTION get_my_ai_usage_today()
RETURNS TABLE (
  model         text,
  tokens_used   integer,
  request_count integer,
  tokens_limit  integer,
  request_limit integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_today   date := (now() AT TIME ZONE 'utc')::date;
  v_tier    text;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN;
  END IF;

  SELECT storage_tier::text INTO v_tier FROM profiles WHERE id = v_user_id;
  v_tier := COALESCE(v_tier, 'free');

  RETURN QUERY
  WITH known_models AS (
    SELECT unnest(ARRAY[
      'gemini-2.5-flash',
      'gemini-3-flash-preview',
      'gpt-4o-mini',
      'claude-haiku-4-5'
    ]) AS m
  )
  SELECT
    k.m,
    COALESCE(u.tokens_used, 0)::integer,
    COALESCE(u.request_count, 0)::integer,
    lt.token_limit,
    lt.request_limit
  FROM known_models k
  CROSS JOIN LATERAL _ai_usage_limits_for_model(k.m, v_tier) lt
  LEFT JOIN ai_usage_user u
    ON u.user_id = v_user_id
   AND u.usage_date = v_today
   AND u.model = k.m
  ORDER BY k.m;
END;
$$;

GRANT EXECUTE ON FUNCTION get_my_ai_usage_today() TO authenticated;
GRANT EXECUTE ON FUNCTION _ai_usage_limits_for_model(text, text) TO authenticated, anon;
