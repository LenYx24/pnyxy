/**
 * Wikipedia REST API client, keyless, free, generous CORS.
 *
 * Endpoint reference:
 *   https://{lang}.wikipedia.org/api/rest_v1/page/summary/{title}
 *
 * Behavior:
 *   200 → article (or disambiguation/no-extract; check `type`).
 *   302 → redirect handled transparently by the server.
 *   404 → no page with that exact title.
 *
 * We deliberately keep this lib thin: a single `fetchWikipediaSummary`
 * function returns a typed result, and callers handle the UI shape
 * (loading state, no-result fallback, language switch).
 */

export type WikipediaPageType =
  | "standard"
  | "disambiguation"
  | "no-extract"
  | "mainpage";

export interface WikipediaSummary {
  /** Canonical display title (may differ from query after redirects). */
  title: string;
  /** Two-letter ISO code we queried (`hu`, `en`). */
  lang: string;
  /** Page kind, disambiguation pages still return text, but the caller
   *  may want to label the panel differently. */
  type: WikipediaPageType;
  /** Plain-text article extract (already stripped of HTML). */
  extract: string;
  /** Thumbnail image URL, if the article has one. */
  thumbnailUrl: string | null;
  /** Full URL to the article on the desktop site. */
  pageUrl: string;
}

interface RestApiResponse {
  title?: string;
  type?: string;
  extract?: string;
  thumbnail?: { source?: string };
  content_urls?: {
    desktop?: { page?: string };
    mobile?: { page?: string };
  };
}

const TYPE_FALLBACK: WikipediaPageType = "standard";

function coerceType(value: string | undefined): WikipediaPageType {
  if (
    value === "standard" ||
    value === "disambiguation" ||
    value === "no-extract" ||
    value === "mainpage"
  ) {
    return value;
  }
  return TYPE_FALLBACK;
}

/**
 * Fetch a summary for the given title in the given language. Returns
 * `null` when Wikipedia has no matching page (HTTP 404). Throws on
 * network / 5xx errors so callers can surface a retry CTA.
 */
export async function fetchWikipediaSummary(
  title: string,
  lang: string,
  options: { signal?: AbortSignal } = {},
): Promise<WikipediaSummary | null> {
  const trimmed = title.trim();
  if (!trimmed) return null;

  // Wikipedia's REST endpoint expects underscores instead of spaces.
  // `encodeURIComponent` handles the rest of the unsafe characters.
  const safeTitle = encodeURIComponent(trimmed.replace(/\s+/g, "_"));
  const url = `https://${encodeURIComponent(lang)}.wikipedia.org/api/rest_v1/page/summary/${safeTitle}`;

  const response = await fetch(url, {
    headers: {
      // The REST API recommends a non-default UA so they can correlate
      // traffic; identifying as our app keeps us within their etiquette
      // expectations. Plain `accept` covers the JSON-by-default case
      // and is harmless if the endpoint always returns JSON.
      accept: "application/json",
    },
    signal: options.signal,
  });

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Wikipedia HTTP ${response.status}`);
  }

  const data = (await response.json()) as RestApiResponse;
  const fallbackPageUrl = `https://${lang}.wikipedia.org/wiki/${safeTitle}`;

  return {
    title: data.title?.trim() || trimmed,
    lang,
    type: coerceType(data.type),
    extract: (data.extract ?? "").trim(),
    thumbnailUrl: data.thumbnail?.source ?? null,
    pageUrl: data.content_urls?.desktop?.page ?? fallbackPageUrl,
  };
}
