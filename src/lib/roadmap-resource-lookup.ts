import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/logger";
import type { ResourceRef } from "@/types/roadmap";

/**
 * Match AI-cited book references against the user's library
 * (uploaded PDFs in `books`) and the public catalog (`catalog_books`).
 *
 * Match heuristic (tier-ordered):
 *   1. Library wins over catalog when both match — the user already
 *      has the file, so the link drives them into a fully-featured
 *      reader instead of a "download from catalog" stub.
 *   2. Title + author both present → require both to share at least
 *      one normalised token. Title-only → require title to share two
 *      tokens (or one if it's distinctive — handled by minimum-length
 *      filter on the tokenizer).
 *   3. No match → `{ source: "none" }`. The UI shows the citation
 *      greyed out as info-only.
 *
 * Network: one ILIKE query per side, each running against a single
 * indexed column (`title`). All refs share the same two queries —
 * we then score each ref against the returned rows in memory.
 * Empty input → empty output.
 */

/** @internal — exported so the scoring helpers can take a typed
 *  argument the unit tests can construct without importing internal
 *  Supabase types. */
export interface LibraryRowForScoring {
  id: string;
  title: string | null;
  author: string | null;
  file_hash: string | null;
}

/** @internal — exported for unit tests. See `LibraryRowForScoring`. */
export interface CatalogRowForScoring {
  id: string;
  title: string | null;
  authors: string[] | null;
}

const STOP_WORDS = new Set([
  // English
  "the", "a", "an", "of", "to", "for", "and", "in", "on", "with",
  // Hungarian
  "a", "az", "és", "egy", "vagy", "hogy",
]);

/** @internal — exported only so the unit tests can pin the
 *  diacritic-stripping + stop-word + min-length semantics that the
 *  scoring functions depend on. Not part of the public surface. */
export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    // Strip diacritics so "Bevezetés" ≈ "bevezetes" — the Postgres
    // ILIKE side won't help with accents, so we equalise here.
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((tok) => tok.length >= 3 && !STOP_WORDS.has(tok));
}

/** Distinct, non-empty tokens common to both strings.
 *  @internal — exported for the unit tests; not part of the public
 *  module surface. */
export function sharedTokens(a: string, b: string): Set<string> {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  const out = new Set<string>();
  for (const t of ta) if (tb.has(t)) out.add(t);
  return out;
}

/** @internal — exported for unit tests. */
export function scoreLibrary(ref: ResourceRef, row: LibraryRowForScoring): number {
  if (!row.title) return 0;
  const titleHits = sharedTokens(ref.title, row.title).size;
  if (titleHits === 0) return 0;
  const refAuthor = (ref.author ?? "").trim();
  const rowAuthor = (row.author ?? "").trim();
  const authorBonus =
    refAuthor && rowAuthor && sharedTokens(refAuthor, rowAuthor).size > 0
      ? 2
      : 0;
  return titleHits * 2 + authorBonus;
}

/** @internal — exported for unit tests. */
export function scoreCatalog(ref: ResourceRef, row: CatalogRowForScoring): number {
  if (!row.title) return 0;
  const titleHits = sharedTokens(ref.title, row.title).size;
  if (titleHits === 0) return 0;
  const refAuthor = (ref.author ?? "").trim();
  if (!refAuthor || !row.authors || row.authors.length === 0) {
    return titleHits * 2;
  }
  const rowAuthorBlob = row.authors.join(" ");
  const authorBonus = sharedTokens(refAuthor, rowAuthorBlob).size > 0 ? 2 : 0;
  return titleHits * 2 + authorBonus;
}

const MIN_SCORE = 4; // ~ two title-token matches; one match + author bonus

/**
 * Resolve every reference's `match` field. Returns a new array — the
 * input is not mutated. Refs whose `kind` isn't "book" pass through
 * unchanged with `match: { source: "none" }` (we don't try to match
 * URL / YouTube refs against the library).
 */
export async function lookupResources(
  refs: ResourceRef[],
): Promise<ResourceRef[]> {
  if (refs.length === 0) return refs;

  const bookRefs = refs.filter((r) => r.kind === "book");
  if (bookRefs.length === 0) {
    return refs.map((r) => ({ ...r, match: { source: "none" as const } }));
  }

  // One coarse fetch each side — Postgres can hold the user's full
  // library and the catalog in memory easily for this scoring pass,
  // and N round-trips per reference would be far slower over a
  // typical residential network.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const libraryPromise = user
    ? supabase
        .from("books")
        .select("id, title, author, file_hash")
        .eq("user_id", user.id)
        .limit(500)
    : Promise.resolve({ data: [] as LibraryRowForScoring[], error: null });

  const catalogPromise = supabase
    .from("catalog_books")
    .select("id, title, authors")
    .limit(2000);

  const [libRes, catRes] = await Promise.all([libraryPromise, catalogPromise]);

  if (libRes.error) logError("roadmap-lookup:library", libRes.error);
  if (catRes.error) logError("roadmap-lookup:catalog", catRes.error);

  const libRows = (libRes.data as LibraryRowForScoring[] | null) ?? [];
  const catRows = (catRes.data as CatalogRowForScoring[] | null) ?? [];

  return refs.map((ref) => {
    if (ref.kind !== "book") {
      return { ...ref, match: { source: "none" as const } };
    }

    let bestLib: { row: LibraryRowForScoring; score: number } | null = null;
    for (const row of libRows) {
      const score = scoreLibrary(ref, row);
      if (score >= MIN_SCORE && (!bestLib || score > bestLib.score)) {
        bestLib = { row, score };
      }
    }
    if (bestLib) {
      return {
        ...ref,
        match: {
          source: "library" as const,
          bookId: bestLib.row.id,
          // The reader keys docs by file_hash for uploaded PDFs; fall
          // back to the row id when file_hash is missing (very old
          // rows or non-PDF formats). That match still drives the
          // book-page link; only auto-progress depends on docId
          // matching `book_resume_state.doc_id`.
          docId: bestLib.row.file_hash ?? bestLib.row.id,
        },
      };
    }

    let bestCat: { row: CatalogRowForScoring; score: number } | null = null;
    for (const row of catRows) {
      const score = scoreCatalog(ref, row);
      if (score >= MIN_SCORE && (!bestCat || score > bestCat.score)) {
        bestCat = { row, score };
      }
    }
    if (bestCat) {
      return {
        ...ref,
        match: {
          source: "catalog" as const,
          bookId: bestCat.row.id,
          docId: bestCat.row.id,
        },
      };
    }

    return { ...ref, match: { source: "none" as const } };
  });
}
