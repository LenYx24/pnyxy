-- ── Chat sort_order: conversations + folder backfill ──────
--
-- The chat sidebar lets the user drag conversations and folders
-- into a custom order. Before this migration the order was
-- localStorage-backed (per-device, per-user), which lost the
-- arrangement on every new browser / device. This migration
-- promotes the ordering to the database so it syncs across
-- sessions like every other piece of chat state.
--
-- Conventions for the column:
--   * Lower sort_order = earlier in the list (ascending order).
--   * double precision so fractional values can be inserted
--     between existing rows without renumbering. Drag-and-drop
--     reorder code computes `(above + below) / 2` and writes a
--     single row, instead of batch-updating all siblings.
--   * Per-user namespace. Sibling ordering only meaningfully
--     compares rows within the same user (and, for folders,
--     within the same parent).
--
-- For folders, the column already exists (`sort_order integer
-- NOT NULL DEFAULT 0` from the unified folders migration), but
-- it's been unused — every row sits at 0. We backfill with
-- per-user row_number based on created_at so drag-reorder has a
-- sane starting point, and widen the type to double precision
-- so the same fractional-insert pattern works for folders too.
-- The library page doesn't currently read sort_order from the
-- DB (it uses its own localStorage map), so widening the type
-- and rewriting values is safe.

-- ── Conversations ──────────────────────────────────────────

ALTER TABLE public.chat_conversations
  ADD COLUMN sort_order double precision;

-- Backfill: newest conversation (largest updated_at) gets the
-- lowest sort_order so the recently-touched threads stay at the
-- top of the sidebar — that's the historic visual order and
-- matches what users expect on first load after this migration.
UPDATE public.chat_conversations c
SET sort_order = sub.rn
FROM (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY user_id
      ORDER BY updated_at DESC
    ) AS rn
  FROM public.chat_conversations
) sub
WHERE c.id = sub.id;

ALTER TABLE public.chat_conversations
  ALTER COLUMN sort_order SET NOT NULL,
  ALTER COLUMN sort_order SET DEFAULT 0;

-- Useful for the per-user ascending fetch the client does on
-- mount. Without this the planner had to sort the whole table
-- partition every time the chat sidebar loaded.
CREATE INDEX IF NOT EXISTS chat_conversations_user_sort_order_idx
  ON public.chat_conversations (user_id, sort_order ASC);

-- ── Folders ────────────────────────────────────────────────

-- Widen the existing integer column to double precision so the
-- fractional-midpoint insert pattern works for folders too. The
-- USING clause is implicit for widening but kept explicit so the
-- migration reads cleanly.
ALTER TABLE public.folders
  ALTER COLUMN sort_order TYPE double precision USING sort_order::double precision;

-- Backfill: existing folders all have sort_order = 0, which
-- isn't useful for ordering. Number them per-user by created_at
-- so the user's first folder sits at the top.
UPDATE public.folders f
SET sort_order = sub.rn
FROM (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY user_id
      ORDER BY created_at ASC
    ) AS rn
  FROM public.folders
) sub
WHERE f.id = sub.id;

CREATE INDEX IF NOT EXISTS folders_user_sort_order_idx
  ON public.folders (user_id, sort_order ASC);
