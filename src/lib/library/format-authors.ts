/**
 * Author display + parsing helpers shared by the library, book detail,
 * and home surfaces. Uploaded books carry a structured `authors`
 * array (since migration 00048) plus a legacy joined `author` string;
 * these helpers prefer the array and fall back to the string.
 */

/** Join a structured authors list for display, falling back to the
 *  legacy single-author string. Returns "" when nothing is known so
 *  callers can apply their own "Unknown author" label. */
export function formatAuthors(
  authors: string[] | null | undefined,
  fallback?: string | null,
): string {
  if (authors && authors.length > 0) return authors.join(", ");
  return fallback?.trim() ? fallback : "";
}

/** Parse a comma-separated author input into a clean, de-duped list. */
export function parseAuthorsInput(value: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of value.split(",")) {
    const a = raw.trim();
    if (a && !seen.has(a)) {
      seen.add(a);
      out.push(a);
    }
  }
  return out;
}
