/**
 * Stack-Overflow-style decorative slugs for book URLs. The id stays
 * authoritative; the slug is for shareable / readable links and
 * gets stripped in the lookup. Empty-result fallback is "book" so
 * we never produce a bare trailing `/`.
 *
 * Hungarian text matters here — `Vörös és fekete` should yield
 * `voros-es-fekete`, not be mangled to a hash. NFD decomposition +
 * stripping the combining marks (U+0300..U+036F) handles that for
 * any Latin-derived script. Cyrillic / CJK / Arabic source titles
 * end up empty after the alphanumeric filter and fall through to
 * "book".
 */
const FALLBACK_SLUG = "book";
const MAX_SLUG_LENGTH = 60;

const COMBINING_DIACRITICS = /[̀-ͯ]/g;

export function slugify(text: string): string {
  if (!text) return FALLBACK_SLUG;
  const normalized = text
    .normalize("NFD")
    .replace(COMBINING_DIACRITICS, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-") // any run of non-alphanumeric → "-"
    .replace(/^-+|-+$/g, "") // trim leading/trailing dashes
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, ""); // re-trim if the slice cut mid-dash run
  return normalized || FALLBACK_SLUG;
}

/**
 * Encode a book id + slug into a single URL segment. Format is
 * `<slug>--<id>` so the recognizable part shows first when shared.
 * The double-dash is the delimiter — slugify() never emits `--`
 * (runs of non-alphanumerics collapse to a single `-`), and IDs
 * are UUIDs (single dashes only) or hex hashes (no dashes), so
 * `--` is unambiguous.
 *
 * Pass an empty / falsy title for a bare-id segment (used during
 * transitional flows, fallback paths). Callers that want
 * canonical URLs should always pass a real title.
 */
export function bookIdSegment(id: string, title?: string | null): string {
  const slug = title ? slugify(title) : "";
  if (!slug || slug === FALLBACK_SLUG) return id;
  return `${slug}--${id}`;
}

/**
 * Reverse of bookIdSegment. Given a `:bookId` URL param, extract
 * the actual book id (used for DB lookup). If no slug delimiter
 * is present, the param IS the id (legacy / freshly-pasted link).
 */
export function parseBookIdSegment(segment: string): {
  id: string;
  slug: string | null;
} {
  const idx = segment.lastIndexOf("--");
  if (idx === -1) return { id: segment, slug: null };
  return {
    slug: segment.slice(0, idx),
    id: segment.slice(idx + 2),
  };
}
