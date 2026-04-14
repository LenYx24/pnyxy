-- 00006_storage_tiers.sql
-- Storage tier system: free (100 MB) / premium (5 GB) with enforcement trigger

-- ============================================================
-- ENUM: storage_tier
-- ============================================================
CREATE TYPE storage_tier AS ENUM ('free', 'premium');

-- ============================================================
-- Add storage_tier column to profiles
-- ============================================================
ALTER TABLE public.profiles
  ADD COLUMN storage_tier storage_tier NOT NULL DEFAULT 'free';

-- ============================================================
-- Add folder_id to books (so uploaded books can be organized)
-- ============================================================
ALTER TABLE public.books
  ADD COLUMN folder_id uuid REFERENCES public.folders(id) ON DELETE SET NULL;

CREATE INDEX books_folder_idx ON public.books (folder_id);

-- ============================================================
-- Helper: get total storage usage (bytes) for a user
-- ============================================================
CREATE OR REPLACE FUNCTION get_user_storage_usage(uid uuid)
RETURNS bigint AS $$
  SELECT COALESCE(SUM(bf.size_bytes), 0)::bigint
  FROM book_files bf
  JOIN books b ON b.id = bf.book_id
  WHERE b.user_id = uid;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ============================================================
-- Helper: get storage limit (bytes) for a user based on tier
-- ============================================================
CREATE OR REPLACE FUNCTION get_user_storage_limit(uid uuid)
RETURNS bigint AS $$
  SELECT CASE p.storage_tier
    WHEN 'free'    THEN 104857600   -- 100 MB
    WHEN 'premium' THEN 5368709120  -- 5 GB
  END
  FROM profiles p
  WHERE p.id = uid;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ============================================================
-- Trigger: enforce storage limit on book_files INSERT
-- ============================================================
CREATE OR REPLACE FUNCTION check_storage_limit()
RETURNS trigger AS $$
DECLARE
  owner_id uuid;
  current_usage bigint;
  max_limit bigint;
BEGIN
  SELECT b.user_id INTO owner_id
  FROM books b WHERE b.id = NEW.book_id;

  current_usage := get_user_storage_usage(owner_id);
  max_limit     := get_user_storage_limit(owner_id);

  IF (current_usage + COALESCE(NEW.size_bytes, 0)) > max_limit THEN
    RAISE EXCEPTION 'Storage limit exceeded. Used: % bytes, Limit: % bytes', current_usage, max_limit;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER enforce_storage_limit
  BEFORE INSERT ON public.book_files
  FOR EACH ROW EXECUTE FUNCTION check_storage_limit();
