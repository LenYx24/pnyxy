-- Admin analytics: list the users who registered within a recent window.
--
-- Backs the clickable "New users" KPI on the Analytics tab: not just how
-- many signed up in the selected range, but who they are (name, email,
-- sign-in method, when). Same house pattern as 00047/00080/00081:
-- plpgsql STABLE SECURITY DEFINER, is_admin() guard, UTC date bucketing,
-- provider derived exactly like admin_provider_breakdown/admin_users_list,
-- GRANT EXECUTE TO authenticated.
--
-- The window matches admin_signups_daily: rows with created_at on or
-- after (today - (p_days - 1)) in UTC, so summing that chart's signups
-- over the range equals this list's length. p_days is floored at 1 so
-- the "1d" range returns exactly today's registrations.
--
-- OUT-param note (see 00080 lesson): every column is qualified
-- (p.*, u.*) so no bare reference collides with an OUT name.

CREATE OR REPLACE FUNCTION public.admin_new_users(p_days integer DEFAULT 30)
RETURNS TABLE (
  id uuid,
  display_name text,
  email text,
  provider text,
  created_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_since date := (now() AT TIME ZONE 'utc')::date - (GREATEST(p_days, 1) - 1);
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
    p.created_at
  FROM profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE (p.created_at AT TIME ZONE 'utc')::date >= v_since
  ORDER BY p.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_new_users(integer) TO authenticated;
