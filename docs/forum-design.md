# Forum + Debate + News — Design Doc

*Status:* Plan-only. No implementation yet.

*Audience:* Whoever picks up the "social layer" after the reader
features are in decent shape. Assumes familiarity with the existing
Supabase setup (see `src/lib/supabase.ts`, `src/stores/auth-store.ts`)
and with how `browse-store` / `catalog_books` already handle
user-contributed metadata behind an admin review gate.

---

## 1. Vision and scope

Pnyxy today is a reading app. This adds a **discussion layer** on top
of it:

- Reddit-style communities ("subs") about topics, about specific
  books, and about schools / universities.
- A **1v1 debate** mode whose explicit goal is *understanding the
  other side*, not winning.
- Later: a **news feed** integrated into the same community graph,
  with bias-aware multi-source aggregation and AI-assisted
  fact-checking, in the spirit of Ground News but aimed at higher
  quality.

The whole thing lives in one new top-level section (`/forum`) with its
own sidebar entry. It is not a prerequisite for anything in the reader
— the two surfaces link to each other (a book page can show its
community; a community post can cite a book page) but neither owns the
other's data.

### Goals (v1)

1. Users can create and join communities on three "axes":
   **topic** (e.g. `c/linear-algebra`), **book**
   (`c/book/{catalog_book_id}` — auto-created when a book lands in the
   catalog), and **school** (`c/school/harvard`).
2. Communities form a **directed graph** (not a strict tree): a child
   can have multiple parents. `c/matrix-multiplication` sits under
   `c/linear-algebra` *and* under `c/numerical-computing`. A "subtree"
   view from any node walks descendants in that graph.
3. Users can post text, links, and book references; comments are
   threaded; both posts and comments have a redesigned vote / reaction
   model.
4. A 1v1 debate module lives as a sibling surface (`/forum/debates`)
   where two users engage on a prompt, the thread is *structured*
   (opening statements → alternating rebuttals → synthesis), and
   reviews emphasize steelmanning, not scorekeeping.
5. Moderation: per-community moderators (with roles); site-wide
   admin; the same profanity filter already used for book sharing
   hits new content.

### Non-goals (v1)

- Real-time chat / DMs. Existing infra doesn't do this, and it's a
  different product.
- Full rich-text / image uploads. Markdown text + one link per post is
  the v1 ceiling.
- Search across all forum content. Browse/Sort-by-community is
  enough; full-text search is v2.
- Federation / ActivityPub. Interesting, but a giant distraction.
- The news feed. Design is sketched here (§ 7) but out of scope for
  the implementation this round.
- Cross-device notifications. An in-app inbox is enough for v1.

---

## 2. Entities and graph model

### 2.1 Communities

```
Community
  id              uuid
  slug            text unique        -- url segment: "linear-algebra"
  name            text               -- "Linear Algebra"
  kind            'topic' | 'book' | 'school'
  book_id         uuid? → catalog_books.id      -- only when kind='book'
  description     text
  created_by      uuid → profiles.id
  created_at      timestamptz
  member_count    int                -- maintained by trigger
  is_verified     bool               -- school communities auto-false,
                                     -- admins flip when they confirm
  avatar_url      text?
  banner_url      text?
```

**Book communities** are auto-created when a `catalog_book` lands
(trigger on insert). The slug is `book-{short hash}` so the user-
visible URL is `/forum/c/book-a1b2c3/...` and cross-linking from the
book page is deterministic.

**School communities** are user-created, similar in spirit to a
Discord server but with Moodle-adjacent expectations (syllabi,
course threads). They get the `is_verified` flag so schools can
"claim" their community later if an institution actually cares.
Verification is admin-only; no v1 mechanism for schools to self-claim.

### 2.2 Community graph (the tricky one)

The user explicitly called out that hierarchies aren't DAGs but *more
general directed graphs*.

**Reality check, written down so we don't regress later:**

- A *true* directed graph (cycles allowed) doesn't make semantic
  sense here: if `c/math ⊇ c/algebra` and `c/algebra ⊇ c/math`, what
  does "all posts in descendants of `math`" even mean?
