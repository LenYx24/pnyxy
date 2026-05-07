// Builds the per-turn context pack the chat-store injects into the
// system prompt. Three pieces:
//
//   1. Custom default context — free-form persona / preferences from
//      Settings → AI. Always included if non-empty.
//   2. TOC outline — the doc's table of contents, included when
//      `aiAttachToc` is on and the doc actually has a toc.
//   3. Page text — extracted via pdfjs from the user's currently-
//      selected pages (TOC selection mode in ThumbnailToc) or empty
//      if nothing is selected.
//
// Returned as two strings:
//   - `customContext` becomes a "[User context]" section in the
//     system prompt (separate from book content).
//   - `pageContext` is the existing block buildSystemPrompt has
//     always been wrapping in `---` after "Here is the text from
//     the pages the user is currently viewing"; we now actually
//     fill it. TOC + selected-page text both go in here, framed
//     with "[Table of Contents]" / "[Page N]" markers so the model
//     can see what's what.

import { useReaderStore } from "@/stores/reader-store";
import { useSettingsStore } from "@/stores/settings-store";
import { extractPdfText } from "@/lib/ai-client";
import type { TocItem } from "@/types/document";

export interface AiContextPack {
  /** Free-form user persona / preferences. May be empty. */
  customContext: string;
  /** Book-side context: TOC outline + selected-page text. May be empty. */
  pageContext: string;
}

const EMPTY_PACK: AiContextPack = { customContext: "", pageContext: "" };

/** Render the TOC tree as an indented outline. Skips entries with
 *  invalid pageIndex (some PDFs have phantom outline nodes pointing
 *  to nonexistent pages). Indentation = 2 spaces per nesting level. */
function renderToc(toc: readonly TocItem[], depth = 0): string {
  const lines: string[] = [];
  for (const item of toc) {
    if (Number.isFinite(item.pageIndex) && item.pageIndex >= 0) {
      const indent = "  ".repeat(depth);
      // pageIndex is 0-based in the model; users see 1-based labels.
      lines.push(`${indent}- ${item.title} (p.${item.pageIndex + 1})`);
    }
    if (item.children.length > 0) {
      const child = renderToc(item.children, depth + 1);
      if (child) lines.push(child);
    }
  }
  return lines.join("\n");
}

/** Pull text for a sparse set of pages. Calls extractPdfText once
 *  per contiguous run so a 1,3,5,7 selection doesn't fire 4 separate
 *  pdfjs document loads — extractPdfText reopens the doc every call,
 *  so coalescing matters. The result is page-tagged either way
 *  ([Page N] markers come from extractPdfText). */
async function extractSelectedPages(
  fileUrl: string,
  pages: readonly number[],
): Promise<string> {
  if (pages.length === 0) return "";
  const sorted = [...pages].sort((a, b) => a - b);
  const runs: { from: number; to: number }[] = [];
  let runStart = sorted[0];
  let runEnd = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    const p = sorted[i];
    if (p === runEnd + 1) {
      runEnd = p;
    } else {
      runs.push({ from: runStart, to: runEnd });
      runStart = p;
      runEnd = p;
    }
  }
  runs.push({ from: runStart, to: runEnd });

  const chunks: string[] = [];
  for (const r of runs) {
    const text = await extractPdfText(fileUrl, r.from, r.to);
    if (text.trim()) chunks.push(text);
  }
  return chunks.join("\n\n");
}

/** Build the AI context pack for `docId`. Returns empty strings when
 *  there's nothing to include — the chat-store's system-prompt
 *  builder treats both as optional, so an empty pack falls back to
 *  the existing generic-or-doc-aware behavior unchanged. */
export async function buildAiContextPack(
  docId: string | null | undefined,
): Promise<AiContextPack> {
  const settings = useSettingsStore.getState();
  const customContext = settings.aiCustomDefaultContext.trim();

  if (!docId) {
    // Plain chat — no source doc. We still surface the user persona
    // so even an unattached chat respects "I'm a CS student" prefs.
    return { customContext, pageContext: "" };
  }

  const doc = useReaderStore.getState().documents.get(docId);
  if (!doc) return { customContext, pageContext: "" };

  const sections: string[] = [];

  // TOC: cheap to include, often the highest-leverage context for
  // "what's this book about" / "where do I find X" questions.
  if (settings.aiAttachToc && doc.toc.length > 0) {
    const tocText = renderToc(doc.toc);
    if (tocText.trim()) {
      sections.push(`[Table of Contents]\n${tocText}`);
    }
  }

  // Selected pages: only PDFs have extractable text. Other formats
  // would need their own adapter.getPageText path; out of scope for
  // this pass.
  if (
    doc.aiSelectedPages.size > 0 &&
    doc.meta.format === "pdf" &&
    doc.meta.fileUrl
  ) {
    const pages = Array.from(doc.aiSelectedPages);
    try {
      const pagesText = await extractSelectedPages(doc.meta.fileUrl, pages);
      if (pagesText.trim()) {
        sections.push(pagesText);
      }
    } catch (err) {
      console.warn("[ai-context] page extraction failed:", err);
    }
  }

  return {
    customContext,
    pageContext: sections.join("\n\n---\n\n"),
  };
}

/** Safe entry point for non-PDF / no-doc paths. Mirrors the public
 *  shape so callers don't have to special-case "no context"
 *  themselves. */
export function emptyAiContextPack(): AiContextPack {
  return EMPTY_PACK;
}
