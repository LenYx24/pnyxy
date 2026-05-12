-- ============================================================
-- Migration 00038: per-model AI usage quotas
--
-- Cost per 1M tokens varies 50–100× across providers (Gemini Flash
-- $0.075 vs Claude Sonnet $3), so a flat "tokens/day" cap blurs the
-- accounting. We now key ai_usage_user / ai_usage_anon by
-- (id, date, model) so each model gets its own bucket with its own
-- limit. Cheap models (Gemini Flash) get generous quotas; expensive
-- ones (Claude Sonnet) get small ones; the auto-router naturally
-- steers casual users toward cheap models without us having to make
-- routing decisions for them at quota-check time.
--
-- Migration shape:
--   1. Add `model` column to both tables, default 'auto' so the
--      existing row data continues to make sense.
--   2. Swap the primary keys to include `model`.
--   3. Introduce a single source-of-truth helper
--      `_ai_usage_limits_for_model(p_model, p_is_anon)` so the
--      RPCs and any future surfaces (admin dashboards, billing
--      reports) read the same numbers.
--   4. Reissue the three RPCs:
--        - check_and_record_ai_usage_user(p_tokens, p_model)
--        - check_and_record_ai_usage_anon(p_ip_hash, p_tokens, p_model)
--        - get_my_ai_usage_today() — now SETOF rows, one per model
-- ============================================================

-- ── 1. Column + PK swap ───────────────────────────────────────

ALTER TABLE ai_usage_user
  ADD COLUMN IF NOT EXISTS model text NOT NULL DEFAULT 'auto';

ALTER TABLE ai_usage_anon
  ADD COLUMN IF NOT EXISTS model text NOT NULL DEFAULT 'auto';

-- Old PK was (user_id, usage_date) / (ip_hash, usage_date). Drop
-- and recreate including the new model column.
ALTER TABLE ai_usage_user DROP CONSTRAINT IF EXISTS ai_usage_user_pkey;
ALTER TABLE ai_usage_user ADD PRIMARY KEY (user_id, usage_date, model);

ALTER TABLE ai_usage_anon DROP CONSTRAINT IF EXISTS ai_usage_anon_pkey;
ALTER TABLE ai_usage_anon ADD PRIMARY KEY (ip_hash, usage_date, model);

-- ── 2. Per-model limits helper ────────────────────────────────
--
-- Single place to bump quotas. Anon (IP-bucketed) limits are
-- always small no matter the model — anon users can't sign costs
-- away from us, so we don't want a generous default landing on
-- abuse traffic.

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
    -- Anonymous tier. Same tiny bucket for every model; the daily
    -- cap is there to deter scrapers, not to enable real use.
    -- Gemini gets a slightly larger bucket because its per-token
    -- cost is small enough that wider anon usage is still cheap.
    IF p_model = 'gemini-2.5-flash' THEN
      RETURN QUERY SELECT 20000, 20;
    ELSE
      RETURN QUERY SELECT 5000, 5;
    END IF;
    RETURN;
  END IF;

  -- Authenticated tier. Larger quotas tuned to per-1M-token costs.
  -- These are pennies/day even at the cap for a typical reader.
  IF p_model = 'gemini-2.5-flash' THEN
    -- $0.075/$0.30 per MTok → cap costs ~$0.02/day at max usage.
    RETURN QUERY SELECT 200000, 1000;
    RETURN;
  END IF;

  IF p_model = 'gpt-4o-mini' THEN
    -- $0.15/$0.60 per MTok → ~$0.02/day at max usage.
    RETURN QUERY SELECT 50000, 200;
    RETURN;
  END IF;

  IF p_model = 'claude-haiku-4-5' THEN
    -- $1/$5 per MTok → ~$0.20/day at max usage. Smallest of the
    -- three default-tier models on cost basis.
    RETURN QUERY SELECT 50000, 200;
    RETURN;
  END IF;

  -- Legacy 'auto' rows (pre-migration) keep the old bucket so
  -- their numbers stay readable in the read RPC. Unknown models
  -- fall through to this conservative default too.
  RETURN QUERY SELECT 50000, 200;
END;
$$;

-- ── 3. Reissue check-and-record RPCs ──────────────────────────

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
  v_token_limit  integer;
  v_req_limit    integer;
  v_row          ai_usage_user%ROWTYPE;
BEGIN
  -- Pull the limits up front so the early-return branches have
  -- something to report.
  SELECT lt.token_limit, lt.request_limit
    INTO v_token_limit, v_req_limit
  FROM _ai_usage_limits_for_model(p_model, false) lt;

  IF v_user_id IS NULL THEN
    RETURN QUERY SELECT false, 'not_authenticated'::text, 0, 0, v_token_limit, v_req_limit;
    RETURN;
  END IF;

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
  FROM _ai_usage_limits_for_model(p_model, true) lt;

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

-- ── 4. Read-only usage for the current user ───────────────────
--
-- Now returns SETOF — one row per model the user has touched today,
-- plus a synthetic row for every known model the user *hasn't* hit
-- yet (so the settings UI can render zero-usage bars for the full
-- catalog without a separate "what models exist" RPC). The set of
-- known models is hard-coded inside the function so the schema can
-- track new entries without a client deploy.

-- The previous version of this function returned a 4-column row
-- (tokens_used, request_count, tokens_limit, request_limit). Adding
-- `model` as a leading column changes the return type, which
-- Postgres refuses via CREATE OR REPLACE. Drop the old definition
-- first so the replacement is unambiguous.
DROP FUNCTION IF EXISTS get_my_ai_usage_today();

-- Stale single-arg overloads of the check-and-record RPCs from
-- before per-model billing. The new two/three-arg versions above
-- coexist with these by default; nothing calls the old ones now,
-- so drop them to keep the schema readable.
DROP FUNCTION IF EXISTS check_and_record_ai_usage_user(integer);
DROP FUNCTION IF EXISTS check_and_record_ai_usage_anon(text, integer);

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