- What the user almost certainly wants is a **DAG with multiple
  parents** — a node can belong to several ancestor lattices. That's
  what enables both `math → linear-algebra → matrix-multiplication`
  *and* `numerical-computing → matrix-multiplication` simultaneously.
- Edges are **typed**, and a node can have different parents for
  different reasons. `c/harvard` is a child of `c/universities` (kind
  `is-a`) and also of `c/boston` (kind `located-in`). We lean on this
  typing for the frontpage and breadcrumbs.

So the schema is a DAG:

```
community_edges
  parent_id       uuid → communities.id
  child_id        uuid → communities.id
  relation        'parent' | 'located-in' | 'related'   -- extensible
  created_by      uuid
  created_at      timestamptz
  PRIMARY KEY (parent_id, child_id, relation)
```

Enforcement:

- `CHECK parent_id <> child_id` — no self-loops.
- A SQL trigger on insert runs a CTE to detect cycles through the
  `'parent'` relation only (the other relations can contain cycles
  cheaply because we never traverse them for containment).
- `located-in` and `related` are advisory; the containment-view
  ("show me all posts in `c/math` and its descendants") walks only
  `'parent'`.

Edge authorship:

- Creating a `parent` edge where the child already has a parent
  requires one of: the child's mod, or an admin. This prevents
  random users from yoinking `c/linear-algebra` under `c/astrology`.
- `located-in` and `related` are low-friction; community mods on
  either side can create them.

Indexing:

- `community_edges (child_id, relation)` — used by breadcrumbs.
- `community_edges (parent_id, relation)` — used for descendant
  walks and frontpage.
- Descendants of a node are computed in a recursive CTE with a depth
  limit (say 8) and a deduplicating `visited` set. Cached in a
  materialized view `community_descendants_parent` refreshed on edge
  changes (the set is small and updates are rare).

### 2.3 Posts, comments, votes

```
post
  id              uuid
  community_id    uuid → communities.id
  author_id       uuid → profiles.id
  title           text
  kind            'text' | 'link' | 'book'
  body_md         text?               -- markdown, sanitized on render
  link_url        text?
  book_id         uuid?               -- when kind='book'
  created_at      timestamptz
  edited_at       timestamptz?
  is_removed      bool
  removed_reason  text?
  score_cached    int                 -- maintained by trigger for sort perf
  comment_count   int                 -- ditto
  last_activity   timestamptz         -- bumped by new comments

comment
  id              uuid
  post_id         uuid → post.id
  parent_id       uuid → comment.id?  -- nullable; NULL => top level
  author_id       uuid → profiles.id
  body_md         text
  created_at      timestamptz
  edited_at       timestamptz?
  is_removed      bool
  score_cached    int
```

### 2.4 Votes / reactions (see § 3 for design)

```
reaction
  user_id         uuid
  target_kind     'post' | 'comment'
  target_id       uuid
  kind            'boost' | 'damp' | 'insightful' | 'funny' |
                  'source-needed' | 'bad-faith'
  created_at      timestamptz
  PRIMARY KEY (user_id, target_kind, target_id, kind)
```

A user may leave **one** `boost`/`damp` **and** any number of the
other reactions. That's the only exclusivity constraint.

---

## 3. The "rethought upvote/downvote"

The user said: *"we might just rethink the idea of upvote and
downvote, but we might copy the system."* So: keep a single
primary-vote axis (for ranking), and add typed reactions that carry
social/moderation signal but don't move the frontpage.

### 3.1 Primary: Boost / Damp

- One per user per target.
- `boost = +1`, `damp = −1` for the ranking score.
- Damping requires a reason on second use on the same post within 10
  min (friction against reflex-downvoting). The reason is stored on
  the reaction row (`reason text?`) and is private to mods.
- **Dampshown only after you engage** — the UI reveals the damp
  count once the user scrolls past or opens the comments. Stops
  dogpiles on titles the user never actually read. (Inspiration:
  Slashdot + Hacker News's old "flag" muting.)

### 3.2 Typed reactions (no score impact)

| Reaction | Emoji | Meaning | Effect |
|---|---|---|---|
| `insightful` | 🧠 | changed my mind / made me think | surfaced on author's profile; no ranking |
| `funny`      | 😄 | joke well landed              | surfaced on post card; no ranking |
| `source-needed` | 🔎 | needs citation           | 5+ stacks a yellow "cite?" badge on the post; pings author |
| `bad-faith` | 🚩 | reporting-lite              | 3+ opens a mod queue item; doesn't remove content |

Rules:

- `bad-faith` is throttled (1/user/day/community) and costs karma if
  moderators dismiss it as abusive.
- `source-needed` can't stack from the same thread cluster (keeps a
  coordinated group from flooding it). Rate-limited per community
  per day.
