import type { Highlight, Comment, HighlightColor } from "@/types/annotation";
import type { StoredBookmark } from "@/lib/annotation-storage";
import type { DocumentMeta } from "@/types/document";

// earliest page a highlight's rects touch; 1 if empty
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

// bucket comments by their parent highlight id; parentless ones go to freestanding
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

/** Render highlights, comments and bookmarks as portable Markdown. */
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
      // prefix every line so multi-line selections stay inside the blockquote
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
      lines.push(`- **Page ${bm.page}**${label ? ` - ${label}` : ""}`);
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

/** Full annotation dump as JSON. schemaVersion allows future migrations. */
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

/** Trigger a browser download of a text blob, sanitising the filename. */
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
  // Safari races revoke against the download if synchronous; defer a tick
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
