-- ============================================================
-- 00021_book_ratings.sql
-- Star ratings on catalog books.
--
-- One row per (user, catalog_book) holds that user's 1-5 star rating.
-- Aggregated stats live on `catalog_books.rating_avg` and
-- `rating_count`, kept in sync by a trigger so browse queries don't
-- have to aggregate client-side (RLS would hide other users' rows
-- anyway, making client aggregation impossible).
-- ============================================================

create table public.book_ratings (
  user_id           uuid not null references public.profiles(id) on delete cascade,
  catalog_book_id   uuid not null references public.catalog_books(id) on delete cascade,
  stars             smallint not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  primary key (user_id, catalog_book_id),
  constraint book_ratings_stars_range check (stars between 1 and 5)
);

create index book_ratings_book_idx on public.book_ratings (catalog_book_id);

create trigger book_ratings_set_updated_at
  before update on public.book_ratings
  for each row execute function public.set_updated_at();

-- ── Aggregated columns on catalog_books ──────────────────────

alter table public.catalog_books
  add column rating_avg   real not null default 0,
  add column rating_count int  not null default 0;

-- ── Trigger: refresh aggregates on rating insert / update / delete ──
--
-- Runs AFTER on book_ratings. For INSERT and DELETE we recompute the
-- avg/count for the affected book; for UPDATE we do the same (stars
-- changed, avg may have moved even if the count didn't).
--
-- SECURITY DEFINER so the trigger can write to catalog_books even
-- though ordinary users cannot.

create or replace function public.recompute_catalog_book_rating(p_book_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.catalog_books cb
     set rating_avg = coalesce(agg.avg, 0),
         rating_count = coalesce(agg.cnt, 0)
    from (
      select avg(stars)::real as avg, count(*)::int as cnt
        from public.book_ratings
       where catalog_book_id = p_book_id
    ) agg
   where cb.id = p_book_id;
$$;

create or replace function public.book_ratings_sync_aggregate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.recompute_catalog_book_rating(old.catalog_book_id);
    return old;
  else
    perform public.recompute_catalog_book_rating(new.catalog_book_id);
    return new;
  end if;
end;
$$;

create trigger book_ratings_aggregate_trigger
  after insert or update or delete on public.book_ratings
  for each row execute function public.book_ratings_sync_aggregate();

-- ── RLS ───────────────────────────────────────────────────

alter table public.book_ratings enable row level security;

-- Anyone (including anon) can read ratings, aggregates are public.
create policy "Ratings are readable by anyone"
  on public.book_ratings for select
  using (true);

-- Only the rating's owner can write it. Insert must match their uid;
-- update / delete scoped to their own rows.
create policy "Users can insert their own rating"
  on public.book_ratings for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can update their own rating"
  on public.book_ratings for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete their own rating"
  on public.book_ratings for delete
  to authenticated
  using (auth.uid() = user_id);
