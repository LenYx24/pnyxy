/**
 * Pure parser for AI-emitted recommendation blocks. Lives in a `.ts`
 * (not `.tsx`) so it can be imported from anywhere without dragging
 * the React renderer along, and to keep `react-refresh` happy about
 * "only export components from a tsx file".
 */

export interface RecommendedBook {
  title: string;
  author: string;
  year: number | null;
  isbn: string | null;
  description: string;
  level?: "beginner" | "intermediate" | "advanced";
}

export interface RecommendedVideo {
  title: string;
  channel: string;
  url: string | null;
  kind: "video" | "course" | "article" | "podcast";
  duration: string | null;
  description: string;
  level?: "beginner" | "intermediate" | "advanced";
}

interface ExtractResult {
  /** Markdown content with the recommendation fence(s) stripped. */
  cleaned: string;
  books?: RecommendedBook[];
  videos?: RecommendedVideo[];
}

const BOOK_FENCE = /```pnyxy-books\s*([\s\S]*?)```/gi;
const VIDEO_FENCE = /```pnyxy-videos\s*([\s\S]*?)```/gi;

/**
 * Strip recommendation code blocks out of an assistant message and
 * parse them into structured arrays. Cleaned prose still goes through
 * the regular markdown renderer; the parsed lists become React cards.
 *
 * Mid-stream the JSON inside the fence may be incomplete — we
 * silently swallow the parse error and just leave the fence stripped
 * (so half-finished JSON doesn't render in the prose). Once the
 * stream settles the next call parses successfully and the cards
 * appear.
 */
export function extractRecommendations(content: string): ExtractResult {
  let cleaned = content;
  const books: RecommendedBook[] = [];
  const videos: RecommendedVideo[] = [];

  cleaned = cleaned.replace(BOOK_FENCE, (_match, body: string) => {
    try {
      const parsed = JSON.parse(body.trim());
      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          const b = coerceBook(entry);
          if (b) books.push(b);
        }
      }
    } catch {
      // partial JSON during streaming — ignore
    }
    return "";
  });

  cleaned = cleaned.replace(VIDEO_FENCE, (_match, body: string) => {
    try {
      const parsed = JSON.parse(body.trim());
      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          const v = coerceVideo(entry);
          if (v) videos.push(v);
        }
      }
    } catch {
      // see above
    }
    return "";
  });

  return {
    cleaned: cleaned.trim(),
    books: books.length ? books : undefined,
    videos: videos.length ? videos : undefined,
  };
}

function coerceBook(raw: unknown): RecommendedBook | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.title !== "string" || typeof r.author !== "string") return null;
  return {
    title: r.title.trim(),
    author: r.author.trim(),
    year: typeof r.year === "number" && Number.isFinite(r.year) ? r.year : null,
    isbn: typeof r.isbn === "string" && r.isbn.trim() ? r.isbn.trim() : null,
    description:
      typeof r.description === "string" ? r.description.trim() : "",
    level:
      r.level === "beginner" || r.level === "intermediate" || r.level === "advanced"
        ? r.level
        : undefined,
  };
}

function coerceVideo(raw: unknown): RecommendedVideo | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.title !== "string" || typeof r.channel !== "string") return null;
  const kind =
    r.kind === "video" ||
    r.kind === "course" ||
    r.kind === "article" ||
    r.kind === "podcast"
      ? r.kind
      : "video";
  return {
    title: r.title.trim(),
    channel: r.channel.trim(),
    url: typeof r.url === "string" && r.url.trim() ? r.url.trim() : null,
    kind,
    duration:
      typeof r.duration === "string" && r.duration.trim()
        ? r.duration.trim()
        : null,
    description: typeof r.description === "string" ? r.description.trim() : "",
    level:
      r.level === "beginner" || r.level === "intermediate" || r.level === "advanced"
        ? r.level
        : undefined,
  };
}
