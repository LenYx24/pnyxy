-- ============================================================
-- Migration 00075: admin user detail RPC
--
-- Per-user drill-in for the admin Users tab (AdminUserDetailPage).
-- Returns the user's email (auth.users, never otherwise exposed to
-- the client) plus account metadata and usage aggregates, so the
-- admin panel does not need direct table access to auth.users or to
-- other users' per-row content. SECURITY DEFINER, gated behind
-- public.is_admin() (00004), same pattern as the admin_* RPCs in
-- migration 00047.
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_user_detail(p_user uuid)
RETURNS TABLE (
  email               text,
  created_at          timestamptz,
  storage_tier        text,
  books_count         bigint,
  notes_count         bigint,
  quizzes_count       bigint,
  conversations_count bigint,
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

  RETURN QUERY
  SELECT
    u.email,
    p.created_at,
    p.storage_tier::text,
    (SELECT count(*) FROM books WHERE user_id = p_user),
    (SELECT count(*) FROM notes WHERE user_id = p_user),
    (SELECT count(*) FROM quizzes WHERE user_id = p_user),
    (SELECT count(*) FROM chat_conversations WHERE user_id = p_user),
    (SELECT coalesce(sum(tokens_used), 0)::bigint
       FROM ai_usage_user
       WHERE user_id = p_user AND usage_date >= v_today - 30)
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE p.id = p_user;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_user_detail(uuid) TO authenticated;
