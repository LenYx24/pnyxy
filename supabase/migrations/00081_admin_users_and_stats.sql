-- Admin hub: a searchable users list + four engagement stats.
--
-- All follow the house pattern from 00047/00050/00075:
--   LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public,
--   guarded by public.is_admin(), auth.* fully qualified, UTC date
--   bucketing, GRANT EXECUTE TO authenticated.
--
-- "Active" for the retention + daily-active stats means "made an AI
-- request that day" (a row in ai_usage_user for that usage_date). It is
-- the app's ready-made daily engagement signal and matches what the
-- existing token/quota daily charts already measure; read-only-without-AI
-- days are not counted.

-- ── 1. Searchable users list (server-side search + pagination) ────
-- Returns one row per user with the fields the admin table shows, plus
-- total_count (window count over the full match set, so pagination knows
-- the total regardless of LIMIT).
CREATE OR REPLACE FUNCTION public.admin_users_list(
  p_search text DEFAULT '',
  p_limit integer DEFAULT 25,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  display_name text,
  email text,
  provider text,
  role text,
  storage_tier text,
  subscription_status text,
  created_at timestamptz,
  last_active_at timestamptz,
  book_count bigint,
  chat_count bigint,
  ban_id uuid,
  banned_until timestamptz,
  total_count bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.display_name,
    u.email::text,
    coalesce(u.raw_app_meta_data->>'provider', 'email') AS provider,
    p.role::text,
    p.storage_tier::text,
    p.subscription_status,
    p.created_at,
    GREATEST(
      (SELECT max(a.usage_date)::timestamptz FROM ai_usage_user a WHERE a.user_id = p.id),
      (SELECT max(c.updated_at) FROM chat_conversations c WHERE c.user_id = p.id),
      (SELECT max(r.last_read_at) FROM reading_progress r WHERE r.user_id = p.id)
    ) AS last_active_at,
    (SELECT count(*) FROM books b WHERE b.user_id = p.id)::bigint AS book_count,
    (SELECT count(*) FROM chat_conversations c WHERE c.user_id = p.id)::bigint AS chat_count,
    active_ban.id AS ban_id,
    active_ban.banned_until,
    count(*) OVER ()::bigint AS total_count
  FROM profiles p
  JOIN auth.users u ON u.id = p.id
  LEFT JOIN LATERAL (
    SELECT bn.id, bn.banned_until
    FROM user_bans bn
    WHERE bn.user_id = p.id
      AND (bn.banned_until IS NULL OR bn.banned_until > now())
    ORDER BY bn.created_at DESC
    LIMIT 1
  ) active_ban ON true
  WHERE p_search IS NULL
     OR p_search = ''
     OR p.display_name ILIKE '%' || p_search || '%'
     OR u.email ILIKE '%' || p_search || '%'
  ORDER BY p.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_users_list(text, integer, integer) TO authenticated;

-- ── 2. Activation funnel ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_activation_funnel()
RETURNS TABLE (
  registered bigint,
  onboarded bigint,
  with_book bigint,
  with_chat bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  -- `pf` alias so the bare `onboarded` column is not read as this
  -- function's `onboarded` OUT parameter (same ambiguity class as the
  -- 42702 bucket bug fixed in 00080).
  RETURN QUERY
  SELECT
    (SELECT count(*) FROM profiles)::bigint,
    (SELECT count(*) FROM profiles pf WHERE pf.onboarded)::bigint,
    (SELECT count(DISTINCT b.user_id) FROM books b)::bigint,
    (SELECT count(DISTINCT c.user_id) FROM chat_conversations c)::bigint;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_activation_funnel() TO authenticated;

-- ── 3. Retention (next-day D1 + week-1 D7) ────────────────────────
-- D1: of users registered at least 1 day ago, the share active the day
-- after signup. D7: of users registered at least 7 days ago, the share
-- active at least once in the 7 days after signup. Eligible counts are
-- returned so the UI can render honest percentages on small cohorts.
CREATE OR REPLACE FUNCTION public.admin_retention()
RETURNS TABLE (
  d1_eligible bigint,
  d1_retained bigint,
  d7_eligible bigint,
  d7_retained bigint
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
  WITH cohort AS (
    SELECT p.id, (p.created_at AT TIME ZONE 'utc')::date AS signup_day
    FROM profiles p
  )
  SELECT
    count(*) FILTER (WHERE c.signup_day <= v_today - 1)::bigint,
    count(*) FILTER (
      WHERE c.signup_day <= v_today - 1
        AND EXISTS (
          SELECT 1 FROM ai_usage_user a
          WHERE a.user_id = c.id AND a.usage_date = c.signup_day + 1
        )
    )::bigint,
    count(*) FILTER (WHERE c.signup_day <= v_today - 7)::bigint,
    count(*) FILTER (
      WHERE c.signup_day <= v_today - 7
        AND EXISTS (
          SELECT 1 FROM ai_usage_user a
          WHERE a.user_id = c.id
            AND a.usage_date BETWEEN c.signup_day + 1 AND c.signup_day + 7
        )
    )::bigint
  FROM cohort c;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_retention() TO authenticated;

-- ── 4. Daily active users (distinct users with AI usage per day) ──
CREATE OR REPLACE FUNCTION public.admin_active_users_daily(p_days integer DEFAULT 30)
RETURNS TABLE (day text, active_users bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'utc')::date;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  RETURN QUERY
  WITH agg AS (
    SELECT a.usage_date AS d, count(DISTINCT a.user_id) AS n
    FROM ai_usage_user a
    WHERE a.usage_date >= v_today - (p_days - 1)
    GROUP BY a.usage_date
  )
  SELECT gs::date::text, coalesce(agg.n, 0)::bigint
  FROM generate_series(v_today - (p_days - 1), v_today, interval '1 day') gs
  LEFT JOIN agg ON agg.d = gs::date
  ORDER BY gs;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_active_users_daily(integer) TO authenticated;

-- ── 5. Storage usage (total + top users by bytes) ─────────────────
-- total_bytes is the whole-table sum repeated on every row so the UI can
-- read it once; rows are the top-N users by their own footprint.
CREATE OR REPLACE FUNCTION public.admin_storage_usage(p_limit integer DEFAULT 10)
RETURNS TABLE (
  user_id uuid,
  display_name text,
  bytes bigint,
  total_bytes bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  RETURN QUERY
  SELECT
    b.user_id,
    pr.display_name,
    sum(coalesce(bf.size_bytes, 0))::bigint AS bytes,
    (SELECT coalesce(sum(size_bytes), 0) FROM book_files)::bigint AS total_bytes
  FROM book_files bf
  JOIN books b ON b.id = bf.book_id
  LEFT JOIN profiles pr ON pr.id = b.user_id
  GROUP BY b.user_id, pr.display_name
  -- order by the aggregate expression, not the `bytes` alias, which also
  -- names an OUT parameter (avoids the OUT-param/column ambiguity class).
  ORDER BY sum(coalesce(bf.size_bytes, 0)) DESC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_storage_usage(integer) TO authenticated;
