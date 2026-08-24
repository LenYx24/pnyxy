-- ── Gemini 3 Flash Preview quota ─────────────────────────────
--
-- Adds the gemini-3-flash-preview model to the per-model quota
-- helper (00038) and to the read-RPC's known-models list so the
-- AI usage tab shows a bar for it.
--
-- Pricing context (USD / 1M tokens, Standard Paid tier as of
-- early 2026): $0.50 input / $3.00 output. About 67% pricier on
-- input and 20% pricier on output than 2.5 Flash ($0.30 / $2.50).
-- Bucket sized so the worst-case daily spend per authed user is
-- comparable to 2.5 Flash: 100k tokens × $0.003/1k ≈ $0.30/day
-- worst case, with a 500 request ceiling. The earlier 2.5 Flash
-- bucket (200k × $0.0025/1k ≈ $0.50/day) is still in place.
--
-- The anon bucket stays tight, anonymous users can't sign costs
-- away from us, so a generous limit on a more expensive model
-- would be the wrong tradeoff.

CREATE OR REPLACE FUNCTION _ai_usage_limits_for_model(
  p_model   text,
  p_is_anon boolean
) RETURNS TABLE (
  token_limit   integer,
  request_limit integer
)
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_is_anon THEN
    IF p_model = 'gemini-2.5-flash' THEN
      RETURN QUERY SELECT 20000, 20;
    ELSIF p_model = 'gemini-3-flash-preview' THEN
      -- Newer model, pricier per token, tighter anon bucket.
      RETURN QUERY SELECT 10000, 10;
    ELSE
      RETURN QUERY SELECT 5000, 5;
    END IF;
    RETURN;
  END IF;

  -- Authenticated tier.
  IF p_model = 'gemini-2.5-flash' THEN
    -- $0.30/$2.50 per MTok → cap costs ~$0.50/day at max usage.
    RETURN QUERY SELECT 200000, 1000;
    RETURN;
  END IF;

  IF p_model = 'gemini-3-flash-preview' THEN
    -- $0.50/$3.00 per MTok → cap costs ~$0.30/day at max usage,
    -- comparable worst-case spend to 2.5 Flash despite the higher
    -- per-token cost. The user has to pin it explicitly to use it.
    RETURN QUERY SELECT 100000, 500;
    RETURN;
  END IF;

  IF p_model = 'gpt-4o-mini' THEN
    RETURN QUERY SELECT 50000, 200;
    RETURN;
  END IF;

  IF p_model = 'claude-haiku-4-5' THEN
    RETURN QUERY SELECT 50000, 200;
    RETURN;
  END IF;

  -- Legacy 'auto' rows + unknown models fall through to the same
  -- conservative default the previous migration shipped.
  RETURN QUERY SELECT 50000, 200;
END;
$$;

-- Extend the known-models list the AI-usage read RPC iterates over
-- so the per-model bars in Settings → AI surface a row for Gemini
-- 3 Flash too. The list is the source of truth for "which models
-- does the proxy bill against today?".
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
BEGIN
  IF v_user_id IS NULL THEN
    RETURN;
  END IF;

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
  CROSS JOIN LATERAL _ai_usage_limits_for_model(k.m, false) lt
  LEFT JOIN ai_usage_user u
    ON u.user_id = v_user_id
   AND u.usage_date = v_today
   AND u.model = k.m
  ORDER BY k.m;
END;
$$;

GRANT EXECUTE ON FUNCTION get_my_ai_usage_today() TO authenticated;
GRANT EXECUTE ON FUNCTION _ai_usage_limits_for_model(text, boolean) TO authenticated, anon;
