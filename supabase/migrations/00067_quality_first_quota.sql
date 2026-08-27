-- Quality-first routing (pilot decision): the auto route now STARTS on
-- gemini-3.7-flash, so its daily bucket becomes the main one; the
-- cheaper tiers turn into fallback reserves. Only the 3.7 rows change.
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
      RETURN QUERY SELECT 20000, 20;
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
      RETURN QUERY SELECT 1500000, 4000;
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
    RETURN QUERY SELECT 400000, 1200;
  ELSIF v_model = 'gpt-4o-mini' THEN
    RETURN QUERY SELECT 50000, 200;
  ELSIF v_model = 'claude-haiku-4-5' THEN
    RETURN QUERY SELECT 50000, 200;
  ELSE
    RETURN QUERY SELECT 50000, 200;
  END IF;
END;
$$;
