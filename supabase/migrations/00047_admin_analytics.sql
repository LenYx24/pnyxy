-- ============================================================
-- Migration 00047: admin analytics RPCs
--
-- Aggregate read-models for the admin dashboard's Analytics tab.
-- Every function is SECURITY DEFINER (so it can read across all
-- users, bypassing the per-user RLS on the base tables) but gated
-- behind public.is_admin() (00004), a non-admin caller gets an
-- exception, never data. Crucially these return ONLY aggregates
-- (counts, sums, percentiles, histogram buckets); no prompt/response
-- content and no per-row user data except the heavy-user leaderboard,
-- which is admin-only by design. This keeps the "trends, not who
-- asked what" privacy line the product wants.
--
-- All windows are expressed in whole days against the UTC date, to
-- line up with ai_usage_user.usage_date (a UTC date bucket).
-- ============================================================

-- ── Guard helper kept inline in each fn (cheap STABLE call) ────

-- ── 1. Overview KPIs (single row) ─────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_overview()
RETURNS TABLE (
  total_users         bigint,
  premium_users       bigint,
  new_users_7d        bigint,
  new_users_30d       bigint,
  active_users_7d     bigint,
  total_books         bigint,
  total_notes         bigint,
  total_whiteboards   bigint,
  total_quizzes       bigint,
  total_conversations bigint,
  tokens_7d           bigint,
  tokens_30d          bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'utc')::date;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  RETURN QUERY SELECT
    (SELECT count(*) FROM profiles),
    (SELECT count(*) FROM profiles WHERE storage_tier::text = 'premium'),
    (SELECT count(*) FROM profiles WHERE created_at >= now() - interval '7 days'),
    (SELECT count(*) FROM profiles WHERE created_at >= now() - interval '30 days'),
    (SELECT count(DISTINCT user_id) FROM ai_usage_user WHERE usage_date >= v_today - 7),
    (SELECT count(*) FROM books),
    (SELECT count(*) FROM notes),
    (SELECT count(*) FROM user_whiteboards),
    (SELECT count(*) FROM quizzes),
    (SELECT count(*) FROM chat_conversations),
    (SELECT coalesce(sum(tokens_used), 0)::bigint FROM ai_usage_user WHERE usage_date >= v_today - 7),
    (SELECT coalesce(sum(tokens_used), 0)::bigint FROM ai_usage_user WHERE usage_date >= v_today - 30);
END;
$$;

-- ── 2. Daily signups time series ──────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_signups_daily(p_days integer DEFAULT 30)
RETURNS TABLE (day date, signups bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'utc')::date;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  RETURN QUERY
  SELECT d::date, count(p.id)::bigint
  FROM generate_series(v_today - (p_days - 1), v_today, interval '1 day') AS d
  LEFT JOIN profiles p ON (p.created_at AT TIME ZONE 'utc')::date = d::date
  GROUP BY d
  ORDER BY d;
END;
$$;

-- ── 3. Daily LLM token usage by model ─────────────────────────
CREATE OR REPLACE FUNCTION public.admin_tokens_daily(p_days integer DEFAULT 30)
RETURNS TABLE (day date, model text, tokens bigint, requests bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'utc')::date;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  RETURN QUERY
  SELECT usage_date, ai_usage_user.model,
         sum(tokens_used)::bigint, sum(request_count)::bigint
  FROM ai_usage_user
  WHERE usage_date >= v_today - (p_days - 1)
  GROUP BY usage_date, ai_usage_user.model
  ORDER BY usage_date, ai_usage_user.model;
END;
$$;

-- ── 4. Per-user token distribution over a window (percentiles) ─
CREATE OR REPLACE FUNCTION public.admin_token_distribution(p_days integer DEFAULT 30)
RETURNS TABLE (
  users_active  bigint,
  avg_tokens    numeric,
  median_tokens numeric,
  p90_tokens    numeric,
  p95_tokens    numeric,
  p99_tokens    numeric,
  max_tokens    bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'utc')::date;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  RETURN QUERY
  WITH per_user AS (
    SELECT user_id, sum(tokens_used) AS tok
    FROM ai_usage_user
    WHERE usage_date >= v_today - (p_days - 1)
    GROUP BY user_id
  )
  SELECT
    count(*)::bigint,
    round(coalesce(avg(tok), 0))::numeric,
    coalesce(percentile_cont(0.5)  WITHIN GROUP (ORDER BY tok), 0)::numeric,
    coalesce(percentile_cont(0.9)  WITHIN GROUP (ORDER BY tok), 0)::numeric,
    coalesce(percentile_cont(0.95) WITHIN GROUP (ORDER BY tok), 0)::numeric,
    coalesce(percentile_cont(0.99) WITHIN GROUP (ORDER BY tok), 0)::numeric,
    coalesce(max(tok), 0)::bigint
  FROM per_user;
