-- Moodle-style course page: ordered, titled sections that hold the
-- course items in a single column. Items (space_content) point at a
-- section; unsectioned items render in the implicit "General" group.
-- Uploaded course files become 'file' content rows (url = storage path
-- in the space-files bucket) so they can live inside a section too.

create table if not exists public.space_sections (
  id          uuid primary key default gen_random_uuid(),
  space_id    uuid not null references public.spaces(id) on delete cascade,
  title       text not null default '',
  description text,
  sort_order  double precision not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists space_sections_space_idx
  on public.space_sections (space_id, sort_order);

alter table public.space_sections enable row level security;

drop policy if exists "read space sections" on public.space_sections;
create policy "read space sections"
  on public.space_sections for select
  to authenticated
  using (
    public.space_is_public(space_id)
    or public.is_space_member(space_id)
    or public.is_space_owner(space_id)
  );

drop policy if exists "owner inserts space sections" on public.space_sections;
create policy "owner inserts space sections"
  on public.space_sections for insert
  to authenticated
  with check (public.is_space_owner(space_id));

drop policy if exists "owner updates space sections" on public.space_sections;
create policy "owner updates space sections"
  on public.space_sections for update
  to authenticated
  using (public.is_space_owner(space_id))
  with check (public.is_space_owner(space_id));

drop policy if exists "owner deletes space sections" on public.space_sections;
create policy "owner deletes space sections"
  on public.space_sections for delete
  to authenticated
  using (public.is_space_owner(space_id));

-- items -> section (null = general)
alter table public.space_content
  add column if not exists section_id uuid
    references public.space_sections(id) on delete set null;

create index if not exists space_content_section_idx
  on public.space_content (section_id, sort_order);

-- new item kinds: an uploaded course file and a plain text label/notice
alter type public.space_content_kind add value if not exists 'file';
alter type public.space_content_kind add value if not exists 'label';
