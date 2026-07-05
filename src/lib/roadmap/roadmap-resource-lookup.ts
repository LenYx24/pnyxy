import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/logger";
import type { ResourceRef } from "@/types/roadmap";

/**
 * Match book references against the user's library (`books`) and the
 * public catalog (`catalog_books`). Library wins over catalog when both
 * match. Unmatched refs get `{ source: "none" }`.
 */

export interface LibraryRowForScoring {
  id: string;
  title: string | null;
  author: string | null;
  file_hash: string | null;
}

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

export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    // strip diacritics: "Bevezetés" -> "bevezetes"
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((tok) => tok.length >= 3 && !STOP_WORDS.has(tok));
}

/** Distinct tokens common to both strings. */
export function sharedTokens(a: string, b: string): Set<string> {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  const out = new Set<string>();
  for (const t of ta) if (tb.has(t)) out.add(t);
  return out;
}

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

const MIN_SCORE = 4; // two title-token matches, or one match + author bonus

/**
 * Resolve every reference's `match` field. Returns a new array; input
 * is not mutated. Non-book refs pass through as `{ source: "none" }`.
 */
export async function lookupResources(
  refs: ResourceRef[],
): Promise<ResourceRef[]> {
  if (refs.length === 0) return refs;

  const bookRefs = refs.filter((r) => r.kind === "book");
  if (bookRefs.length === 0) {
    return refs.map((r) => ({ ...r, match: { source: "none" as const } }));
  }

  // one coarse fetch per side, then score in memory
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
          // reader keys uploaded PDFs by file_hash; fall back to row id when missing
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
