-- Refund a pre-billed AI request when the upstream call fails AFTER the
-- quota was recorded (the proxy bills worst-case before trying each
-- provider; without a refund, a failing provider in the fallback chain
-- silently drains the user's daily buckets on models that never
-- answered). Best-effort: the proxy ignores refund errors.

CREATE OR REPLACE FUNCTION refund_ai_usage_user(
  p_tokens integer,
  p_model  text
) RETURNS void
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
  UPDATE ai_usage_user
     SET tokens_used   = GREATEST(tokens_used - p_tokens, 0),
         request_count = GREATEST(request_count - 1, 0)
   WHERE user_id = v_user_id
     AND usage_date = v_today
     AND model = p_model;
END;
$$;

GRANT EXECUTE ON FUNCTION refund_ai_usage_user(integer, text) TO authenticated;

-- Anon variant, called with the service-role client only (no grant to anon).
CREATE OR REPLACE FUNCTION refund_ai_usage_anon(
  p_ip_hash text,
  p_tokens  integer,
  p_model   text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'utc')::date;
BEGIN
  UPDATE ai_usage_anon
     SET tokens_used   = GREATEST(tokens_used - p_tokens, 0),
         request_count = GREATEST(request_count - 1, 0)
   WHERE ip_hash = p_ip_hash
     AND usage_date = v_today
     AND model = p_model;
END;
$$;
