import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export interface PageText {
  page: number;
  text: string;
}

/** Text of pages [from, to] (1-based, clamped), one entry per page. */
export async function extractPages(
  bytes: Uint8Array,
  from: number,
  to: number,
): Promise<{ pages: PageText[]; pageCount: number }> {
  const task = getDocument({ data: bytes, useSystemFonts: true });
  const doc = await task.promise;
  try {
    const first = Math.max(1, from);
    const last = Math.min(doc.numPages, to);
    const pages: PageText[] = [];
    for (let n = first; n <= last; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      let text = "";
      for (const item of content.items) {
        if (!("str" in item)) continue;
        text += item.str + (item.hasEOL ? "\n" : " ");
      }
      pages.push({ page: n, text: text.replace(/[ \t]+\n/g, "\n").trim() });
      page.cleanup();
    }
    return { pages, pageCount: doc.numPages };
  } finally {
    await task.destroy();
  }
}
