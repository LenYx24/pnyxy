-- Add folder_id to user_library so users can organize catalog books into folders
ALTER TABLE public.user_library
  ADD COLUMN folder_id uuid REFERENCES public.folders(id) ON DELETE SET NULL;

CREATE INDEX user_library_folder_idx ON public.user_library (folder_id);

-- user_library currently lacks an UPDATE policy, needed for moving books between folders
CREATE POLICY "Users can update own library"
  ON public.user_library FOR UPDATE
  USING (auth.uid() = user_id);
