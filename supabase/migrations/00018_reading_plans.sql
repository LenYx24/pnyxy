-- ============================================================
-- 00018_reading_plans.sql
-- Reading phases / semesters.
--
-- A `reading_plan` is a time-boxed goal with one or more
-- `reading_plan_items` — a plan can target a single book, a page
-- range, multiple books, or mixed ranges across books.
--
-- Progress is computed on the fly from `reading_progress`; this
-- table only stores the goal + target dates.
-- ============================================================

create type public.reading_plan_status as enum ('active', 'completed', 'abandoned');

create table public.reading_plans (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles(id) on delete cascade,
  title            text not null,
  start_date       date not null,
  end_date         date not null,
  ignore_weekends  bool not null default false,
  status           public.reading_plan_status not null default 'active',
  created_at       timestamptz not null default now(),
  completed_at     timestamptz,

  constraint reading_plans_date_order check (end_date >= start_date)
);

create index reading_plans_user_status_idx
  on public.reading_plans (user_id, status, end_date);

create table public.reading_plan_items (
  id               uuid primary key default gen_random_uuid(),
  plan_id          uuid not null references public.reading_plans(id) on delete cascade,
  -- Exactly one of book_id / catalog_book_id is set.
  book_id          uuid references public.books(id) on delete cascade,
  catalog_book_id  uuid references public.catalog_books(id) on delete cascade,
  -- Optional page range; null means "the whole book".
  start_page       int,
  end_page         int,
  ordering         int not null default 0,

  constraint reading_plan_items_one_book check (
    (book_id is null) <> (catalog_book_id is null)
  ),
  constraint reading_plan_items_page_order check (
    start_page is null or end_page is null or end_page >= start_page
  )
);

create index reading_plan_items_plan_idx
  on public.reading_plan_items (plan_id, ordering);

-- ── RLS ───────────────────────────────────────────────────

alter table public.reading_plans enable row level security;
alter table public.reading_plan_items enable row level security;

create policy "Users manage their own plans"
  on public.reading_plans for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Items inherit ownership from the parent plan.
create policy "Users read their own plan items"
  on public.reading_plan_items for select
  to authenticated
  using (
    exists (
      select 1 from public.reading_plans p
      where p.id = plan_id and p.user_id = auth.uid()
    )
  );

create policy "Users insert their own plan items"
  on public.reading_plan_items for insert
  to authenticated
  with check (
    exists (
      select 1 from public.reading_plans p
      where p.id = plan_id and p.user_id = auth.uid()
    )
  );

create policy "Users update their own plan items"
  on public.reading_plan_items for update
  to authenticated
  using (
    exists (
      select 1 from public.reading_plans p
      where p.id = plan_id and p.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.reading_plans p
      where p.id = plan_id and p.user_id = auth.uid()
    )
  );

create policy "Users delete their own plan items"
  on public.reading_plan_items for delete
  to authenticated
  using (
    exists (
      select 1 from public.reading_plans p
      where p.id = plan_id and p.user_id = auth.uid()
    )
  );
