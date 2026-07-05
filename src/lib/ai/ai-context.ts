// Builds the per-turn context pack injected into the system prompt:
// custom default context (persona/prefs from Settings), TOC outline,
// and extracted text from the currently-selected pages.

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
  /** Pages rendered as image attachments, either because the
   *  `aiSendPagesAsImage` toggle is on or as a fallback when text
   *  extraction came back empty for an image PDF. */
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

/** Flatten the TOC tree depth-first. Skips entries with an invalid
 *  pageIndex, some PDFs carry phantom outline nodes. */
function flattenToc(
  toc: readonly TocItem[],
  depth: number,
  out: FlatTocEntry[],
): void {
  for (const item of toc) {
    // pageIndex is 0-based, page labels are 1-based.
    if (Number.isFinite(item.pageIndex) && item.pageIndex >= 0) {
      out.push({ title: item.title, page: item.pageIndex + 1, depth });
    }
    if (item.children.length > 0) flattenToc(item.children, depth + 1, out);
  }
}

/** One outline line, 2 spaces of indent per level. */
const tocLine = (e: FlatTocEntry) =>
  `${"  ".repeat(e.depth)}- ${e.title} (p.${e.page})`;

/** ~1.5k tokens at 4 chars/token. */
const TOC_CHAR_BUDGET = 6000;

/** Render the TOC as an indented outline within TOC_CHAR_BUDGET. When
 *  over budget, keep every top-level chapter plus the sub-sections
 *  nearest currentPage; skipped runs collapse to a "  …" line. */
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

  // Over budget: pick which entries to keep.
  const keep = new Set<number>();
  let size = 0;
  // Keep every top-level chapter first.
  flat.forEach((e, i) => {
    if (e.depth === 0) {
      keep.add(i);
      size += tocLine(e).length + 1;
    }
  });
  // Then fill the rest of the budget with entries closest to currentPage.
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

  // Emit in document order, collapsing skipped runs to "  …".
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

/** Pull text for a sparse set of pages, calling extractPdfText once
 *  per contiguous run. extractPdfText reopens the doc every call, so
 *  coalescing runs avoids redundant loads. */
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
 *  there's nothing to include. */
export async function buildAiContextPack(
  docId: string | null | undefined,
): Promise<AiContextPack> {
  const settings = useSettingsStore.getState();
  const customContext = settings.aiCustomDefaultContext.trim();

  if (!docId) {
    // Plain chat, no source doc, but still surface the user persona.
    return { customContext, pageContext: "", imageAttachments: [] };
  }

  const doc = useReaderStore.getState().documents.get(docId);
  if (!doc)
    return { customContext, pageContext: "", imageAttachments: [] };

  const sections: string[] = [];
  let imageAttachments: ChatMessageAttachment[] = [];

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

  // Selected pages: only PDFs have extractable text here.
  if (
    doc.aiSelectedPages.size > 0 &&
    doc.meta.format === "pdf" &&
    doc.meta.fileUrl
  ) {
    const pages = Array.from(doc.aiSelectedPages);
    const forceImage = doc.aiSendPagesAsImage;

    // In image mode, skip text extraction to save a pdfjs pass.
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

/** Empty pack for non-PDF / no-doc paths. */
export function emptyAiContextPack(): AiContextPack {
  return EMPTY_PACK;
}
