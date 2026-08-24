-- ============================================================
-- 00020_vocabulary.sql
-- Vocabulary builder, captured dictionary lookups + FSRS flashcards.
--
-- A `vocab_entry` is created every time a user defines a word in
-- the reader. Each entry carries the source sentence, the book it
-- came from (as plain text refs, no FK, because users may look
-- words up in documents that aren't formally in the library yet),
-- and an FSRS state blob used to schedule reviews.
--
-- The client is local-first (IndexedDB mirror) and syncs here for
-- cross-device continuity. No server-side scheduling: review
-- state is computed on the client and pushed up.
-- ============================================================

create table public.vocab_entries (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references public.profiles(id) on delete cascade,

  -- The looked-up word, normalized to lowercase for dedupe.
  word                 text not null,
  lang                 text not null default 'en',

  -- Short definition captured at lookup time (fallback for offline
  -- review). The full dictionary entry is refetched when available.
  definition           text not null,

  -- Sentence (or clause) surrounding the word in the source text.
  -- Blank when no surrounding text could be captured.
  context_sentence     text not null default '',

  -- Source book refs. All three are optional / best-effort; a
  -- random drag-dropped PDF has no DB id, only a local document id.
  source_document_id   text,
  source_title         text,
  source_page          int,

  -- FSRS state blob, { due, stability, difficulty, elapsed_days,
  -- scheduled_days, reps, lapses, state, last_review }.
  -- Opaque to the server; the client owns the schema.
  fsrs_state           jsonb not null,

  -- Denormalized from fsrs_state.due for cheap "due today" queries.
  due_at               timestamptz not null default now(),

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  -- Dedupe: one entry per (user, word, lang). Re-looking up the
  -- same word updates the existing row via ON CONFLICT rather than
  -- creating a duplicate.
  constraint vocab_entries_unique_word unique (user_id, word, lang)
);

create index vocab_entries_user_due_idx
  on public.vocab_entries (user_id, due_at);

create index vocab_entries_user_doc_idx
  on public.vocab_entries (user_id, source_document_id);

create trigger vocab_entries_set_updated_at
  before update on public.vocab_entries
  for each row execute function public.set_updated_at();

-- ── RLS ───────────────────────────────────────────────────

alter table public.vocab_entries enable row level security;

create policy "Users manage their own vocab entries"
  on public.vocab_entries for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
