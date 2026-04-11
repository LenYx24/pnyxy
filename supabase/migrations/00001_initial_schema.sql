-- 00001_initial_schema.sql
-- Full initial schema for pnyxy-reader

-- ============================================================
-- EXTENSIONS
-- ============================================================
create extension if not exists "pgcrypto";

-- ============================================================
-- ENUMS
-- ============================================================
create type document_format   as enum ('pdf', 'epub');
create type book_visibility   as enum ('private', 'public');
create type highlight_color   as enum ('yellow', 'green', 'blue', 'pink', 'orange');

-- ============================================================
-- HELPER: updated_at trigger
-- ============================================================
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ============================================================
-- 1. PROFILES
-- ============================================================
create table profiles (
  id           uuid primary key references auth.users on delete cascade,
  display_name text,
  avatar_url   text,
  preferences  jsonb not null default '{}',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger profiles_updated_at
  before update on profiles
  for each row execute function set_updated_at();

-- Auto-create profile on signup
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id)
  values (new.id);
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ============================================================
-- 2. CATEGORIES (system-defined)
-- ============================================================
create table categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text not null unique,
  icon       text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

-- ============================================================
-- 3. BOOKS
-- ============================================================
create table books (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade,
  title       text not null,
  author      text,
  format      document_format not null default 'pdf',
  page_count  integer,
  cover_url   text,
  file_hash   text,
  visibility  book_visibility not null default 'private',
  category_id uuid references categories on delete set null,
  metadata    jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index books_user_id_idx   on books (user_id);
create index books_file_hash_idx on books (file_hash);
create index books_category_idx  on books (category_id);

create trigger books_updated_at
  before update on books
  for each row execute function set_updated_at();

-- ============================================================
-- 4. BOOK_FILES
-- ============================================================
create table book_files (
  id           uuid primary key default gen_random_uuid(),
  book_id      uuid not null references books on delete cascade,
  storage_path text not null,
  file_name    text not null,
  mime_type    text not null,
  size_bytes   bigint,
  is_primary   boolean not null default true,
  created_at   timestamptz not null default now()
);

create index book_files_book_id_idx on book_files (book_id);

-- ============================================================
-- 5. FOLDERS
-- ============================================================
create table folders (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users on delete cascade,
  parent_id  uuid references folders on delete cascade,
  name       text not null,
  color      text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index folders_user_id_idx  on folders (user_id);
create index folders_parent_idx   on folders (parent_id);

create trigger folders_updated_at
  before update on folders
  for each row execute function set_updated_at();

-- ============================================================
-- 6. FOLDER_ITEMS (junction: folder <-> book)
-- ============================================================
create table folder_items (
  id        uuid primary key default gen_random_uuid(),
  folder_id uuid not null references folders on delete cascade,
  book_id   uuid not null references books   on delete cascade,
  added_at  timestamptz not null default now(),

  unique (folder_id, book_id)
);

create index folder_items_folder_idx on folder_items (folder_id);
create index folder_items_book_idx   on folder_items (book_id);

-- ============================================================
-- 7. TAGS (user-scoped)
-- ============================================================
create table tags (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users on delete cascade,
  name       text not null,
  color      text,
  created_at timestamptz not null default now(),

  unique (user_id, name)
);

create index tags_user_id_idx on tags (user_id);

-- ============================================================
-- 8. BOOK_TAGS (junction: book <-> tag)
-- ============================================================
create table book_tags (
  id      uuid primary key default gen_random_uuid(),
  book_id uuid not null references books on delete cascade,
  tag_id  uuid not null references tags  on delete cascade,

  unique (book_id, tag_id)
);

create index book_tags_book_idx on book_tags (book_id);
create index book_tags_tag_idx  on book_tags (tag_id);

-- ============================================================
-- 9. HIGHLIGHTS
-- ============================================================
create table highlights (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade,
  book_id     uuid not null references books      on delete cascade,
  color       highlight_color not null default 'yellow',
  selection   jsonb not null,          -- { text, rects: [{ pageNum, x, y, width, height }] }
  page_number integer,
  created_at  timestamptz not null default now()
);

create index highlights_user_book_idx on highlights (user_id, book_id);
create index highlights_page_idx      on highlights (book_id, page_number);

-- ============================================================
-- 10. COMMENTS
-- ============================================================
create table comments (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users  on delete cascade,
  book_id      uuid not null references books        on delete cascade,
  highlight_id uuid references highlights            on delete set null,
  selection    jsonb,                  -- nullable: standalone comments may not have a selection
  messages     jsonb not null default '[]',  -- [{ id, text, createdAt }]
  resolved     boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index comments_user_book_idx on comments (user_id, book_id);
create index comments_highlight_idx on comments (highlight_id);

create trigger comments_updated_at
  before update on comments
  for each row execute function set_updated_at();

-- ============================================================
-- 11. NOTES
-- ============================================================
create table notes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users on delete cascade,
  book_id    uuid references books               on delete set null,
  title      text not null default '',
  content    text not null default '',            -- markdown
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index notes_user_id_idx  on notes (user_id);
create index notes_book_id_idx  on notes (book_id);

create trigger notes_updated_at
  before update on notes
  for each row execute function set_updated_at();

-- ============================================================
-- 12. WHITEBOARDS
-- ============================================================
create table whiteboards (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users on delete cascade,
  book_id    uuid references books               on delete set null,
  title      text not null default 'Untitled',
  elements   jsonb not null default '[]',         -- WhiteboardElement[]
  background text not null default 'solid',       -- 'solid' | 'grid'
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index whiteboards_user_id_idx on whiteboards (user_id);
create index whiteboards_book_id_idx on whiteboards (book_id);

create trigger whiteboards_updated_at
  before update on whiteboards
  for each row execute function set_updated_at();

-- ============================================================
-- 13. READING_PROGRESS
-- ============================================================
create table reading_progress (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users on delete cascade,
  book_id            uuid not null references books      on delete cascade,
  current_page       integer not null default 1,
  total_time_seconds integer not null default 0,
  last_read_at       timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  unique (user_id, book_id)
);

create index reading_progress_user_idx     on reading_progress (user_id);
create index reading_progress_last_read_idx on reading_progress (user_id, last_read_at);

create trigger reading_progress_updated_at
  before update on reading_progress
  for each row execute function set_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

-- profiles
alter table profiles enable row level security;

create policy "Users can view own profile"
  on profiles for select using (auth.uid() = id);

create policy "Users can update own profile"
  on profiles for update using (auth.uid() = id);

-- categories (system-defined, read-only for users)
alter table categories enable row level security;

create policy "Categories are readable by everyone"
  on categories for select using (true);

-- books
alter table books enable row level security;

create policy "Users can CRUD own books"
  on books for all using (auth.uid() = user_id);

create policy "Public books are readable by everyone"
  on books for select using (visibility = 'public');

-- book_files
alter table book_files enable row level security;

create policy "Users can manage files for own books"
  on book_files for all
  using (
    exists (
      select 1 from books where books.id = book_files.book_id and books.user_id = auth.uid()
    )
  );

-- folders
alter table folders enable row level security;

create policy "Users can CRUD own folders"
  on folders for all using (auth.uid() = user_id);

-- folder_items
alter table folder_items enable row level security;

create policy "Users can manage own folder items"
  on folder_items for all
  using (
    exists (
      select 1 from folders where folders.id = folder_items.folder_id and folders.user_id = auth.uid()
    )
  );

-- tags
alter table tags enable row level security;

create policy "Users can CRUD own tags"
  on tags for all using (auth.uid() = user_id);

-- book_tags
alter table book_tags enable row level security;

create policy "Users can manage tags on own books"
  on book_tags for all
  using (
    exists (
      select 1 from books where books.id = book_tags.book_id and books.user_id = auth.uid()
    )
  );

-- highlights
alter table highlights enable row level security;

create policy "Users can CRUD own highlights"
  on highlights for all using (auth.uid() = user_id);

-- comments
alter table comments enable row level security;

create policy "Users can CRUD own comments"
  on comments for all using (auth.uid() = user_id);

-- notes
alter table notes enable row level security;

create policy "Users can CRUD own notes"
  on notes for all using (auth.uid() = user_id);

-- whiteboards
alter table whiteboards enable row level security;

create policy "Users can CRUD own whiteboards"
  on whiteboards for all using (auth.uid() = user_id);

-- reading_progress
alter table reading_progress enable row level security;

create policy "Users can CRUD own reading progress"
  on reading_progress for all using (auth.uid() = user_id);

-- ============================================================
-- STORAGE BUCKETS
-- ============================================================

-- book-files: private bucket for PDF/EPUB uploads
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'book-files',
  'book-files',
  false,
  104857600, -- 100 MB
  array['application/pdf', 'application/epub+zip']
);

-- avatars: public bucket for profile pictures
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  5242880, -- 5 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
);

-- Storage RLS policies

-- book-files: users can manage their own files
create policy "Users can upload book files"
  on storage.objects for insert
  with check (bucket_id = 'book-files' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users can read own book files"
  on storage.objects for select
  using (bucket_id = 'book-files' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users can delete own book files"
  on storage.objects for delete
  using (bucket_id = 'book-files' and (storage.foldername(name))[1] = auth.uid()::text);

-- avatars: users can manage their own, anyone can read
create policy "Users can upload own avatar"
  on storage.objects for insert
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users can update own avatar"
  on storage.objects for update
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users can delete own avatar"
  on storage.objects for delete
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Avatars are publicly readable"
  on storage.objects for select
  using (bucket_id = 'avatars');