END;
$$;

-- ── 5. Heavy-user leaderboard (the cost "whales") ─────────────
CREATE OR REPLACE FUNCTION public.admin_top_token_users(
  p_days  integer DEFAULT 30,
  p_limit integer DEFAULT 10
)
RETURNS TABLE (
  user_id      uuid,
  display_name text,
  tier         text,
  tokens       bigint,
  requests     bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'utc')::date;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  RETURN QUERY
  SELECT u.user_id, p.display_name, p.storage_tier::text,
         sum(u.tokens_used)::bigint, sum(u.request_count)::bigint
  FROM ai_usage_user u
  JOIN profiles p ON p.id = u.user_id
  WHERE u.usage_date >= v_today - (p_days - 1)
  GROUP BY u.user_id, p.display_name, p.storage_tier
  ORDER BY sum(u.tokens_used) DESC
  LIMIT greatest(p_limit, 1);
END;
$$;

-- ── 6. Books-per-user histogram (engagement distribution) ─────
CREATE OR REPLACE FUNCTION public.admin_books_per_user_histogram()
RETURNS TABLE (bucket text, sort_order integer, users bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  RETURN QUERY
  WITH per_user AS (
    SELECT p.id, coalesce(b.cnt, 0) AS cnt
    FROM profiles p
    LEFT JOIN (
      SELECT user_id, count(*) AS cnt FROM books GROUP BY user_id
    ) b ON b.user_id = p.id
  ),
  bucketed AS (
    SELECT
      CASE
        WHEN cnt = 0 THEN '0'
        WHEN cnt = 1 THEN '1'
        WHEN cnt BETWEEN 2 AND 3 THEN '2-3'
        WHEN cnt BETWEEN 4 AND 5 THEN '4-5'
        WHEN cnt BETWEEN 6 AND 10 THEN '6-10'
        ELSE '11+'
      END AS bucket,
      CASE
        WHEN cnt = 0 THEN 0
        WHEN cnt = 1 THEN 1
        WHEN cnt BETWEEN 2 AND 3 THEN 2
        WHEN cnt BETWEEN 4 AND 5 THEN 3
        WHEN cnt BETWEEN 6 AND 10 THEN 4
        ELSE 5
      END AS sort_order
    FROM per_user
  )
  SELECT bucket, sort_order, count(*)::bigint
  FROM bucketed
  GROUP BY bucket, sort_order
  ORDER BY sort_order;
END;
$$;

-- ── 7. Feature adoption (users-with + total-items per feature) ─
CREATE OR REPLACE FUNCTION public.admin_feature_usage()
RETURNS TABLE (feature text, users_with bigint, total_items bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  RETURN QUERY
  SELECT 'books'::text,       count(DISTINCT user_id), count(*)::bigint FROM books
  UNION ALL
  SELECT 'notes',             count(DISTINCT user_id), count(*)::bigint FROM notes
  UNION ALL
  SELECT 'whiteboards',       count(DISTINCT user_id), count(*)::bigint FROM user_whiteboards
  UNION ALL
  SELECT 'quizzes',           count(DISTINCT user_id), count(*)::bigint FROM quizzes
  UNION ALL
  SELECT 'chats',             count(DISTINCT user_id), count(*)::bigint FROM chat_conversations;
END;
$$;

-- ── Grants: authenticated only; the is_admin() gate does the rest ─
GRANT EXECUTE ON FUNCTION public.admin_overview()                       TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_signups_daily(integer)           TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_tokens_daily(integer)            TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_token_distribution(integer)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_top_token_users(integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_books_per_user_histogram()       TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_feature_usage()                  TO authenticated;
