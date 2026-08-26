-- BSz1 pilot course, A-block: invite-code join for private spaces and a
-- shared file store per space ("glorified Nextcloud": the owner uploads
-- course materials, members read them and work on their own copies).

-- ── 1. Invite codes ─────────────────────────────────────────
ALTER TABLE public.spaces
  ADD COLUMN IF NOT EXISTS invite_code text UNIQUE;

-- Owner-only: (re)generate the code. Rotating invalidates the old link.
CREATE OR REPLACE FUNCTION public.rotate_space_invite_code(p_space uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text;
BEGIN
  IF NOT public.is_space_owner(p_space) THEN
    RAISE EXCEPTION 'not_space_owner';
  END IF;
  v_code := substr(md5(gen_random_uuid()::text), 1, 8);
  UPDATE public.spaces SET invite_code = v_code WHERE id = p_space;
  RETURN v_code;
END;
$$;
GRANT EXECUTE ON FUNCTION public.rotate_space_invite_code(uuid) TO authenticated;

-- Join a (typically private) space with its code. Returns the space id
-- so the client can navigate there. Idempotent for existing members.
CREATE OR REPLACE FUNCTION public.join_space_with_code(p_code text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_space uuid;
BEGIN
  SELECT id INTO v_space
  FROM public.spaces
  WHERE invite_code = lower(trim(p_code));
  IF v_space IS NULL THEN
    RAISE EXCEPTION 'invalid_invite_code';
  END IF;
  INSERT INTO public.space_members (space_id, user_id, role)
  VALUES (v_space, auth.uid(), 'member')
  ON CONFLICT DO NOTHING;
  RETURN v_space;
END;
$$;
GRANT EXECUTE ON FUNCTION public.join_space_with_code(text) TO authenticated;

-- ── 2. Shared file store ───────────────────────────────────
-- Path convention: <space_id>/<file_name>. Members read, the owner
-- writes (moderator upload can come later with a role check here).
INSERT INTO storage.buckets (id, name, public)
VALUES ('space-files', 'space-files', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "space files member read" ON storage.objects;
CREATE POLICY "space files member read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'space-files'
    AND public.is_space_member(((storage.foldername(name))[1])::uuid)
  );

DROP POLICY IF EXISTS "space files owner insert" ON storage.objects;
CREATE POLICY "space files owner insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'space-files'
    AND public.is_space_owner(((storage.foldername(name))[1])::uuid)
  );

DROP POLICY IF EXISTS "space files owner update" ON storage.objects;
CREATE POLICY "space files owner update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'space-files'
    AND public.is_space_owner(((storage.foldername(name))[1])::uuid)
  );

DROP POLICY IF EXISTS "space files owner delete" ON storage.objects;
CREATE POLICY "space files owner delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'space-files'
    AND public.is_space_owner(((storage.foldername(name))[1])::uuid)
  );

-- ── 3. Copy provenance ─────────────────────────────────────
-- A member's personal copy remembers which course it came from; the
-- per-course stats and goal tracking key off this.
ALTER TABLE public.books
  ADD COLUMN IF NOT EXISTS source_space_id uuid
    REFERENCES public.spaces(id) ON DELETE SET NULL;
