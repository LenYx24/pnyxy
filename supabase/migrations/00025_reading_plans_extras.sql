-- ============================================================
-- 00025_reading_plans_extras.sql
-- Adds free-form description + a color palette key on plans.
--
-- The color is a short palette identifier (e.g. "purple", "blue")
-- mapped to Tailwind classes in the UI. Storing the key rather
-- than a raw hex keeps the rendering consistent with the app's
-- theme and lets us swap palettes later without a migration.
-- ============================================================

alter table public.reading_plans
  add column description text,
  add column color       text;
