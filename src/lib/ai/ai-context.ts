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
import { extractPdfText, renderPdfPagesToImages } from "@/lib/ai/ai-client";
import type { TocItem } from "@/types/document";
import type { ChatMessageAttachment } from "@/types/chat";

export interface AiContextPack {
  /** Free-form user persona / preferences. May be empty. */
  customContext: string;
  /** Book-side context: TOC outline + selected-page text. May be empty. */
  pageContext: string;
  /** Pages rendered as image attachments. Two ways this gets
   *  populated:
   *    1. The doc's `aiSendPagesAsImage` toggle is on (user
   *       explicitly wants the model to see figures).
   *    2. Auto-fallback: text extraction returned empty for an
   *       image PDF — we render the selected pages so the model
   *       isn't left guessing on a blank context.
   *  Caller (chat-store) folds these into the outgoing user
   *  message's `attachments` field before inserting the row. */
  imageAttachments: ChatMessageAttachment[];
}

const EMPTY_PACK: AiContextPack = {
  customContext: "",
  pageContext: "",
  imageAttachments: [],
};

interface FlatTocEntry {
  title: string;
  /** 1-based page label, matching what the user sees in the reader. */
  page: number;
  depth: number;
}

/** Flatten the TOC tree depth-first, preserving document order and
 *  nesting depth. Skips entries with an invalid pageIndex (phantom
 *  outline nodes some PDFs carry pointing at nonexistent pages). */
function flattenToc(
  toc: readonly TocItem[],
  depth: number,
  out: FlatTocEntry[],
): void {
  for (const item of toc) {
    // pageIndex is 0-based in the model; users see 1-based labels.
    if (Number.isFinite(item.pageIndex) && item.pageIndex >= 0) {
      out.push({ title: item.title, page: item.pageIndex + 1, depth });
    }
    if (item.children.length > 0) flattenToc(item.children, depth + 1, out);
  }
}

/** One indented outline line. Indentation = 2 spaces per level. */
const tocLine = (e: FlatTocEntry) =>
  `${"  ".repeat(e.depth)}- ${e.title} (p.${e.page})`;

/** Character budget for the TOC block (~1.5k tokens at 4 chars/token).
 *  Most books fit whole; only sprawling, deeply-nested textbook TOCs
 *  trip the cap. */
const TOC_CHAR_BUDGET = 6000;

/** Render the TOC as an indented outline, bounded to TOC_CHAR_BUDGET.
 *  Small TOCs render in full — unchanged behavior. When a TOC is too
 *  big to send whole, we keep every top-level chapter (cheap, and it
 *  gives the model the whole-book map that "where do I find X"
 *  questions need) and spend the rest of the budget on the sub-section
 *  entries nearest the reader's current page (the local detail a
 *  "what does this section cover" question needs). Skipped runs
 *  collapse to a "  …" line so the model can tell the outline was
 *  abbreviated and ask for a chapter to be expanded. */
function renderTocWithinBudget(
  toc: readonly TocItem[],
  currentPage: number,
): { text: string; abbreviated: boolean } {
  const flat: FlatTocEntry[] = [];
  flattenToc(toc, 0, flat);
  if (flat.length === 0) return { text: "", abbreviated: false };

  const full = flat.map(tocLine).join("\n");
  if (full.length <= TOC_CHAR_BUDGET) {
    return { text: full, abbreviated: false };
  }

  // Over budget — decide which entries to keep.
  const keep = new Set<number>();
  let size = 0;
  // 1. Every top-level chapter: the global map, usually small.
  flat.forEach((e, i) => {
    if (e.depth === 0) {
      keep.add(i);
      size += tocLine(e).length + 1;
    }
  });
  // 2. Fill the remaining budget with entries closest to the page the
  //    reader is on, so nearby sub-sections survive the cut.
  const rest = flat
    .map((e, i) => ({ i, e }))
    .filter(({ i }) => !keep.has(i))
    .sort(
      (a, b) =>
        Math.abs(a.e.page - currentPage) - Math.abs(b.e.page - currentPage),
    );
  for (const { i, e } of rest) {
    const cost = tocLine(e).length + 1;
    if (size + cost > TOC_CHAR_BUDGET) break;
    keep.add(i);
    size += cost;
  }

  // Emit in original document order; collapse skipped runs to "  …".
  const lines: string[] = [];
  let skipping = false;
  flat.forEach((e, i) => {
    if (keep.has(i)) {
      if (skipping) {
        lines.push("  …");
        skipping = false;
      }
      lines.push(tocLine(e));
    } else {
      skipping = true;
    }
  });
  return { text: lines.join("\n"), abbreviated: true };
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
    return { customContext, pageContext: "", imageAttachments: [] };
  }

  const doc = useReaderStore.getState().documents.get(docId);
  if (!doc)
    return { customContext, pageContext: "", imageAttachments: [] };

  const sections: string[] = [];
  let imageAttachments: ChatMessageAttachment[] = [];

  // TOC: cheap to include, often the highest-leverage context for
  // "what's this book about" / "where do I find X" questions.
  if (settings.aiAttachToc && doc.toc.length > 0) {
    const { text: tocText, abbreviated } = renderTocWithinBudget(
      doc.toc,
      doc.currentPage,
    );
    if (tocText.trim()) {
      const label = abbreviated
        ? "[Table of Contents — abbreviated; ask for a chapter to see its sub-sections]"
        : "[Table of Contents]";
      sections.push(`${label}\n${tocText}`);
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
    const forceImage = doc.aiSendPagesAsImage;

    // Skip text extraction entirely when the user opted into image
    // mode — saves a pdfjs pass on big selections.
    let pagesText = "";
    if (!forceImage) {
      try {
        pagesText = await extractSelectedPages(doc.meta.fileUrl, pages);
      } catch (err) {
        console.warn("[ai-context] page extraction failed:", err);
      }
    }

    const textIsEmpty = !pagesText.trim();
    const shouldRender = forceImage || textIsEmpty;

    if (shouldRender) {
      try {
        const rendered = await renderPdfPagesToImages(doc.meta.fileUrl, pages);
        imageAttachments = rendered.map((r) => ({
          kind: "image",
          media_type: r.mediaType,
          data: r.base64,
          name: `Page ${r.page}`,
        }));
      } catch (err) {
        console.warn("[ai-context] page render failed:", err);
      }
    }

    if (!shouldRender && pagesText.trim()) {
      sections.push(pagesText);
    }
  }

  return {
    customContext,
    pageContext: sections.join("\n\n---\n\n"),
    imageAttachments,
  };
}

/** Safe entry point for non-PDF / no-doc paths. Mirrors the public
 *  shape so callers don't have to special-case "no context"
 *  themselves. */
export function emptyAiContextPack(): AiContextPack {
  return EMPTY_PACK;
}
