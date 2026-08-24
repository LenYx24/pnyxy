-- ============================================================
-- Migration 00046: Gemini 2.5 Flash-Lite quota tier
--
-- Adds `gemini-2.5-flash-lite` to the per-model AI quota helper and
-- the Settings usage read-out. Flash-Lite is now the cheapest-first
-- hop in the proxy's auto-route chain (see ai-chat-proxy/index.ts):
-- it's ~3-6x cheaper per token than 2.5 Flash, so the bulk of free
-- "auto" traffic lands here and only falls through to the fuller
-- (pricier) models once this bucket is exhausted.
--
-- Bucket sizing: because the per-token price is a fraction of 2.5
-- Flash, we give Flash-Lite a LARGER token bucket than 2.5 Flash and
-- still come out ahead on absolute worst-case daily spend:
--   * free    300k tokens: worst-case output-heavy ~$0.7/day
--                           (vs 2.5 Flash's 200k ~$1.9/day)
--   * premium 1.0M tokens: ~4x free, same accepted tradeoff as 00042
--   * anon     25k tokens: kept tight; anon caps are scraper-deterrence,
--                           not a cost lever, so only a touch above the
--                           2.5 Flash anon bucket.
--
-- Only the two tier-aware functions from 00042 need reissuing; their
-- signatures are unchanged so CREATE OR REPLACE keeps existing GRANTs.
-- ============================================================

-- ── 1. Limits helper: add the flash-lite branch to every tier ──

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
    IF p_model = 'gemini-2.5-flash-lite' THEN
      RETURN QUERY SELECT 25000, 25;
    ELSIF p_model = 'gemini-2.5-flash' THEN
      RETURN QUERY SELECT 20000, 20;
    ELSIF p_model = 'gemini-3-flash-preview' THEN
      RETURN QUERY SELECT 10000, 10;
    ELSE
      RETURN QUERY SELECT 5000, 5;
    END IF;
    RETURN;
  END IF;

  -- Premium tier. ~4x the free buckets. Worst-case daily spend at the
  -- cap (output-heavy): flash-lite ~$1.4, 2.5-flash ~$1.9, 3-flash
  -- ~$1.2, haiku ~$1.0, 4o-mini ~$0.10, bounded, request caps included.
  IF p_tier = 'premium' THEN
    IF p_model = 'gemini-2.5-flash-lite' THEN
      RETURN QUERY SELECT 1000000, 4000;
    ELSIF p_model = 'gemini-2.5-flash' THEN
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
  IF p_model = 'gemini-2.5-flash-lite' THEN
    RETURN QUERY SELECT 300000, 1500;
  ELSIF p_model = 'gemini-2.5-flash' THEN
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

-- ── 2. Usage read-out: surface the new model in Settings -> AI ──

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
      'gemini-2.5-flash-lite',
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
