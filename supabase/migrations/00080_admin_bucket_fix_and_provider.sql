-- Admin analytics: two changes.
--
-- 1. Fix `column reference "bucket" is ambiguous (42702)` in
--    admin_books_per_user_histogram(). In a plpgsql RETURNS TABLE
--    function the OUT columns (bucket, sort_order) are in scope by name
--    inside the query, so a bare `bucket` / `sort_order` in the final
--    SELECT/GROUP BY/ORDER BY collides with the `bucketed` CTE's columns.
--    Qualify every reference with the CTE name (matches the working
--    pattern in admin_quota_utilization_histogram, migration 00050).
--
-- 2. Add admin_provider_breakdown(): how many users signed in with
--    Google vs email+password, for the admin stats. Counted over the
--    same population as admin_overview (profiles joined to auth.users),
--    so the slices sum to the dashboard's total user count.

-- ── 1. Books-per-user histogram (ambiguous-bucket fix) ────────────
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
  SELECT bucketed.bucket, bucketed.sort_order, count(*)::bigint
  FROM bucketed
  GROUP BY bucketed.bucket, bucketed.sort_order
  ORDER BY bucketed.sort_order;
END;
$$;

-- ── 2. Sign-in provider breakdown (Google vs password) ────────────
CREATE OR REPLACE FUNCTION public.admin_provider_breakdown()
RETURNS TABLE (provider text, users bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  RETURN QUERY
  SELECT
    coalesce(u.raw_app_meta_data->>'provider', 'email') AS provider,
    count(*)::bigint                                     AS users
  FROM profiles p
  JOIN auth.users u ON u.id = p.id
  GROUP BY coalesce(u.raw_app_meta_data->>'provider', 'email')
  ORDER BY users DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_provider_breakdown() TO authenticated;
