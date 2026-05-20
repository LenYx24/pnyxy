import type { Highlight, Comment, HighlightColor } from "@/types/annotation";
import type { StoredBookmark } from "@/lib/annotation-storage";
import type { DocumentMeta } from "@/types/document";

/**
 * Lowest page number a highlight covers. Highlights span one or more
 * rects (a selection that wraps lines becomes several rects), each
 * with its own `pageNum`. For ordering and labelling we treat the
 * highlight as "starting" at its earliest page.
 *
 * Falls back to 1 when the rects array is empty — shouldn't happen
 * in practice (no selection = no save), but keeps the export
 * deterministic instead of throwing.
 */
function highlightPage(h: Highlight): number {
  let min = Number.POSITIVE_INFINITY;
  for (const r of h.selection.rects) {
    if (r.pageNum < min) min = r.pageNum;
  }
  return Number.isFinite(min) ? min : 1;
}

function commentPage(c: Comment): number {
  let min = Number.POSITIVE_INFINITY;
  for (const r of c.selection.rects) {
    if (r.pageNum < min) min = r.pageNum;
  }
  return Number.isFinite(min) ? min : 1;
}

const COLOR_LABEL: Record<HighlightColor, string> = {
  yellow: "Yellow",
  green: "Green",
  blue: "Blue",
  pink: "Pink",
  orange: "Orange",
};

function isoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Group comments under the highlight they're attached to. Returns a
 * map keyed by highlight id (with `null` for free-floating comments
 * that have no parent highlight).
 */
function indexCommentsByHighlight(
  comments: Comment[],
): { byHighlight: Map<string, Comment[]>; freestanding: Comment[] } {
  const byHighlight = new Map<string, Comment[]>();
  const freestanding: Comment[] = [];
  for (const c of comments) {
    if (c.highlightId) {
      const arr = byHighlight.get(c.highlightId) ?? [];
      arr.push(c);
      byHighlight.set(c.highlightId, arr);
    } else {
      freestanding.push(c);
    }
  }
  return { byHighlight, freestanding };
}

/**
 * Render the book's highlights + comments + bookmarks as portable
 * Markdown. Mirrors `conversationToMarkdown` for tonal consistency
 * (the user already exports chats this way) so anything paste-able
 * across Obsidian / Notion / Readwise plain-text imports stays
 * coherent.
 *
 * Sections:
 *   - Title header + metadata
 *   - Highlights grouped by page, sorted ascending; each block shows
 *     the colour and any threaded comments inline.
 *   - Free-floating comments (selection-anchored notes with no
 *     accompanying highlight) in their own list.
 *   - Bookmarks as a flat list, page-ordered.
 *
 * Free-floating comments are rare in practice (the UI nearly always
 * spawns them from a highlight) but the type allows them, so we
 * export them too — otherwise a power user could lose data on
 * round-trip.
 */
export function annotationsToMarkdown(
  meta: DocumentMeta,
  highlights: Highlight[],
  comments: Comment[],
  bookmarks: StoredBookmark[],
): string {
  const lines: string[] = [];

  const title = meta.title.trim() || "Untitled";
  lines.push(`# ${title}`);
  if (meta.author?.trim()) lines.push(`*by ${meta.author.trim()}*`);
  lines.push(`*Exported ${isoDate()}*`);
  lines.push("");

  const { byHighlight, freestanding } = indexCommentsByHighlight(comments);

  const orderedHighlights = [...highlights].sort((a, b) => {
    const pa = highlightPage(a);
    const pb = highlightPage(b);
    if (pa !== pb) return pa - pb;
    return a.createdAt - b.createdAt;
  });

  if (orderedHighlights.length > 0) {
    lines.push(`## Highlights (${orderedHighlights.length})`);
    lines.push("");
    for (const h of orderedHighlights) {
      const page = highlightPage(h);
      const color = COLOR_LABEL[h.color];
      lines.push(`### Page ${page} · ${color}`);
      // Blockquote each line of the selection so multi-line quotes
      // render correctly in markdown viewers that don't auto-wrap
      // unprefixed continuation lines inside a `>` block.
      const quoteBody = h.selection.text
        .split("\n")
        .map((l) => `> ${l}`)
        .join("\n");
      lines.push(quoteBody);

      const attachedComments = byHighlight.get(h.id) ?? [];
      for (const c of attachedComments) {
        for (const msg of c.messages) {
          if (msg.text.trim().length === 0) continue;
          lines.push(`**Note:** ${msg.text.trim()}`);
        }
      }
      lines.push("");
    }
  }

  if (freestanding.length > 0) {
    const ordered = [...freestanding].sort(
      (a, b) => commentPage(a) - commentPage(b),
    );
    lines.push(`## Notes (${ordered.length})`);
    lines.push("");
    for (const c of ordered) {
      const page = commentPage(c);
      lines.push(`### Page ${page}`);
      const quoteBody = c.selection.text
        .split("\n")
        .map((l) => `> ${l}`)
        .join("\n");
      lines.push(quoteBody);
      for (const msg of c.messages) {
        if (msg.text.trim().length === 0) continue;
        lines.push(`**Note:** ${msg.text.trim()}`);
      }
      lines.push("");
    }
  }

  if (bookmarks.length > 0) {
    const ordered = [...bookmarks].sort((a, b) => a.page - b.page);
    lines.push(`## Bookmarks (${ordered.length})`);
    lines.push("");
    for (const bm of ordered) {
      const label = bm.label.trim();
      lines.push(`- **Page ${bm.page}**${label ? ` — ${label}` : ""}`);
    }
    lines.push("");
  }

  if (
    orderedHighlights.length === 0 &&
    freestanding.length === 0 &&
    bookmarks.length === 0
  ) {
    lines.push(
      "*No highlights, notes, or bookmarks have been added to this document.*",
    );
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Full annotation dump as JSON. Schema is a thin wrapper around the
 * underlying types so a future "import highlights from another
 * Pnyxy install" feature can round-trip without inventing a new
 * format. The book-meta block carries enough to look the source
 * back up; the `schemaVersion` exists so a later breaking change
 * can be detected and migrated rather than crashing the parser.
 */
export function annotationsToJson(
  meta: DocumentMeta,
  highlights: Highlight[],
  comments: Comment[],
  bookmarks: StoredBookmark[],
): string {
  const payload = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    book: {
      id: meta.id,
      title: meta.title,
      author: meta.author,
      format: meta.format,
    },
    highlights,
    comments,
    bookmarks,
  };
  return JSON.stringify(payload, null, 2);
}

/**
 * Trigger a browser download of a text blob. Filename is sanitised
 * the same way `downloadMarkdown` in export-conversation does — keeps
 * Save dialogs across Windows / macOS / Linux happy with weird book
 * titles like "Foo / Bar: vol. 1?".
 */
export function downloadTextFile(
  filename: string,
  body: string,
  mimeType: string,
): void {
  const safe =
    filename
      .trim()
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 80) || "export";
  const blob = new Blob([body], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const ext = mimeType.includes("json") ? "json" : "md";
  a.download = `${safe}.${ext}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Safari can race the revoke against the download start when
  // synchronous; defer a tick.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
