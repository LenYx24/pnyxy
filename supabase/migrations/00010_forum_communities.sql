-- ============================================================
-- 00010_forum_communities.sql
-- Forum Phase 1: communities, memberships, posts, comments
-- ============================================================

-- ── Enums ───────────────────────────────────────────────────

create type public.community_kind as enum ('topic');
create type public.community_role as enum ('member', 'mod', 'owner');
create type public.post_kind as enum ('text', 'link');

-- ── Tables (created first, policies added after all exist) ──

create table public.communities (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,
  name          text not null,
  kind          public.community_kind not null default 'topic',
  description   text not null default '',
  created_by    uuid not null references public.profiles(id) on delete cascade,
  created_at    timestamptz not null default now(),
  member_count  int not null default 0,
  avatar_url    text,
  banner_url    text,

  constraint slug_format check (slug ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$')
);

create index communities_slug_idx on public.communities (slug);
create index communities_created_by_idx on public.communities (created_by);
create index communities_member_count_idx on public.communities (member_count desc);

create table public.community_memberships (
  user_id       uuid not null references public.profiles(id) on delete cascade,
  community_id  uuid not null references public.communities(id) on delete cascade,
  role          public.community_role not null default 'member',
  joined_at     timestamptz not null default now(),
  primary key (user_id, community_id)
);

create index cm_community_id_idx on public.community_memberships (community_id);
create index cm_user_id_idx on public.community_memberships (user_id);

create table public.posts (
  id              uuid primary key default gen_random_uuid(),
  community_id    uuid not null references public.communities(id) on delete cascade,
  author_id       uuid not null references public.profiles(id) on delete cascade,
  title           text not null,
  kind            public.post_kind not null default 'text',
  body_md         text,
  link_url        text,
  created_at      timestamptz not null default now(),
  edited_at       timestamptz,
  is_removed      bool not null default false,
  score_cached    int not null default 0,
  comment_count   int not null default 0,
  last_activity   timestamptz not null default now()
);

create index posts_community_created_idx on public.posts (community_id, created_at desc);
create index posts_community_activity_idx on public.posts (community_id, last_activity desc);
create index posts_author_idx on public.posts (author_id);

-- Named forum_comments to avoid collision with the existing
-- annotation comments table.
create table public.forum_comments (
  id            uuid primary key default gen_random_uuid(),
  post_id       uuid not null references public.posts(id) on delete cascade,
  parent_id     uuid references public.forum_comments(id) on delete cascade,
  author_id     uuid not null references public.profiles(id) on delete cascade,
  body_md       text not null,
  created_at    timestamptz not null default now(),
  edited_at     timestamptz,
  is_removed    bool not null default false,
  score_cached  int not null default 0
);

create index fc_post_idx on public.forum_comments (post_id, created_at);
create index fc_parent_idx on public.forum_comments (parent_id);
create index fc_author_idx on public.forum_comments (author_id);

-- ── RLS: enable on all tables ───────────────────────────────

alter table public.communities enable row level security;
alter table public.community_memberships enable row level security;
alter table public.posts enable row level security;
alter table public.forum_comments enable row level security;

-- ── RLS: communities ────────────────────────────────────────

create policy "Anyone can read communities"
  on public.communities for select using (true);

create policy "Authenticated users can create communities"
  on public.communities for insert
  to authenticated
  with check (auth.uid() = created_by);

create policy "Owner or admin can update community"
  on public.communities for update
  using (
    public.is_admin()
    or exists (
      select 1 from public.community_memberships
      where user_id = auth.uid()
        and community_id = communities.id
        and role in ('owner', 'mod')
    )
  );

create policy "Admin can delete community"
  on public.communities for delete
  using (public.is_admin());

-- ── RLS: community_memberships ──────────────────────────────

create policy "Anyone can read memberships"
  on public.community_memberships for select using (true);

create policy "Users can join communities"
  on public.community_memberships for insert
  to authenticated
  with check (auth.uid() = user_id and role = 'member');

create policy "Users can leave communities"
  on public.community_memberships for delete
  to authenticated
  using (
    auth.uid() = user_id
    or public.is_admin()
    or exists (
      select 1 from public.community_memberships cm
      where cm.user_id = auth.uid()
        and cm.community_id = community_memberships.community_id
        and cm.role = 'owner'
    )
  );

create policy "Owner or admin can update roles"
  on public.community_memberships for update
  to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.community_memberships cm
      where cm.user_id = auth.uid()
        and cm.community_id = community_memberships.community_id
        and cm.role = 'owner'
    )
  );

