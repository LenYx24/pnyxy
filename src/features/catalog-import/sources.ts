import type { CatalogBookInsert } from "@/types/catalog";

export type ImportSourceId =
  | "open_library"
  | "project_gutenberg"
  | "standard_ebooks"
  | "mek";

export interface ImportResult {
  /** Stable id per source, used for React keys + dedup. */
  sourceId: ImportSourceId;
  /** The canonical source_id that will be written to catalog_books. */
  canonicalSourceId: string;
  title: string;
  authors: string[];
  coverUrl: string | null;
  description: string | null;
  pageCount: number | null;
  language: string | null;
  subjects: string[];
  /** Download URL if the source provides one (Gutenberg yes, OL no). */
  downloadUrl: string | null;
  isbn10: string | null;
  isbn13: string | null;
}

/**
 * Map an ImportResult to a CatalogBookInsert ready for
 * browse-store.addBookToCatalog(). The catalog accepts a handful of
 * source enum values — we collapse PG / MEK into "user_submitted"
 * with a prefixed source_id since those aren't in the enum yet.
 */
export function resultToCatalogInsert(r: ImportResult): CatalogBookInsert {
  const source =
    r.sourceId === "open_library" ? "open_library" : "user_submitted";
  return {
    title: r.title,
    authors: r.authors,
    description: r.description,
    cover_url: r.coverUrl,
    isbn_10: r.isbn10,
    isbn_13: r.isbn13,
    page_count: r.pageCount,
    language: r.language,
    categories: r.subjects.slice(0, 10),
    source,
    source_id: r.canonicalSourceId,
    download_url: r.downloadUrl,
  };
}

// ── Open Library search ───────────────────────────────────

interface OLDoc {
  key: string;
  title: string;
  author_name?: string[];
  cover_i?: number;
  first_publish_year?: number;
  isbn?: string[];
  number_of_pages_median?: number | null;
  language?: string[];
  subject?: string[];
}

export async function searchOpenLibrary(
  query: string,
  limit: number,
): Promise<ImportResult[]> {
  const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`open_library_${res.status}`);
  const body = (await res.json()) as { docs?: OLDoc[] };
  const docs = body.docs ?? [];
  return docs
    .map((d): ImportResult | null => {
      const workId = String(d.key).replace(/^\/works\//, "");
      const authors = (d.author_name ?? []).filter(Boolean);
      if (!d.title || authors.length === 0) return null;
      const isbn13 =
        (d.isbn ?? []).find((i) => typeof i === "string" && i.length === 13) ??
        null;
      const isbn10 =
        (d.isbn ?? []).find((i) => typeof i === "string" && i.length === 10) ??
        null;
      return {
        sourceId: "open_library",
        canonicalSourceId: `ol:${workId}`,
        title: d.title.trim(),
        authors,
        coverUrl:
          d.cover_i != null
            ? `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg`
            : null,
        description: null,
        pageCount: d.number_of_pages_median ?? null,
        language: d.language?.[0] ?? null,
        subjects: (d.subject ?? []).slice(0, 10),
        downloadUrl: null, // OL is metadata-only
        isbn10,
        isbn13,
      };
    })
    .filter((r): r is ImportResult => r !== null);
}

// ── Project Gutenberg via Gutendex ────────────────────────

interface GDBook {
  id: number;
  title: string;
  authors?: { name: string }[];
  summaries?: string[];
  subjects?: string[];
  languages?: string[];
  formats?: Record<string, string>;
}

export async function searchGutenberg(
  query: string,
  limit: number,
): Promise<ImportResult[]> {
  const url = `https://gutendex.com/books?search=${encodeURIComponent(query)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`gutenberg_${res.status}`);
  const body = (await res.json()) as { results?: GDBook[] };
  const books = (body.results ?? []).slice(0, limit);
  return books
    .map((b): ImportResult | null => {
      if (!b.id) return null;
      const authors = (b.authors ?? []).map((a) => a.name).filter(Boolean);
      if (!b.title || authors.length === 0) return null;
      const formats = b.formats ?? {};
      const download =
        formats["application/epub+zip"] ||
        formats["application/pdf"] ||
        formats["text/plain; charset=utf-8"] ||
        formats["text/plain"] ||
        formats["text/html"] ||
        null;
      return {
        sourceId: "project_gutenberg",
        canonicalSourceId: `pg:${b.id}`,
        title: b.title.trim(),
        authors,
        coverUrl: formats["image/jpeg"] ?? null,
        description: b.summaries?.[0] ?? null,
        pageCount: null,
        language: b.languages?.[0] ?? null,
        subjects: (b.subjects ?? []).slice(0, 10),
        downloadUrl: download,
        isbn10: null,
        isbn13: null,
      };
    })
    .filter((r): r is ImportResult => r !== null);
}

// ── Source registry ──────────────────────────────────────

export interface SourceMeta {
  id: ImportSourceId;
  nameKey: string;
  hintKey: string;
  /** Disabled sources render with a reason instead of results. */
  disabled?: string;
  hasFile: boolean;
  search: (query: string, limit: number) => Promise<ImportResult[]>;
}

export const SOURCES: SourceMeta[] = [
  {
    id: "open_library",
    nameKey: "catalogImport.sources.openLibrary.name",
    hintKey: "catalogImport.sources.openLibrary.hint",
    hasFile: false,
    search: searchOpenLibrary,
  },
  {
    id: "project_gutenberg",
    nameKey: "catalogImport.sources.gutenberg.name",
    hintKey: "catalogImport.sources.gutenberg.hint",
    hasFile: true,
    search: searchGutenberg,
  },
  {
    id: "standard_ebooks",
    nameKey: "catalogImport.sources.standardEbooks.name",
    hintKey: "catalogImport.sources.standardEbooks.hint",
    hasFile: true,
    disabled: "patron_auth_required",
    search: async () => [],
  },
  {
    id: "mek",
    nameKey: "catalogImport.sources.mek.name",
    hintKey: "catalogImport.sources.mek.hint",
    hasFile: false,
    disabled: "endpoint_unknown",
    search: async () => [],
  },
];
