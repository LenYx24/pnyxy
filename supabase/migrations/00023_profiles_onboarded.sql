-- 00023_profiles_onboarded.sql
-- Add an `onboarded` flag to profiles so the post-login welcome page
-- only shows on a user's first successful sign-in. Existing users
-- (rows that already exist when this runs) are backfilled to `true`
-- so they don't get re-onboarded after deploy. The default flips to
-- `false` afterward so new signups (handled by handle_new_user())
-- start out un-onboarded and land on /auth/welcome.

alter table profiles
  add column onboarded boolean not null default true;

alter table profiles
  alter column onboarded set default false;
