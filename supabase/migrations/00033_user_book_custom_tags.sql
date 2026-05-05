-- ============================================================
-- Migration 00033: Free-text custom book tags
-- ============================================================
-- Status tags (`user_book_tags`) are a closed enum — currently_reading,
-- want_to_read, done, abandoned, hiatus, favorites. They model where
-- the book sits in the user's reading workflow.
--
-- Custom tags are open-ended user-defined labels — "thesis-related",
-- "exam-prep", "loaned-to-Anna", "re-read-2026" — used for freeform
-- search and personal organisation. Kept in a separate table so the
-- enum semantics of the status table stay clean.
-- ============================================================

CREATE TABLE user_book_custom_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  catalog_book_id uuid REFERENCES catalog_books(id) ON DELETE CASCADE,
  book_id uuid REFERENCES books(id) ON DELETE CASCADE,
  label text NOT NULL,
  created_at timestamptz DEFAULT now(),

  -- Mirror the status-tag table's invariant: exactly one book reference.
  CONSTRAINT one_book_ref_custom CHECK (
    (catalog_book_id IS NOT NULL AND book_id IS NULL) OR
    (catalog_book_id IS NULL AND book_id IS NOT NULL)
  ),

  -- Cap the label length (UI badges and DB index size both benefit) and
  -- forbid empty / whitespace-only labels at the schema level.
  CONSTRAINT label_length CHECK (
    char_length(label) BETWEEN 1 AND 50
    AND btrim(label) <> ''
  ),

  -- Unique per (user, book, label). Case-insensitive uniqueness via
  -- functional index below — we still store the user's original casing.
  CONSTRAINT uq_user_catalog_custom_tag UNIQUE (user_id, catalog_book_id, label),
  CONSTRAINT uq_user_uploaded_custom_tag UNIQUE (user_id, book_id, label)
);

CREATE INDEX idx_ubct_user_id ON user_book_custom_tags(user_id);
CREATE INDEX idx_ubct_catalog_book_id ON user_book_custom_tags(catalog_book_id);
CREATE INDEX idx_ubct_book_id ON user_book_custom_tags(book_id);

ALTER TABLE user_book_custom_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own custom tags"
  ON user_book_custom_tags FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can create their own custom tags"
  ON user_book_custom_tags FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete their own custom tags"
  ON user_book_custom_tags FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());
