# Learn page: design plan, Flashcards + FAQ + shared AI definitions

This is a **design plan only**. Nothing here is built; the goal is to
have a clear shape we can implement (or push back on) when feature
freeze lifts after 2026-07-04.

Status legend: ✅ shipped, 🟡 in-flight, ⬜ open question.

## 1. Flashcards

### Goal

Spaced-repetition deck per book. Cards review a concept, definition,
or chunk the user wants to overlearn. Distinct from Quizzes, quizzes
are graded one-shot tests; flashcards are an ongoing review habit.

### Quizlet / Anki / Brainscape, features worth copying

| Feature | Source | Worth copying? | Why |
|---|---|---|---|
| Front/back cards | All | ✅ Yes | The base unit. |
| Cloze (fill-the-blank) | Anki | ✅ Yes | Strong for definitions in the book, `The {{c1::heap}} is invariant under {{c2::insertion}}`. |
| Image occlusion | Anki addons | 🟡 Maybe later | High-effort UI (canvas masks). Skip v1, revisit if students ask. |
| Pre-made decks (community) | Quizlet | ✅ Yes (v2) | Great fit for our shared-context philosophy. Per-book public deck = "the deck for chapter 3 of Cormen". |
| Multiple-choice / write / match modes | Quizlet | ⬜ Probably not v1 | Quizlet uses these as gamification; we already have Quizzes for that. Keep flashcards focused on review. |
| FSRS scheduling | Anki / RemNote | ✅ Yes | We already use FSRS for Vocabulary, reuse. |
| Heatmap of review streak | Anki | ✅ Yes | The streak heatmap on `/streaks` already does this; flashcard reviews should *count* toward it. |
| Audio for pronunciation | Quizlet | ❌ No | Off-mission for textbook study. |
| AI auto-generation from a chapter | None directly | ✅ Yes | Differentiator, "give me 20 cards on chapter 4". Aligns with Pnyxy's AI-first identity. |

### Data model (proposed)

Two new tables, both org-scoped via the existing org pattern (see
`00027_org_scope_library.sql`):

```sql
create table flashcard_decks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  org_id uuid references organizations on delete cascade,
  -- Tied to either a catalog book or an uploaded book; mirrors
  -- the dual-book pattern from `quizzes`.
  catalog_book_id uuid references catalog_books on delete set null,
  uploaded_book_id uuid references books on delete set null,
  title text not null,
  description text,
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table flashcards (
  id uuid primary key default gen_random_uuid(),
  deck_id uuid not null references flashcard_decks on delete cascade,
  -- Card kinds: "basic" (front+back), "cloze" (one text with {{c1::}})
  kind text not null check (kind in ('basic', 'cloze')),
  front text not null,    -- basic: question, cloze: full text with markup
  back text,              -- basic: answer, cloze: null
  source_page integer,    -- where in the book it came from, optional
  created_at timestamptz not null default now()
);

create table flashcard_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  card_id uuid not null references flashcards on delete cascade,
  -- FSRS-managed fields
  due_at timestamptz not null,
  stability real not null default 0,
  difficulty real not null default 0,
  reps integer not null default 0,
  lapses integer not null default 0,
  last_reviewed_at timestamptz,
  -- One review row per (user, card). Each user has their own
  -- schedule even on a public deck.
  unique (user_id, card_id)
);
```

### v0 scope (smallest useful build)

1. List + create decks per book (`/books/<id>/learn/flashcards`).
2. Manual card add (front/back only, cloze in v1).
3. Review surface: one card at a time, "again / good / easy" buttons,
   FSRS update via the existing `lib/fsrs.ts`.
4. Daily review reminder badge on the Home page.
5. Reviews count toward the streak.

### v1 nice-to-haves

- Cloze cards (`{{c1::}}` syntax with reveal-one-cluster-at-a-time UI).
- AI auto-generation: "Generate 10 cards on chapter 3", uses the
  existing AI-context plumbing (TOC + selected pages) plus a system
  prompt that forces JSON output (cf. quiz generation in
  `lib/quiz-tools.ts`).
- Public decks + clone-to-my-decks (Quizlet-style).
- Per-deck stats (avg accuracy, hardest card, fastest learner).

### Decisions

- ✅ **Cloned public deck = fresh reviews per user.** Each user gets
  their own FSRS schedule on a cloned deck, no shared review state.
  Decided 2026-05-07. Easy to revisit later: it's a one-off behavior
  in the clone code path, not a schema constraint.
