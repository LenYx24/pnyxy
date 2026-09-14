-- Pilot quota rebalance: pilot students are granted `premium` by hand, so
-- premium is brought DOWN to roughly the old free level (a generous student
-- allowance, ~200 msgs/day on the default model) and free is brought DOWN to a
-- taste-test level (~50 msgs/day). Only the numbers change; the model-id
-- mapping and function shape are identical to 00067. Anon is left as-is.
--
-- Rough $ (Gemini 3 Flash ~$0.50/$3 per 1M, ~2000 tok/turn, worst case if a
-- user maxes the token cap every day): free ~$0.12/day, premium ~$0.50/day.
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
      RETURN QUERY SELECT 400000, 400;
    ELSIF v_model = 'gemini-2.5-flash' THEN
      RETURN QUERY SELECT 300000, 300;
    ELSIF v_model = 'gemini-3-flash-preview' THEN
      RETURN QUERY SELECT 400000, 400;
    ELSIF v_model = 'gpt-4o-mini' THEN
      RETURN QUERY SELECT 100000, 150;
    ELSIF v_model = 'claude-haiku-4-5' THEN
      RETURN QUERY SELECT 150000, 150;
    ELSE
      RETURN QUERY SELECT 100000, 150;
    END IF;
    RETURN;
  END IF;

  -- free tier
  IF v_model = 'gemini-2.5-flash-lite' THEN
    RETURN QUERY SELECT 120000, 150;
  ELSIF v_model = 'gemini-2.5-flash' THEN
    RETURN QUERY SELECT 80000, 100;
  ELSIF v_model = 'gemini-3-flash-preview' THEN
    RETURN QUERY SELECT 100000, 120;
  ELSIF v_model = 'gpt-4o-mini' THEN
    RETURN QUERY SELECT 30000, 60;
  ELSIF v_model = 'claude-haiku-4-5' THEN
    RETURN QUERY SELECT 30000, 60;
  ELSE
    RETURN QUERY SELECT 30000, 60;
  END IF;
END;
$$;
