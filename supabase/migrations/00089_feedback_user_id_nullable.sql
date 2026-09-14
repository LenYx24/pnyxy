-- Second feedback schema drift: the live `feedback.user_id` was created NOT
-- NULL (feedback used to require sign-in), but anonymous feedback needs a null
-- user_id, and the current 00086 schema declares it nullable. The remote never
-- got that relaxation because 00086 was already applied. Drop the constraint so
-- anonymous /feedback submissions stop failing with 23502 (which surfaced as a
-- 500). Idempotent: DROP NOT NULL is a no-op if it is already nullable.
alter table public.feedback alter column user_id drop not null;
