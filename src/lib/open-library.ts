import type {
  CatalogBookInsert,
  DownloadOption,
  OpenLibrarySearchResult,
  OpenLibrarySearchDoc,
  OpenLibraryWork,
} from "@/types/catalog";

const BASE = "https://openlibrary.org";
const COVERS = "https://covers.openlibrary.org";
const IA_DOWNLOAD = "https://archive.org/download";

// ── Cover URL builder ───────────────────────────────────────

export function getCoverUrl(
  isbn: string,
  size: "S" | "M" | "L" = "M",
): string {
  return `${COVERS}/b/isbn/${isbn}-${size}.jpg`;
}

export function getCoverUrlById(
  coverId: number,
  size: "S" | "M" | "L" = "M",
): string {
  return `${COVERS}/b/id/${coverId}-${size}.jpg`;
}

// ── Internet Archive download URLs ──────────────────────────

export function getIADownloadUrl(
  iaId: string,
  format: "pdf" | "epub" | "txt",
): string {
  const suffix = format === "txt" ? "_djvu.txt" : `.${format}`;
  return `${IA_DOWNLOAD}/${iaId}/${iaId}${suffix}`;
}

export function getDownloadOptions(iaId: string): DownloadOption[] {
  return [
    { format: "pdf", url: getIADownloadUrl(iaId, "pdf"), label: "PDF" },
    { format: "epub", url: getIADownloadUrl(iaId, "epub"), label: "EPUB" },
    { format: "txt", url: getIADownloadUrl(iaId, "txt"), label: "Plain Text" },
  ];
}

// ── Search ──────────────────────────────────────────────────

export async function searchBooks(
  query: string,
  page = 1,
  limit = 20,
): Promise<OpenLibrarySearchResult> {
  const params = new URLSearchParams({
    q: query,
    page: String(page),
    limit: String(limit),
    fields:
      "key,title,author_name,first_publish_year,isbn,publisher,number_of_pages_median,subject,cover_i,language,ebook_access,public_scan_b,ia",
  });

  const res = await fetch(`${BASE}/search.json?${params}`);
  if (!res.ok) throw new Error(`Open Library search failed: ${res.status}`);
  return res.json();
}

// ── ISBN lookup ─────────────────────────────────────────────

export async function getBookByIsbn(
  isbn: string,
): Promise<OpenLibrarySearchDoc | null> {
  const result = await searchBooks(`isbn:${isbn}`, 1, 1);
  return result.docs[0] ?? null;
}

// ── Work details (for descriptions) ─────────────────────────

export async function getWorkDetails(
  workId: string,
): Promise<OpenLibraryWork> {
  // workId can be "/works/OL123W" or just "OL123W"
  const id = workId.startsWith("/works/") ? workId : `/works/${workId}`;
  const res = await fetch(`${BASE}${id}.json`);
  if (!res.ok)
    throw new Error(`Open Library work fetch failed: ${res.status}`);
  return res.json();
}

// ── Map Open Library doc → CatalogBookInsert ────────────────

function extractDescription(
  desc: string | { value: string } | undefined,
): string | null {
  if (!desc) return null;
  return typeof desc === "string" ? desc : desc.value;
}

export function mapDocToCatalogBook(
  doc: OpenLibrarySearchDoc,
  workDetails?: OpenLibraryWork,
): CatalogBookInsert {
  const isbn13 = doc.isbn?.find((i) => i.length === 13) ?? null;
  const isbn10 = doc.isbn?.find((i) => i.length === 10) ?? null;
  const coverIsbn = isbn13 ?? isbn10;

  const isPublicDomain = doc.ebook_access === "public";

  return {
    title: doc.title,
    authors: doc.author_name ?? [],
    description: workDetails
      ? extractDescription(workDetails.description)
      : null,
    cover_url: doc.cover_i
      ? getCoverUrlById(doc.cover_i, "M")
      : coverIsbn
        ? getCoverUrl(coverIsbn, "M")
        : null,
    isbn_10: isbn10,
    isbn_13: isbn13,
    publisher: doc.publisher?.[0] ?? null,
    published_date: doc.first_publish_year?.toString() ?? null,
    page_count: doc.number_of_pages_median ?? null,
    language: doc.language?.[0] ?? "en",
    categories: (doc.subject ?? []).slice(0, 5),
    source: "open_library",
    source_id: doc.key,
    ia_id: isPublicDomain ? (doc.ia?.[0] ?? null) : null,
  };
}
