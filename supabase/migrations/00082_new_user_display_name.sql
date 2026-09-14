-- Fix: the display name entered at sign-up was never saved.
--
-- signUp() stashes it in auth.users.raw_user_meta_data.display_name, but the
-- handle_new_user() trigger only inserted profiles(id), so profiles.display_name
-- stayed null forever (every account showed "no display name"). Copy it across.
-- Also pins search_path on this SECURITY DEFINER trigger (an open item from the
-- 2026-08-27 security audit).

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    nullif(trim(new.raw_user_meta_data ->> 'display_name'), '')
  );
  return new;
end;
$$;

-- Backfill existing accounts that have a name in auth metadata but a blank
-- profile display_name (created before this fix).
update public.profiles p
set display_name = nullif(trim(u.raw_user_meta_data ->> 'display_name'), '')
from auth.users u
where u.id = p.id
  and (p.display_name is null or p.display_name = '')
  and nullif(trim(u.raw_user_meta_data ->> 'display_name'), '') is not null;
