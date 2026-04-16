-- ============================================================
-- Migration 00008: AI usage tracking + per-user/IP rate limits
--
-- Daily quotas for the Pnyxy-provided AI provider.
-- Logged-in users get a generous-ish bucket; anonymous users
-- (identified by hashed IP) get a small bucket.
--
-- All tables and RPCs run with elevated privileges and are
-- locked down so only the service_role (used by the edge
-- function) can touch them.
-- ============================================================

-- Daily quota constants (kept inline so they're easy to bump
-- via a single ALTER FUNCTION later).
--
--   Auth users:  200 requests/day, 50,000 tokens/day
--   Anon (IP):     5 requests/day,  5,000 tokens/day

CREATE TABLE ai_usage_user (
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  usage_date  date        NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  tokens_used integer     NOT NULL DEFAULT 0,
  request_count integer   NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, usage_date)
);

CREATE INDEX idx_ai_usage_user_date ON ai_usage_user(usage_date);

CREATE TABLE ai_usage_anon (
  ip_hash     text        NOT NULL,
  usage_date  date        NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  tokens_used integer     NOT NULL DEFAULT 0,
  request_count integer   NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ip_hash, usage_date)
);

CREATE INDEX idx_ai_usage_anon_date ON ai_usage_anon(usage_date);

-- RLS: lock everything down. Only service_role (edge function)
-- and the user themselves (read-only of their own row) may touch.

ALTER TABLE ai_usage_user ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_usage_anon ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own AI usage"
  ON ai_usage_user FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- No policy for ai_usage_anon: only service_role can read it.

-- ── Quota check + record (auth users) ────────────────────────
--
-- Atomically:
--   1. Upsert today's row for the user
--   2. Reject if either request_count or tokens_used would
--      exceed the daily limit
--   3. Otherwise increment and return the updated row
--
-- The function is SECURITY DEFINER so it can bypass RLS;
-- callers (the edge function) must have authenticated as the
-- owning user, since we use auth.uid() to derive user_id.

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

  -- Ensure today's row exists, then lock it.
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
  SET tokens_used   = tokens_used + p_tokens,
      request_count = request_count + 1,
      updated_at    = now()
  WHERE user_id = v_user_id AND usage_date = v_today
  RETURNING * INTO v_row;

  RETURN QUERY SELECT true, NULL::text,
    v_row.tokens_used, v_row.request_count, v_token_limit, v_req_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION check_and_record_ai_usage_user(integer) TO authenticated;

-- ── Quota check + record (anonymous, by IP hash) ─────────────
--
-- Same shape as the user version but keyed by a hashed IP that
-- the edge function passes in. Only callable by service_role
-- because we don't want clients to spoof IPs.

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
  SET tokens_used   = tokens_used + p_tokens,
      request_count = request_count + 1,
      updated_at    = now()
  WHERE ip_hash = p_ip_hash AND usage_date = v_today
  RETURNING * INTO v_row;

  RETURN QUERY SELECT true, NULL::text,
    v_row.tokens_used, v_row.request_count, v_token_limit, v_req_limit;
END;
$$;

REVOKE EXECUTE ON FUNCTION check_and_record_ai_usage_anon(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION check_and_record_ai_usage_anon(text, integer) TO service_role;

-- ── Helper: read today's usage for the current user ──────────
--
-- Used by the settings page to render "X / 50,000 tokens used today".

CREATE OR REPLACE FUNCTION get_my_ai_usage_today()
RETURNS TABLE (
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
  v_user_id      uuid := auth.uid();
  v_today        date := (now() AT TIME ZONE 'utc')::date;
  v_token_limit  constant integer := 50000;
  v_req_limit    constant integer := 200;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN QUERY SELECT 0, 0, v_token_limit, v_req_limit;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT COALESCE(u.tokens_used, 0),
         COALESCE(u.request_count, 0),
         v_token_limit,
         v_req_limit
  FROM (SELECT v_user_id AS uid) base
  LEFT JOIN ai_usage_user u
    ON u.user_id = base.uid AND u.usage_date = v_today;
END;
$$;

GRANT EXECUTE ON FUNCTION get_my_ai_usage_today() TO authenticated;
