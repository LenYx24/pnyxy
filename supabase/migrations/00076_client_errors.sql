-- ============================================================
-- Migration 00076: client error monitoring + bug reports
--
-- Lightweight client-side error capture for the pilot: window
-- error/unhandledrejection listeners, ErrorBoundary catches, and a
-- one-click "report a problem" all funnel into this one table
-- (src/lib/error-report.ts). Write-only from the client (no select
-- policy for users, same pattern as telemetry_events in 00064); the
-- owner reads via the SECURITY DEFINER admin RPC below, same shape as
-- the admin_* RPCs in 00047/00050/00075.
--
-- Idempotent: safe to re-run on a partially applied database.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.client_errors (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  kind        text NOT NULL CHECK (kind IN ('crash', 'error', 'report')),
  message     text,
  route       text,
  user_agent  text,
  context     jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.client_errors ENABLE ROW LEVEL SECURITY;

-- Small structured payloads only: the context blob is capped well under
-- Postgres's own limits, and message can't be used to smuggle a document
-- dump through an error report.
DROP POLICY IF EXISTS client_errors_insert_own ON public.client_errors;
CREATE POLICY client_errors_insert_own ON public.client_errors
  FOR INSERT TO authenticated
  WITH CHECK (
    (user_id = auth.uid() OR user_id IS NULL)
    AND char_length(coalesce(message, '')) <= 4000
    AND (context IS NULL OR pg_column_size(context) < 8192)
  );

-- Crashes can happen before sign-in (landing page, auth flow); anon
-- inserts are allowed but only ever with a null user_id.
DROP POLICY IF EXISTS client_errors_insert_anon ON public.client_errors;
CREATE POLICY client_errors_insert_anon ON public.client_errors
  FOR INSERT TO anon
  WITH CHECK (
    user_id IS NULL
    AND char_length(coalesce(message, '')) <= 4000
    AND (context IS NULL OR pg_column_size(context) < 8192)
  );

-- No SELECT policy: normal users (and anon) can never read this table
-- back, even their own rows. The owner reads through admin_recent_errors.

CREATE INDEX IF NOT EXISTS client_errors_created_at_idx
  ON public.client_errors (created_at DESC);
CREATE INDEX IF NOT EXISTS client_errors_user_id_idx
  ON public.client_errors (user_id);

-- ────────────────────────────────────────────────────────────
-- Admin read RPC: recent crashes/errors/reports, joined to the
-- reporter's display name. SECURITY DEFINER to read past RLS,
-- gated by public.is_admin() (00004), search_path pinned per the
-- 00072 hardening pass. 00072 also revokes default EXECUTE on new
-- functions from public/anon/authenticated, so grant explicitly.
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_recent_errors(
  p_days  int DEFAULT 7,
  p_limit int DEFAULT 200
)
RETURNS TABLE (
  id           uuid,
  user_id      uuid,
  display_name text,
  kind         text,
  message      text,
  route        text,
  user_agent   text,
  context      jsonb,
  created_at   timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  IF p_days IS NULL OR p_days < 1 OR p_days > 365 THEN
    p_days := 7;
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 1000 THEN
    p_limit := 200;
  END IF;

  RETURN QUERY
  SELECT
    ce.id,
    ce.user_id,
    p.display_name,
    ce.kind,
    ce.message,
    ce.route,
    ce.user_agent,
    ce.context,
    ce.created_at
  FROM public.client_errors ce
  LEFT JOIN public.profiles p ON p.id = ce.user_id
  WHERE ce.created_at >= now() - (p_days || ' days')::interval
  ORDER BY ce.created_at DESC
  LIMIT p_limit;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_recent_errors(int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_recent_errors(int, int) TO authenticated;
