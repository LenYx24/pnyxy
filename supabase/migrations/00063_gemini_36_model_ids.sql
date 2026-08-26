-- Google retired the gemini-2.x ids for new API users (upstream 404:
-- "This model ... is no longer available to new users"). The proxy now
-- calls gemini-3.5-flash-lite / gemini-3.6-flash / gemini-3.7-flash;
-- those ids double as quota-bucket keys, so the limits function and the
-- usage read-out must know them. Old ids keep their buckets so history
-- rows and stale clients still resolve.

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
DECLARE
  -- normalize: new id -> the bucket its predecessor used
  v_model text := CASE p_model
    WHEN 'gemini-3.5-flash-lite' THEN 'gemini-2.5-flash-lite'
    WHEN 'gemini-3.6-flash'      THEN 'gemini-2.5-flash'
    WHEN 'gemini-3.7-flash'      THEN 'gemini-3-flash-preview'
    ELSE p_model
  END;
BEGIN
  IF p_tier = 'anon' THEN
    IF v_model = 'gemini-2.5-flash-lite' THEN
      RETURN QUERY SELECT 25000, 25;
    ELSIF v_model = 'gemini-2.5-flash' THEN
      RETURN QUERY SELECT 20000, 20;
    ELSIF v_model = 'gemini-3-flash-preview' THEN
      RETURN QUERY SELECT 10000, 10;
    ELSE
      RETURN QUERY SELECT 5000, 5;
    END IF;
    RETURN;
  END IF;

  IF p_tier = 'premium' THEN
    IF v_model = 'gemini-2.5-flash-lite' THEN
      RETURN QUERY SELECT 1000000, 4000;
    ELSIF v_model = 'gemini-2.5-flash' THEN
      RETURN QUERY SELECT 750000, 3000;
    ELSIF v_model = 'gemini-3-flash-preview' THEN
      RETURN QUERY SELECT 400000, 1500;
    ELSIF v_model = 'gpt-4o-mini' THEN
      RETURN QUERY SELECT 250000, 800;
    ELSIF v_model = 'claude-haiku-4-5' THEN
      RETURN QUERY SELECT 250000, 800;
    ELSE
      RETURN QUERY SELECT 250000, 800;
    END IF;
    RETURN;
  END IF;

  IF v_model = 'gemini-2.5-flash-lite' THEN
    RETURN QUERY SELECT 300000, 1500;
  ELSIF v_model = 'gemini-2.5-flash' THEN
    RETURN QUERY SELECT 200000, 1000;
  ELSIF v_model = 'gemini-3-flash-preview' THEN
    RETURN QUERY SELECT 100000, 500;
  ELSIF v_model = 'gpt-4o-mini' THEN
    RETURN QUERY SELECT 50000, 200;
  ELSIF v_model = 'claude-haiku-4-5' THEN
    RETURN QUERY SELECT 50000, 200;
  ELSE
    RETURN QUERY SELECT 50000, 200;
  END IF;
END;
$$;

-- Usage read-out lists the NEW ids (what the proxy bills from now on).
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
      'gemini-3.5-flash-lite',
      'gemini-3.6-flash',
      'gemini-3.7-flash',
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
