-- Admin-editable config for the LLM choices offered in Pnyxy. The model
-- definitions themselves stay in code (src/lib/ai/ai-models.ts, keyed by
-- provider); this table only holds the parts an admin should be able to
-- change without a deploy: whether a model is offered, its order in the
-- picker, and its (approximate) price. `model_key` matches the catalog's
-- provider key. Read is public (the picker needs enabled + order); writes
-- are admin-only.

create table if not exists public.ai_model_config (
  model_key text primary key,
  enabled boolean not null default true,
  sort_order integer not null default 0,
  -- Approximate USD price per 1M tokens; null = not billed / unknown (free
  -- proxy, local model). Admin-maintained, informational.
  price_input_per_mtok numeric(10, 4),
  price_output_per_mtok numeric(10, 4),
  updated_at timestamptz not null default now()
);

alter table public.ai_model_config enable row level security;

-- The picker (and the help modal) read this for every user, including the
-- logged-out sample flow, so read is open. It exposes no user data.
drop policy if exists "ai_model_config read" on public.ai_model_config;
create policy "ai_model_config read"
  on public.ai_model_config for select
  using (true);

-- Only admins change the offering / order / price.
drop policy if exists "ai_model_config admin write" on public.ai_model_config;
create policy "ai_model_config admin write"
  on public.ai_model_config for all
  using (public.is_admin())
  with check (public.is_admin());

-- Seed one row per current catalog entry with sensible defaults + the
-- approximate prices already documented in ai-models.ts costNotes.
insert into public.ai_model_config
  (model_key, enabled, sort_order, price_input_per_mtok, price_output_per_mtok)
values
  ('pnyxy',     true, 0, null, null),
  ('anthropic', true, 1, 3.0000, 15.0000),
  ('openai',    true, 2, 0.1500, 0.6000),
  ('local',     true, 3, null, null)
on conflict (model_key) do nothing;

-- Keep updated_at fresh on writes.
create or replace function public.touch_ai_model_config()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists ai_model_config_touch on public.ai_model_config;
create trigger ai_model_config_touch
  before update on public.ai_model_config
  for each row execute function public.touch_ai_model_config();
