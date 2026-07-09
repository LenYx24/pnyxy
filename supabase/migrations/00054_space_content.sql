-- ============================================================
-- 00054_space_content.sql
-- Course content: attach library items (books, resources, quizzes,
-- roadmaps, ...) to a space (a "course" in the spaces hierarchy from
-- 00052). A course page lists these; enrolling = joining the space
-- (space_members, already exists). Kept denormalized (title/subtitle/
-- url snapshot + generic ref_id) so the course page renders without
-- joining five content tables.
-- ============================================================

create type public.space_content_kind as enum (
  'book', 'resource', 'quiz', 'roadmap', 'note', 'whiteboard', 'link'
);

create table public.space_content (
  id          uuid primary key default gen_random_uuid(),
  space_id    uuid not null references public.spaces(id) on delete cascade,
  kind        public.space_content_kind not null,
  -- generic reference to the underlying content (catalog_book_id / resource
  -- id / quiz id / roadmap id ...); null for pure 'link' items
  ref_id      uuid,
  -- denormalized snapshot for rendering the course list cheaply
  title       text not null default '',
  subtitle    text,
  url         text,
  sort_order  double precision not null default 0,
  added_by    uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index space_content_space_idx on public.space_content (space_id, sort_order);

-- ── RLS ───────────────────────────────────────────────────
-- Reuses the SECURITY DEFINER helpers from 00052 to avoid recursion.
alter table public.space_content enable row level security;

create policy "read space content"
  on public.space_content for select
  to authenticated
  using (
    public.space_is_public(space_id)
    or public.is_space_member(space_id)
    or public.is_space_owner(space_id)
  );

create policy "owner inserts space content"
  on public.space_content for insert
  to authenticated
  with check (public.is_space_owner(space_id));

create policy "owner updates space content"
  on public.space_content for update
  to authenticated
  using (public.is_space_owner(space_id))
  with check (public.is_space_owner(space_id));

create policy "owner deletes space content"
  on public.space_content for delete
  to authenticated
  using (public.is_space_owner(space_id));