- ⬜ Should we let users *export* a deck to Anki `.apkg`? Probably
  yes, low cost, big trust signal for power users.

---

## 2. FAQ + shared AI definitions

### The user's pitch

> When a user prompts the AI for a definition of a word, or some
> clarification, then that gets shown in the pdf. […] users don't
> have to waste tokens on words that were already prompted by the AI.

This is the core idea: **AI clarifications become a community
resource attached to the page they refer to.** A second user reading
the same book sees the previous AI answer inline instead of paying
to ask again.

### Where this collides with reality

If we naively save *every* AI prompt as a public annotation, we get:
- prompt logs full of personal stuff ("can you summarize this for
  my Tuesday seminar")
- dozens of competing definitions for the same term
- reading view drowning in AI annotations
- privacy / GDPR concerns (a chat is conversational; it can leak)
- abuse vector (someone seeds a book with a misleading "definition")

So the v1 has to be **narrow** and **opt-in**.

### Proposed v1 scope

A new annotation kind: `ai_definition`. Only this kind gets the
shared / community treatment. Plain chat conversations stay private.

**What qualifies as an `ai_definition`:**
1. The user selected a short span of text (≤200 chars, single page).
2. The user invoked an explicit "Explain this term" action from the
   selection menu (separate from "Send to AI chat").
3. The AI's response was a definition / clarification (we'll know
   because of how the system prompt is structured).
4. After the AI answers, the user is asked: **share this with other
   readers?** (default: no, explicit opt-in).

If shared:
- Stored as `ai_annotations` row (new table) keyed by
  `(catalog_book_id, page, normalized_selection)`.
- Visible on the page as an inline pill with an AI icon.
- Click to expand → shows the question, the answer, the model used,
  who shared it (or "anonymous"), how many readers found it useful.
- Reprompt button → user can ask again with their own model /
  context. New answer can replace the user's own copy of the
  annotation, but not the public one (which only the original
  poster can edit).

### Data model (proposed)

```sql
create table ai_annotations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete set null,
  -- Always tied to a *catalog* book (uploaded books are private to
  -- a user, so sharing doesn't apply). Uploaded-book AI definitions
  -- can still exist as private annotations on the user's own copy.
  catalog_book_id uuid not null references catalog_books on delete cascade,
  -- Page range the selection spans. start_page = end_page for the
  -- common single-page case; multi-page covers a quote that crosses
  -- a page break. Lookup on page N becomes:
  --   where start_page <= N and end_page >= N
  -- Both are integer indexes; no per-page rows, no parent/child
  -- table, the range fits on one row and matches how PDF text
  -- selection actually behaves.
  start_page integer not null,
  end_page integer not null check (end_page >= start_page),
  -- Normalized form of the selected text used for dedup. Same trick
  -- as search-store's normalize: lowercase, strip whitespace runs,
  -- strip punctuation. We render the *original* text on the pin.
  selection_text_normalized text not null,
  selection_text text not null,
  -- The user's question + the AI's answer, both raw.
  prompt text not null,
  answer text not null,
  model text not null,           -- e.g. "claude-sonnet-4-5"
  is_public boolean not null default false,
  -- Anonymous by default; flipped to true only when the user
  -- explicitly opts in on the per-share dialog. UI joins to
  -- profiles for display only when this is true.
  attribution_visible boolean not null default false,
  -- Soft "this was helpful" votes from other readers; cheap moderation.
  helpful_count integer not null default 0,
  reported_count integer not null default 0,
  created_at timestamptz not null default now()
);

-- Range query: "find public annotations whose span covers page N"
-- For a few-thousand-row table this btree index plus the small
-- number of overlapping rows is plenty; no need for a GiST range
-- type unless the table grows by orders of magnitude.
create index ai_annotations_lookup
  on ai_annotations (catalog_book_id, start_page, end_page)
  where is_public;
-- Dedup index for "has someone already shared this exact span?"
create unique index ai_annotations_dedup
  on ai_annotations
    (catalog_book_id, start_page, end_page, selection_text_normalized)
  where is_public;
```

### Reader-side UX

1. User selects a word/phrase → annotation menu shows **Explain this**
   alongside the existing Highlight / Comment / Send to AI chat
   options. Selection can span pages, when it does, the existing
   PDF.js range selection already gives us start/end page; we just
   record both on the row.
