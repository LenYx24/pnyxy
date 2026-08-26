-- Admins can delete any space (e.g. seeded/demo spaces); owners keep
-- their own delete right. Children, members and content cascade via FKs.
DROP POLICY IF EXISTS "spaces_delete" ON public.spaces;
CREATE POLICY "spaces_delete" ON public.spaces
  FOR DELETE TO authenticated
  USING (owner_id = auth.uid() OR public.is_admin());
