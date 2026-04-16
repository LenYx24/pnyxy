-- 00009_auth_user_metadata.sql
-- Populate profiles.display_name and profiles.avatar_url from auth.users.raw_user_meta_data
-- so that email signups carrying a display_name and OAuth providers (Google, etc.)
-- automatically hydrate the profile row created by the existing on_auth_user_created trigger.
--
-- Covers:
--   * Email signup with { options: { data: { display_name } } }
--   * Google OAuth users (full_name / name / picture claims)
--
-- The trigger on_auth_user_created (defined in 00001) is left untouched; only the
-- function it calls is replaced.

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'display_name',
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name'
    ),
    coalesce(
      new.raw_user_meta_data->>'avatar_url',
      new.raw_user_meta_data->>'picture'
    )
  );
  return new;
end;
$$ language plpgsql security definer;