2. Clicking opens an inline popover: AI answer streams in.
3. After the stream completes, a footer: `Share with other readers?`
   [Yes, public] / [Keep private] / [Discard].
4. If shared: a small AI-marked pin appears in the margin at that
   selection. Other users see it pre-filled.
5. Pin colour distinct from regular comments (pale violet with a
   tiny robot icon) so it's clearly machine-generated.
6. Multi-page pins render on the **start page** with a "spans
   p.X–Y" badge under the icon, so a reader on page X sees a
   single anchor rather than a duplicate pin per spanned page.
   Page Y also gets a thin "↑ continued from p.X" inline label so
   readers who land mid-quote can find the anchor.
7. Hover (or tap on mobile) shows the answer; the popover header
   shows the full quoted span (with a `⏎` glyph at the page break)
   so multi-page context is preserved when the AI's reply
   references "the second paragraph".
8. "Reprompt" is in the pin's overflow menu.

### What we explicitly do NOT save

- Open-ended chat conversations (those stay in `/chat`).
- Prompts that aren't selection-anchored ("summarize chapter 4",
  too broad to share usefully).
- Anything from uploaded (non-catalog) books, sharing is
  catalog-only because the catalog is the shared corpus.

### Cost / abuse / quality

- **Abuse:** rate-limit `ai_annotations.is_public = true` inserts
  per-user per-day (e.g. 30/day). Reported items hidden when
  `reported_count >= 3` pending review.
- **Quality:** bias toward *short* selections (≤200 chars, ideally
  ≤50). Definitions of single terms / short phrases. The system
  prompt nudges the model to produce one-paragraph answers; longer
  ones get truncated in the pin and need a click to expand.
- **Cost:** the whole point is *reducing* token spend by reusing
  community answers. The first user pays; everyone after them sees
  it free. Worth tracking the `helpful_count / paid_calls` ratio
  per book to see if the cache is paying off.

### v1 minimum

- Annotation menu's **Explain this** button (selection-anchored,
  single- and multi-page selections both work; cap at 5 pages).
- Streaming popover.
- Share / private toggle (default: private).
- Public lookup in the reader (range-overlap query).
- Reprompt for the asker only.
- **"Save this answer as a shared definition" button on `/chat`
  replies.** Available on any assistant message in a conversation
  whose `source_doc_id` is a *catalog* book and whose immediately
  preceding user message has a quoted selection (the existing
  `> ...` block from "Send to AI chat"). Reuses the same
  `ai_annotations` row shape, the chat path just supplies the
  same fields the reader's "Explain this" path does. Decided
  2026-05-07: this widens the entry point so users who reflexively
  open the full chat surface (vs. a popover) still contribute to
  the shared corpus.

### Defer to v2

- "Found this helpful" voting.
- Per-book FAQ tab on the book page that lists all public AI
  definitions sorted by `helpful_count`.
- Search across AI definitions ("definitions for: monad").

### Decisions

- ✅ **Asker identity: anonymous default, opt-in attribution.** A
  shared definition's `user_id` is stored on the row but only
  surfaced in the UI when the user explicitly opted to attach
  their name (a per-share checkbox). Hungarian-audience priority on
  privacy. Decided 2026-05-07. Implication: schema needs an
  `attribution_visible boolean not null default false` column on
  `ai_annotations`; lookups still join `user_id` → profile *only
  when* `attribution_visible = true`.
- ✅ **`/chat` gets the "save as shared definition" button in v1**
  (see above), not v2.

### Decisions (continued)

- ✅ **Multi-page selections are in-scope for v1.** Schema uses a
  `(start_page, end_page)` pair instead of a single `page`; lookup is
  a range overlap. Pin renders on `start_page` with a "spans p.X–Y"
  badge plus a "continued from" label on the end page. Decided
  2026-05-07 (the user explicitly flagged this as important).
  Practical cap: refuse selections that span more than 5 pages,
  beyond that the prompt blows up the context window for a
  "definition" use case, and the user is really doing chapter Q&A
  (regular AI chat).

---

## What this plan deliberately does NOT decide

- The exact spaced-repetition cadence visualization on the Home page.
- Whether flashcard decks should sit inside the `quizzes` table
  schema (probably not: quizzes are graded one-shots, decks are
  ongoing schedules; the existing `vocabulary_entries` table is a
  closer analog).
- The model-routing rules for "Explain this", should the cheapest
  model always run, or pick by user-tier? Decide when implementing.