-- ── RLS: posts ──────────────────────────────────────────────

create policy "Anyone can read non-removed posts"
  on public.posts for select
  using (not is_removed or public.is_admin());

create policy "Community members can create posts"
  on public.posts for insert
  to authenticated
  with check (
    auth.uid() = author_id
    and exists (
      select 1 from public.community_memberships
      where user_id = auth.uid() and community_id = posts.community_id
    )
  );

create policy "Authors can update own posts"
  on public.posts for update
  to authenticated
  using (auth.uid() = author_id or public.is_admin());

create policy "Author mod or admin can soft-delete posts"
  on public.posts for delete
  to authenticated
  using (
    auth.uid() = author_id
    or public.is_admin()
    or exists (
      select 1 from public.community_memberships
      where user_id = auth.uid()
        and community_id = posts.community_id
        and role in ('owner', 'mod')
    )
  );

-- ── RLS: forum_comments ─────────────────────────────────────

create policy "Anyone can read non-removed comments"
  on public.forum_comments for select
  using (not is_removed or public.is_admin());

create policy "Community members can create comments"
  on public.forum_comments for insert
  to authenticated
  with check (
    auth.uid() = author_id
    and exists (
      select 1 from public.posts p
      join public.community_memberships cm
        on cm.community_id = p.community_id and cm.user_id = auth.uid()
      where p.id = forum_comments.post_id
    )
  );

create policy "Authors can update own comments"
  on public.forum_comments for update
  to authenticated
  using (auth.uid() = author_id or public.is_admin());

create policy "Author mod or admin can delete comments"
  on public.forum_comments for delete
  to authenticated
  using (
    auth.uid() = author_id
    or public.is_admin()
    or exists (
      select 1 from public.posts p
      join public.community_memberships cm
        on cm.community_id = p.community_id
        and cm.user_id = auth.uid()
        and cm.role in ('owner', 'mod')
      where p.id = forum_comments.post_id
    )
  );

-- ── Triggers ────────────────────────────────────────────────

-- Auto-create owner membership on community creation
create or replace function public.handle_new_community()
returns trigger as $$
begin
  insert into public.community_memberships (user_id, community_id, role)
  values (new.created_by, new.id, 'owner');
  return new;
end;
$$ language plpgsql security definer;

create trigger on_community_created
  after insert on public.communities
  for each row execute function public.handle_new_community();

-- Maintain member_count
create or replace function public.update_community_member_count()
returns trigger as $$
begin
  if TG_OP = 'INSERT' then
    update public.communities
    set member_count = member_count + 1
    where id = new.community_id;
    return new;
  elsif TG_OP = 'DELETE' then
    update public.communities
    set member_count = greatest(0, member_count - 1)
    where id = old.community_id;
    return old;
  end if;
  return null;
end;
$$ language plpgsql security definer;

create trigger on_membership_change
  after insert or delete on public.community_memberships
  for each row execute function public.update_community_member_count();

-- Maintain post.comment_count + last_activity
create or replace function public.update_post_comment_stats()
returns trigger as $$
begin
  if TG_OP = 'INSERT' then
    update public.posts
    set comment_count = comment_count + 1,
        last_activity = now()
    where id = new.post_id;
    return new;
  elsif TG_OP = 'DELETE' then
    update public.posts
    set comment_count = greatest(0, comment_count - 1)
    where id = old.post_id;
    return old;
  end if;
  return null;
end;
$$ language plpgsql security definer;

create trigger on_forum_comment_change
  after insert or delete on public.forum_comments
  for each row execute function public.update_post_comment_stats();

-- ── Profile visibility for forum author display ─────────────
-- Existing policy only allows auth.uid() = id. Forum needs
-- to show author display_name/avatar_url on posts/comments.
-- This is additive (OR'd with existing policies).

create policy "Public profile fields readable by all"
  on public.profiles for select using (true);
