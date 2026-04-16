-- ============================================================
-- Migration 00007: Hierarchical categories + fixed status tags
-- ============================================================

-- ── 1. Make categories hierarchical & user-creatable ─────────

ALTER TABLE categories
  ADD COLUMN parent_id uuid REFERENCES categories(id) ON DELETE CASCADE,
  ADD COLUMN created_by uuid REFERENCES auth.users ON DELETE SET NULL,
  ADD COLUMN description text;

CREATE INDEX idx_categories_parent_id ON categories(parent_id);

-- RLS for categories: everyone can read, authenticated can create,
-- creator can update/delete their own
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Categories are viewable by everyone" ON categories;
CREATE POLICY "Categories are viewable by everyone"
  ON categories FOR SELECT
  USING (true);

CREATE POLICY "Authenticated users can create categories"
  ON categories FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Creators can update their own categories"
  ON categories FOR UPDATE
  TO authenticated
  USING (created_by = auth.uid());

CREATE POLICY "Creators can delete their own categories"
  ON categories FOR DELETE
  TO authenticated
  USING (created_by = auth.uid());

-- ── 2. Category junction: catalog_book_categories ────────────

CREATE TABLE catalog_book_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  catalog_book_id uuid NOT NULL REFERENCES catalog_books(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  UNIQUE (catalog_book_id, category_id)
);

CREATE INDEX idx_cbc_catalog_book_id ON catalog_book_categories(catalog_book_id);
CREATE INDEX idx_cbc_category_id ON catalog_book_categories(category_id);

ALTER TABLE catalog_book_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "catalog_book_categories are viewable by everyone"
  ON catalog_book_categories FOR SELECT
  USING (true);

CREATE POLICY "Authenticated users can link catalog books to categories"
  ON catalog_book_categories FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can unlink catalog books from categories"
  ON catalog_book_categories FOR DELETE
  TO authenticated
  USING (true);

-- ── 3. Category junction: book_categories (uploaded books) ───

CREATE TABLE book_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  UNIQUE (book_id, category_id)
);

CREATE INDEX idx_bc_book_id ON book_categories(book_id);
CREATE INDEX idx_bc_category_id ON book_categories(category_id);

ALTER TABLE book_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "book_categories are viewable by everyone"
  ON book_categories FOR SELECT
  USING (true);

CREATE POLICY "Authenticated users can link books to categories"
  ON book_categories FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can unlink books from categories"
  ON book_categories FOR DELETE
  TO authenticated
  USING (true);

-- ── 4. Fixed status tags ─────────────────────────────────────

CREATE TYPE book_status_tag AS ENUM (
  'currently_reading',
  'want_to_read',
  'done',
  'abandoned',
  'hiatus',
  'favorites'
);

CREATE TABLE user_book_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  catalog_book_id uuid REFERENCES catalog_books(id) ON DELETE CASCADE,
  book_id uuid REFERENCES books(id) ON DELETE CASCADE,
  tag book_status_tag NOT NULL,
  created_at timestamptz DEFAULT now(),

  -- Exactly one of catalog_book_id or book_id must be non-null
  CONSTRAINT one_book_ref CHECK (
    (catalog_book_id IS NOT NULL AND book_id IS NULL) OR
    (catalog_book_id IS NULL AND book_id IS NOT NULL)
  ),

  -- Unique per user per catalog book per tag
  CONSTRAINT uq_user_catalog_tag UNIQUE (user_id, catalog_book_id, tag),
  -- Unique per user per uploaded book per tag
  CONSTRAINT uq_user_book_tag UNIQUE (user_id, book_id, tag)
);

CREATE INDEX idx_ubt_user_id ON user_book_tags(user_id);
CREATE INDEX idx_ubt_catalog_book_id ON user_book_tags(catalog_book_id);
CREATE INDEX idx_ubt_book_id ON user_book_tags(book_id);

ALTER TABLE user_book_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own tags"
  ON user_book_tags FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can create their own tags"
  ON user_book_tags FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete their own tags"
  ON user_book_tags FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- ── 5. Seed default top-level categories ─────────────────────

INSERT INTO categories (name, slug, sort_order)
VALUES
  ('Fiction',     'fiction',     1),
  ('Non-fiction', 'non-fiction', 2),
  ('Science',    'science',     3),
  ('Technology', 'technology',  4),
  ('History',    'history',     5),
  ('Philosophy', 'philosophy',  6),
  ('Mathematics','mathematics', 7),
  ('Art',        'art',         8)
ON CONFLICT (slug) DO NOTHING;