- None of the typed reactions feeds into ranking — they're purely
  social and moderation signal.

### 3.3 Ranking

Frontpage sorts (user-selectable; remembered per-community):

| Sort | Formula sketch |
|---|---|
| **Hot** | `(boosts − damps) / (age_hours + 2)^1.5`, floored at 0 |
| **New** | `created_at DESC` |
| **Top** | `score = boosts − damps` within a timewindow selector |
| **Discuss** | `comment_count / (age_hours + 2)^1.2` — rewards threads that drew actual conversation, not just votes |
| **Fresh takes** | score over posts whose author's previous post < 30 days ago and < 5 total posts — a small "new voices" bucket mixed in at 10% |

"Hot" and "Discuss" are the defaults depending on community kind
(topic → Hot, book → Discuss).

### 3.4 Anti-dogpile knobs

- Damp is hidden until engagement (above).
- Vote totals are obscured for the first 30 min after post
  creation; a small "discussion started" indicator replaces the
  number. Prevents anchoring.
- On a community with < 50 members, raw score is never shown; we
  show only reactions, not counts.

---

## 4. Community-graph navigation

### 4.1 Routes

```
/forum                                  # personalized frontpage
/forum/c/:slug                          # community frontpage
/forum/c/:slug/tree                     # descendants view (DAG render)
/forum/c/:slug/p/:postId                # post + comment thread
/forum/c/:slug/new                      # new post composer
/forum/c/:slug/about                    # rules + mods + graph edges
/forum/u/:handle                        # user profile (posts, debates)
/forum/debates                          # debate lobby
/forum/debates/:debateId                # single debate
/forum/inbox                            # replies + mod mentions
```

### 4.2 Breadcrumbs in a DAG

A node has multiple paths to its roots. Breadcrumbs:

1. Pick the **primary path** — the path with the most descendants
   rooted at the top (captures "most-traveled" root). Cached on
   `community.primary_path_json`.
2. Show the primary path in the header; a dropdown chevron beside
   the slug opens the list of *all* ancestor paths, each clickable.

Example for `c/matrix-multiplication`:

```
Math  »  Linear Algebra  »  Matrix Multiplication   ⌄
                                                    ├─ Math » Linear Algebra » Matrix Multiplication
                                                    └─ Numerical Computing » Matrix Multiplication
```

### 4.3 Tree view

`/forum/c/:slug/tree` renders the DAG with reactflow (or a
lightweight custom SVG):

- Nodes sized by member count; edges colored by `relation`.
- Up to depth 3 by default; "expand" per node to reveal more.
- Click a node → open its community. Double-click → zoom to it as
  the new center.
- Warning banner on cycles in the `'related'` edge type (they're
  allowed but can make the render messy).

### 4.4 Feed aggregation

"All posts in `c/math` and descendants" walks the cached
`community_descendants_parent` set and `UNION ALL`s their posts. With
a depth cap, this is O(descendants × sort window), easily served by
an index on `post (community_id, score_cached DESC, created_at DESC)`.

For the personalized `/forum` root:

- User joins N communities. We read the *union of descendants* of
  the joined set, minus any muted subgraphs, and apply the Hot
  formula.
- Muting is stored in `user_community_mute (user_id, community_id,
  include_descendants bool)`.

---

## 5. Debate mode — `/forum/debates`

### 5.1 Design principles (from the user)

> "The whole point isn't about winning (that's why it's 1v1, so no
> social pressure) but understanding the other side no matter how
> much you'd disagree."

This steers every decision:

- **No public winner.** Reviews describe strengths, not scores. No
  leaderboard.
- **No spectator votes during the debate.** Spectators can react
  only to the *synthesis*, not the rebuttals.
