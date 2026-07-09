-- ============================================================
-- Migration 00050: admin AI-quota analytics
--
-- Admin-only stats about how hard users push against their AI quota.
-- Same shape/conventions as the 00047 admin analytics RPCs: plpgsql,
-- STABLE, SECURITY DEFINER, is_admin()-gated, granted to authenticated,
-- aggregates only (no prompt/response content).
--
-- Cap-hits are NOT logged anywhere (the quota RPC just denies the
-- request without writing a row), so "bumped into the ceiling" is
-- DERIVED: for each recorded (user, day, model) row we compute a
-- utilisation ratio = max(tokens_used/token_limit, request_count/
-- request_limit) using the SAME per-tier limits the live quota check
-- uses (_ai_usage_limits_for_model against the user's current tier),
-- and treat ratio >= 0.9 as "hit / nearly hit the ceiling". This
-- slightly UNDER-counts pure token-cap denials that landed below 90%,
-- but matches request-cap denials exactly and is the honest best we
-- can do without an event log. Tier is the user's CURRENT tier (no
-- historical tier is stored), so a recent up/downgrade re-scores past
-- days — acceptable for a trend dashboard.
-- ============================================================

-- ── 1. Daily: active users, how many bumped the ceiling, avg usage ──

CREATE OR REPLACE FUNCTION admin_quota_daily(p_days integer DEFAULT 30)
RETURNS TABLE (
  day           date,
  active_users  bigint,
  capped_users  bigint,
  avg_tokens    numeric,
  avg_requests  numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  RETURN QUERY
  WITH rows AS (
    SELECT
      u.user_id,
      u.usage_date,
      u.tokens_used,
      u.request_count,
      GREATEST(
        u.tokens_used::numeric   / NULLIF(lim.token_limit, 0),
        u.request_count::numeric / NULLIF(lim.request_limit, 0)
      ) AS ratio
    FROM ai_usage_user u
    JOIN profiles p ON p.id = u.user_id
    CROSS JOIN LATERAL
      _ai_usage_limits_for_model(u.model, p.storage_tier::text) AS lim
    WHERE u.usage_date >= (now() AT TIME ZONE 'utc')::date - (p_days - 1)
  ),
  per_user_day AS (
    SELECT
      user_id,
      usage_date,
      SUM(tokens_used)   AS tokens,
      SUM(request_count) AS requests,
      MAX(ratio)         AS max_ratio
    FROM rows
    GROUP BY user_id, usage_date
  ),
  agg AS (
    SELECT
      usage_date AS d,
      COUNT(*)                                   AS active_users,
      COUNT(*) FILTER (WHERE max_ratio >= 0.9)   AS capped_users,
      ROUND(AVG(tokens), 0)                      AS avg_tokens,
      ROUND(AVG(requests), 1)                    AS avg_requests
    FROM per_user_day
    GROUP BY usage_date
  )
  SELECT
    gs::date,
    COALESCE(a.active_users, 0),
    COALESCE(a.capped_users, 0),
    COALESCE(a.avg_tokens, 0),
    COALESCE(a.avg_requests, 0)
  FROM generate_series(
    (now() AT TIME ZONE 'utc')::date - (p_days - 1),
    (now() AT TIME ZONE 'utc')::date,
    interval '1 day'
  ) gs
  LEFT JOIN agg a ON a.d = gs::date
  ORDER BY gs;
END;
$$;

-- ── 2. Window summary: cap-hit rate overall, for "power" users, and ──
--    split by tier. p_active_min = requests-in-window threshold that
--    defines the narrower "power user" cohort.

CREATE OR REPLACE FUNCTION admin_quota_cap_summary(
  p_days       integer DEFAULT 30,
  p_active_min integer DEFAULT 5
)
RETURNS TABLE (
  active_users        bigint,
  capped_users        bigint,
  power_users         bigint,
  power_capped_users  bigint,
  free_active         bigint,
  free_capped         bigint,
  premium_active      bigint,
  premium_capped      bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  RETURN QUERY
  WITH rows AS (
    SELECT
      u.user_id,
      p.storage_tier::text AS tier,
      u.request_count,
      GREATEST(
        u.tokens_used::numeric   / NULLIF(lim.token_limit, 0),
        u.request_count::numeric / NULLIF(lim.request_limit, 0)
      ) AS ratio
    FROM ai_usage_user u
    JOIN profiles p ON p.id = u.user_id
    CROSS JOIN LATERAL
      _ai_usage_limits_for_model(u.model, p.storage_tier::text) AS lim
    WHERE u.usage_date >= (now() AT TIME ZONE 'utc')::date - (p_days - 1)
  ),
  per_user AS (
    SELECT
      user_id,
      MIN(tier)                     AS tier,
      SUM(request_count)            AS reqs,
      BOOL_OR(ratio >= 0.9)         AS capped
    FROM rows
    GROUP BY user_id
  )
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE capped),
    COUNT(*) FILTER (WHERE reqs >= p_active_min),
    COUNT(*) FILTER (WHERE reqs >= p_active_min AND capped),
    COUNT(*) FILTER (WHERE tier = 'free'),
    COUNT(*) FILTER (WHERE tier = 'free' AND capped),
    COUNT(*) FILTER (WHERE tier = 'premium'),
    COUNT(*) FILTER (WHERE tier = 'premium' AND capped)
  FROM per_user;
END;
$$;

-- ── 3. Distribution: how close to their ceiling active users get ──
--    (peak utilisation ratio over the window, bucketed).

CREATE OR REPLACE FUNCTION admin_quota_utilization_histogram(
  p_days integer DEFAULT 30
)
RETURNS TABLE (
  bucket     text,
  sort_order integer,
  users      bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  RETURN QUERY
  WITH rows AS (
    SELECT
      u.user_id,
      GREATEST(
        u.tokens_used::numeric   / NULLIF(lim.token_limit, 0),
        u.request_count::numeric / NULLIF(lim.request_limit, 0)
      ) AS ratio
    FROM ai_usage_user u
    JOIN profiles p ON p.id = u.user_id
    CROSS JOIN LATERAL
      _ai_usage_limits_for_model(u.model, p.storage_tier::text) AS lim
    WHERE u.usage_date >= (now() AT TIME ZONE 'utc')::date - (p_days - 1)
  ),
  per_user AS (
    SELECT user_id, MAX(ratio) AS peak
    FROM rows
    GROUP BY user_id
  ),
  bucketed AS (
    SELECT
      CASE
        WHEN peak >= 0.9  THEN '90%+'
        WHEN peak >= 0.75 THEN '75-90%'
        WHEN peak >= 0.5  THEN '50-75%'
        WHEN peak >= 0.25 THEN '25-50%'
        ELSE '0-25%'
      END AS bucket,
      CASE
        WHEN peak >= 0.9  THEN 5
        WHEN peak >= 0.75 THEN 4
        WHEN peak >= 0.5  THEN 3
        WHEN peak >= 0.25 THEN 2
        ELSE 1
      END AS sort_order
    FROM per_user
  )
  SELECT b.bucket, b.sort_order, COUNT(*)
  FROM bucketed b
  GROUP BY b.bucket, b.sort_order
  ORDER BY b.sort_order;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_quota_daily(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_quota_cap_summary(integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_quota_utilization_histogram(integer) TO authenticated;
