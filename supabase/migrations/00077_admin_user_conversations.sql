-- ============================================================
-- Migration 00077: admin user conversations RPC
--
-- Read-only drill-in for the admin Users tab (AdminUserDetailPage):
-- returns one user's chat conversations together with their messages,
-- so the pilot owner can review the learning conversations of pilot
-- participants for the thesis research.
--
-- SECURITY DEFINER, gated behind public.is_admin() (00004), search_path
-- pinned, same pattern as the admin_* RPCs in migrations 00047/00075.
--
-- IMPORTANT: this function does NOT filter by consent. An admin can
-- technically read any user's rows; instead it RETURNS a per-user
-- `consent_content` flag (derived from profiles.preferences
-- .consent_content_at, the in-app optional content-review opt-in) so
-- the UI can make the consent state explicit. The owner is expected to
-- only review users who consented via the recruiting form.
--
-- chat_messages has no per-message `model` column, so messages carry
-- role, content, created_at and the optional `error` marker (00071).
-- Content is length-capped defensively; the message list per
-- conversation and the conversation list are both capped.
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_user_conversations(p_user uuid)
RETURNS TABLE (
  conversation_id uuid,
  title           text,
  created_at      timestamptz,
  updated_at      timestamptz,
  consent_content boolean,
  messages        jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_consent boolean;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  -- Content-review opt-in: preferences.consent_content_at is an ISO
  -- timestamp when granted, null / absent when not (or revoked).
  SELECT (
    p.preferences ? 'consent_content_at'
    AND (p.preferences ->> 'consent_content_at') IS NOT NULL
  )
  INTO v_consent
  FROM public.profiles p
  WHERE p.id = p_user;

  RETURN QUERY
  SELECT
    c.id,
    c.title,
    c.created_at,
    c.updated_at,
    COALESCE(v_consent, false),
    COALESCE(
      (
        SELECT jsonb_agg(sub.m ORDER BY sub.created_at)
        FROM (
          SELECT
            jsonb_build_object(
              'role', cm.role,
              'content', left(cm.content, 8000),
              'error', cm.error,
              'created_at', cm.created_at
            ) AS m,
            cm.created_at
          FROM public.chat_messages cm
          WHERE cm.conversation_id = c.id
          ORDER BY cm.created_at
          LIMIT 500
        ) sub
      ),
      '[]'::jsonb
    )
  FROM public.chat_conversations c
  WHERE c.user_id = p_user
  ORDER BY c.updated_at DESC
  LIMIT 50;
END;
$$;

-- Default privileges are revoked repo-wide (00072), so grant explicitly.
GRANT EXECUTE ON FUNCTION public.admin_user_conversations(uuid) TO authenticated;