- **Ideological Turing Test** (Caplan): each debater writes a short
  summary of their *opponent's* view at the end. AI + peer reviewers
  rate whether the opponent would endorse that summary.
- **Pause / cool-off turns** are first-class. Debaters can tap "I
  need to think" once per round; the clock pauses 24 h.

### 5.2 Debate lifecycle

```
proposed  ─accept→  scheduled  ─start→  live  ─final_turn_submitted→  synthesis  ─published→  closed
   │                                      │
   └── declined / expired ────────────────┘
```

1. **Proposed.** User A posts a debate prompt ("Resolved: Strong AI
   alignment is impossible without interpretability"), picks a
   position, a community, and either invites a specific user or
   leaves it open. Prompt is Markdown, 500 char cap. Goes into a
   debate lobby if open.
2. **Accepted.** User B accepts and picks the other side (the two
   sides are named in the prompt template — e.g., "For / Against",
   "Steelman A / Steelman B"). Debate becomes `scheduled`.
3. **Opening statements.** Each debater writes one opening
   statement (≤ 1500 words) within 48 h, without seeing the
   other's. Revealed simultaneously.
4. **Alternating rounds.** 3 rebuttal rounds (tunable). Each
   rebuttal ≤ 800 words, 72 h clock per turn. 1 pause available per
   debater per debate.
5. **Closing & Ideological Turing Test.** Each writes:
    - A closing statement (≤ 800 words).
    - A "steelmanned opponent" paragraph (≤ 300 words) presenting
      the opponent's view *as they would express it*.
6. **Synthesis.** Debate is locked. AI produces a synthesis report
   (see § 5.4). Peer reviewers (opt-in pool from the community) can
   add short reviews.
7. **Published.** Debate becomes readable by all; reactions are
   limited to the whole debate (`insightful`, `fair`, `changed-my-mind`)
   — no per-round scoring to preserve the "no winner" stance.

### 5.3 Review and reactions

Post-debate reactions (on the *debate*, not on individual rounds):

| Reaction | Meaning |
|---|---|
| `fair` | Both debated in good faith |
| `insightful` | I learned something |
| `changed-my-mind` | One side moved me |
| `steelman+A` | Debater A steelmanned B well |
| `steelman+B` | Debater B steelmanned A well |

The last two produce "Steelmanning score" on each debater's
profile — the *only* leaderboard we surface, because it rewards the
thing we care about.

### 5.4 AI synthesis (design, not a black box)

Inputs to the judge prompt:
- Full transcript of the debate, split by speaker and turn.
- Rubric (below).
- Instruction to produce a structured JSON report, not a winner.

Rubric items (each scored 0–3 per debater, with a one-sentence
justification):

1. **Steelmanning** — did they engage with the strongest version of
   their opponent's argument?
2. **Concessions** — did they concede valid points?
3. **Evidence** — specific, sourced claims vs hand-waving.
4. **Internal consistency** — contradictions within their own turns.
5. **Charitable interpretation** — misquotes/strawmen vs good
   paraphrase.
6. **Clarity** — could a generalist reader follow?

Output:

```ts
{
  summary: string;                 // 3–5 sentences, neutral
  by_debater: Record<userId, {
    scores: Record<RubricKey, { score: 0|1|2|3, note: string }>;
    strongest_argument: string;     // in their own words
    weakest_argument: string;
  }>;
  best_exchanges: { turnId: string; note: string; }[];
  open_questions: string[];         // things left unresolved
  disclaimer: string;               // "This is a reading, not a verdict."
}
```

We **never** render a total or a winner. We show per-rubric bars
side-by-side so the reader sees where each debater was strong, with
the explicit disclaimer.

Model choice:

- v1: Claude Sonnet (existing `anthropicApiKey` plumbing in
  `settings-store`). The synthesis is short enough that cost stays
  reasonable.
- Fallback if no key: skip AI synthesis; show peer reviews only.
- Admin can configure a pooled key for community use later.

### 5.5 Why 1v1

From the user: *"that's why it's 1v1, so no social pressure."*
Reinforcing:
- No spectator votes during live rounds.
- Author names hidden until synthesis (both debaters see a token
  like "Debater A / Debater B"; the platform reveals identities only
  on publish). Both agree to this trade-off at `accept`.
- Muting a user hides their debates from your feed.

### 5.6 Moderation

- A debate in a community follows that community's rules.
- Mods can mark a debate `quarantined` (hidden from the community
  feed) if it violates rules; both debaters get a reason.
- Users can report bad-faith behavior during a debate; the mod
  queue item carries the turn link so the mod reads it in context.

---

## 6. Data model summary (Postgres / Supabase)

Tables (new):

- `communities`
- `community_edges`
- `community_memberships (user_id, community_id, role ∈ 'member'|'mod'|'owner')`
- `post`, `comment`, `reaction`
- `user_community_mute`
- `debate`, `debate_turn`, `debate_review`, `debate_ai_synthesis`
- `report` (generic: `target_kind`, `target_id`, `reason`, `reporter_id`, `status`)

RLS overview:

- `post` / `comment` insert: requires `auth.uid()` and that the
  target community is joinable (not private) or user is a member.
- `post` / `comment` update: author only, within 15 min of creation
  (hard-wired, not a community setting for v1).
- `post` / `comment` delete: soft-delete via `is_removed`; only
  author, community mod, or admin.
- `community_edges` insert with `relation = 'parent'`: requires
  mod on child or admin.
- `debate_turn` insert: must be the active debater and within the
  open turn window.
- `reaction` insert: rate-limited per-kind (see § 3.2) via
  existing Supabase rate-limit patterns (Postgres function +
  `pgcrypto` check).

Triggers:

- Book insert on `catalog_books` (after admin approval) →
  auto-create `communities` row with `kind='book'`, `book_id=NEW.id`.
- Reaction insert/delete → bump `post.score_cached`/`comment.score_cached`.
- Comment insert → bump `post.comment_count`, `post.last_activity`.
- `community_edges` parent insert → cycle check; invalidate
  descendants cache for the affected subgraph.

Realtime:

- Subscribe to `post` (new posts in followed communities) → infinite
  scroll gets updates. Reuse the `postgres_changes` infra already
  used by the book pages.
- Debate live view subscribes to `debate_turn` on the current
  debate ID.

---

## 7. News feed (v2+ sketch — not implementation-ready)

User: *"Later I'd like to implement news into this too … something
like ground news combined with AI, and trying to be really better."*

### 7.1 What "really better" means here

Ground News's differentiator is side-by-side coverage from
left / center / right outlets. We add:

1. **Fact triangulation over stance coverage.** The axis isn't
   left/right alone; it's "what do sources agree on vs disagree on",
   grouped into:
    - Shared claims (repeated across N outlets, cited to primary
      sources where possible).
    - Contested claims (outlets disagree on a fact — who said what,
      when).
    - Omissions (claim present in one camp, absent in the other).
2. **Every claim gets a source chip** down to the sentence level.
   Readers hover to see the extract. No claim hangs in the air.
3. **AI fact-check is an augmentation, not the verdict.** The AI
   runs a *pipeline*, not a black box:
    - Claim extraction: list atomic claims from each article.
    - Claim clustering: group paraphrases.
    - Retrieval: for each cluster, pull primary sources (press
      releases, papers, official filings) via a curated registry.
    - Agreement analysis: report where outlets agree / diverge
      from primary sources.
    - Uncertainty: explicit "this claim could not be verified"
      bucket. No hallucinated citations.
4. **No "truth score" number.** Users see the map of agreements,
   sources, and uncertainties, and draw their own conclusion.
   (Matches the debate judge's no-winner philosophy.)

### 7.2 Surfaces

- News communities (`c/news/{topic}`) look like any other
  community. They accept user posts *and* aggregated news items.
- News items render as a special post kind (`kind='news-cluster'`)
  with multi-source cards.
- On the personalized `/forum` feed, the user picks the news
  density slider: 0% (no news), 20% (default), 100% (news-only).

### 7.3 Data model additions (sketch only)

```
news_source          # outlet registry (curated initially)
  id, name, url, bias_tag (manual), funding_disclosure_url, trust_tier

news_article          # raw ingested articles
  id, source_id, url, title, published_at, body, hash

news_cluster          # grouped articles about the same event
  id, primary_claim, first_seen_at, confidence_tier

news_article_cluster  # M2M

news_claim            # atomic claim extracted from an article
  id, article_id, text, span_start, span_end

news_claim_match      # same claim across articles
  claim_a, claim_b, relation ∈ 'agrees'|'contradicts'|'partial'

news_primary_source   # a filing / paper / press release
  id, url, title, kind, content_hash
```

### 7.4 Build-order suggestion (v2+)

1. Ingest (RSS + sitemap crawlers) into `news_article`. No
   clustering yet.
2. Manual source registry + bias/trust tags.
3. Claim extraction pipeline (embedding + LLM).
4. Cluster UI on the forum.
5. Primary-source retrieval + claim matching (hardest piece).
6. Personalized density slider.

Ship items 1–3 first as a read-only "Ground News-like" view, then
layer the fact-check depth on top. Do not promise the whole thing
before item 2 exists.

### 7.5 Explicit out-of-scope for v2

- Paid feed partnerships. We read public web only.
- Political-claim scoring. The whole design avoids this.
- Cross-language (English-only v2; i18n later).

---

## 8. UI / UX notes

### 8.1 Sidebar

Add a new sidebar section after "Library / Browse":

```
▸ Forum
   ┆ ▸ Joined communities (list with unread count)
   ┆ ▸ Discover
   ┆ ▸ Debates
   ┆ ▸ Inbox
```

Unread counts are per-community `last_read_at` vs `post.last_activity`;
cheap to compute, reuse `reading-stats` event plumbing.

### 8.2 Post composer

- Three tabs: Text / Link / Book.
- Book tab opens a picker from `catalog_books` — selecting
  auto-mentions the book and pulls the cover into the post card.
- Markdown preview pane (reuse the TextViewer's marked + DOMPurify
  pipeline from the reader — same sanitize rules, no script /
  iframe).

### 8.3 Debate UI

- Transcript reads top-down with labeled turns
  ("Opening · Debater A", "Rebuttal 1 · Debater B", etc.).
- Active debate shows a turn clock (counting down) and a
  "pause" button for the active debater.
- Synthesis sits below the transcript in a collapsed panel the
  reader opens intentionally. Keeps the raw turns first.

### 8.4 Accessibility

- Every reaction button is a real `<button>` with `aria-pressed`
  when toggled and a visible count.
- Debate turns are `<article>`s with `aria-labelledby` on the
  turn header so screen readers can jump between them.
- Reduced motion: the tree-view doesn't animate layout when set.

---

## 9. Moderation, abuse, safety

- Reuse `containsProfanity` (already used in `ShareBookModal`) for
  titles and bodies. Fire a pre-submit warning; allow override once
  per day with an explicit "I still want to post" (logged).
- Rate limits per user:
    - 5 posts / 10 min
    - 20 comments / 10 min
    - 30 reactions / min
    - 1 debate proposal / day (until finished)
- Mod tools per community: remove, lock thread, ban user from
  community, pin, flair. Admin tools add sitewide ban (existing
  `auth-store` ban flow is reused).
- Audit log for every mod action (`community_mod_action`) — visible
  to community members on an opt-in basis (default on; community
  can hide it).
- Brigading guard: reactions from accounts younger than 24 h count
  at 0.25× for the first 24 h on a post.

---

## 10. Phased rollout

| Phase | Ships | Gate |
|---|---|---|
| 1 | Communities + memberships + topic kind. Post / comment without reactions. | Can create `c/test`, post, comment. RLS tests green. |
| 2 | Boost / damp, Hot/New/Top sorts, frontpage. | Hot sort unit tests; brigading guard unit test. |
| 3 | Book communities (auto-create on catalog approval) + book kind posts. | Adding a book to catalog yields a `c/book/...` community. |
| 4 | Typed reactions, `source-needed` / `bad-faith` queues. | Mod queue renders; rate-limit enforcement unit test. |
| 5 | School communities + DAG edges + tree view. | Cycle check trigger unit test; breadcrumbs on a 3-parent node. |
| 6 | Debate lobby + open/accept + turn clock. | Turn RLS prevents wrong speaker; pause/resume e2e. |
| 7 | AI synthesis + peer review reactions. | Synthesis report is JSON-schema-valid; no winner rendered anywhere. |
| 8 | News feed — phases 1–3 of § 7.4 as a separate follow-up doc. | Out of scope; do not schedule with the above. |

Each phase is independently shippable.

---

## 11. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Community-graph complexity confuses users | Default UI shows single primary path; multi-parent is a chevron dropdown, not prominent. |
| DAG cycles sneak in | Cycle-check trigger on `'parent'` edges; periodic full validation job. |
| Debate AI synthesis reads as a verdict despite disclaimer | No winner field; per-rubric bars only; disclaimer in bold at top and bottom. |
| News pipeline becomes a misinformation firehose if shipped shallow | § 7 is explicitly v2+; ship ingestion + source registry *before* any auto-claim scoring. |
| Moderation load on admin | Per-community mods with role escalation; sitewide admin is a last resort. |
| School communities get squatted | `is_verified` flag + admin claim flow; URL slugs for schools follow `school-{hash}` until verified, then can migrate to `school-harvard`. |
| Vote manipulation / brigading | Brigading guard (§ 9), engagement-gated damp reveal (§ 3.1), obscured early totals (§ 3.4). |
| Real-time load on `post`/`reaction` tables | `score_cached`/`comment_count`/`last_activity` triggers avoid `COUNT(*)` on hot paths; realtime subscribes to rows, not aggregates. |

---

## 12. Open questions

1. **Private communities.** Invite-only schools? Keep public-only for
   v1, revisit with schools' verification flow.
2. **Karma / reputation.** We have steelmanning scores from debates;
   do we ever surface a general "forum karma"? Default: no — it
   invites gaming. Revisit after 6 months.
3. **Book-community auto-creation.** Only for admin-approved
   catalog entries, or for user-submitted entries pending review?
   Recommend: admin-approved only, to avoid ghost communities.
4. **Debate prompt discovery.** Do we need a "debate marketplace"
   where users browse open proposals? Or is per-community a
   thread-with-accept-button enough? v1: per-community list, with a
   global `/forum/debates` aggregator.
5. **Per-community theming.** Banner / color customization? Yes,
   cheap; copy the existing theme-apply logic.
6. **Integration with reading stats.** Does a forum comment count
   toward daily activity? Recommend: no for the streak, yes for a
   separate "social" stat, to avoid incentivizing shallow comments
   to keep a streak alive.
7. **Notifications for replies.** In-app inbox is enough for v1;
   email/push is deferred.
8. **DAG editing UX.** When a mod reparents a community, do posts
   appear retroactively in the new parent's feed? Yes — containment
   is by live graph walk, not by post snapshot. Document this so
   surprise reparentings are noticed.

---

## 13. Critical files (if / when this is implemented)

- `src/types/forum.ts` — entities above.
- `src/stores/community-store.ts` — list, join, mod actions.
- `src/stores/post-store.ts` — CRUD, reactions, hot/new/top sorts.
- `src/stores/debate-store.ts` — lifecycle, turn clock, synthesis.
- `src/features/forum/` — page components:
    - `ForumHome.tsx`, `CommunityPage.tsx`, `CommunityTreeView.tsx`,
      `PostPage.tsx`, `PostComposer.tsx`, `DebateLobby.tsx`,
      `DebatePage.tsx`, `DebateSynthesisPanel.tsx`.
- `src/components/layout/Sidebar.tsx` — Forum section.
- `src/app/router.tsx` — routes listed in § 4.1.
- `supabase/migrations/*` — schema + triggers + RLS.
- `src/lib/forum-ai.ts` — debate synthesis prompt + JSON schema
  validator; no winner fields emitted.
- `src/lib/forum-rank.ts` — Hot / Discuss / Fresh-takes formulas
  with unit tests.

---

## 14. References for future reading

- Slashdot meta-moderation (typed reactions precedent).
- Hacker News ranking (decay formula).
- Caplan's Ideological Turing Test (steelmanning reaction source).
- Ground News (multi-source grouping).
- Kialo (structured debate trees — we intentionally *don't* copy
  the tree; we keep turns linear because branching debates don't
  force either side to engage with the strongest counter).
