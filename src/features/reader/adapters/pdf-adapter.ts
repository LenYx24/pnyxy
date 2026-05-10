import { pdfjs } from "react-pdf";
import type {
  DocumentAdapter,
  DocumentMeta,
  PageRect,
  SearchMatch,
  SearchOptions,
  TocItem,
} from "@/types/document";
import { buildSearchRegex } from "@/lib/text-search";

type PDFDocumentProxy = Awaited<
  ReturnType<typeof pdfjs.getDocument>["promise"]
>;

async function computeFileHash(file: File): Promise<string> {
  const chunk = file.slice(0, 65536);
  const buffer = await chunk.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

const SNIPPET_CONTEXT = 60;

export function createPdfAdapter(): DocumentAdapter {
  let doc: PDFDocumentProxy | null = null;
  let objectUrl: string | null = null;

  return {
    async load(file: File): Promise<DocumentMeta> {
      objectUrl = URL.createObjectURL(file);
      const loadedDoc = await pdfjs.getDocument({
        url: objectUrl,
        cMapUrl: "/pdf-assets/cmaps/",
        cMapPacked: true,
      }).promise;
      doc = loadedDoc;

      const pdfMeta = await loadedDoc.getMetadata();
      const info = pdfMeta.info as Record<string, unknown>;
      const fileHash = await computeFileHash(file);

      return {
        id: fileHash,
        title: (info?.Title as string) || file.name.replace(/\.pdf$/i, ""),
        author: (info?.Author as string) || "Unknown",
        format: "pdf",
        totalPages: loadedDoc.numPages,
        fileUrl: objectUrl,
        capabilities: {
          paginated: true,
          editable: false,
          searchable: true,
        },
      };
    },

    async extractToc(): Promise<TocItem[]> {
      if (!doc) return [];
      const currentDoc = doc;

      const outline = await currentDoc.getOutline();
      if (!outline) return [];

      async function resolveItems(
        items: Awaited<ReturnType<PDFDocumentProxy["getOutline"]>>,
      ): Promise<TocItem[]> {
        if (!items) return [];

        const result: TocItem[] = [];
        for (const item of items) {
          let pageIndex = 0;
          if (item.dest) {
            try {
              const dest =
                typeof item.dest === "string"
                  ? await currentDoc.getDestination(item.dest)
                  : item.dest;
              if (dest) {
                const ref = dest[0];
                pageIndex = await currentDoc.getPageIndex(ref);
              }
            } catch {
              // fallback to page 0
            }
          }

          result.push({
            title: item.title,
            pageIndex,
            children: await resolveItems(item.items),
          });
        }
        return result;
      }

      return resolveItems(outline);
    },

    async search(query: string, opts: SearchOptions): Promise<SearchMatch[]> {
      if (!doc || !query) return [];
      const builtRegex = buildSearchRegex(query, opts);
      if (!builtRegex) return [];
      // Narrow into a non-null binding so inner closures don't lose it.
      const regex = builtRegex;

      const currentDoc = doc;
      const numPages = currentDoc.numPages;

      type ItemRange = {
        start: number;
        end: number;
        item: {
          str: string;
          width: number;
          height: number;
          transform: number[];
        };
      };

      async function searchPage(pageNum: number): Promise<SearchMatch[]> {
        const page = await currentDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale: 1 });
        const content = await page.getTextContent();

        const ranges: ItemRange[] = [];
        let flat = "";
        for (const item of content.items) {
          if (!("str" in item)) continue;
          const typed = item as ItemRange["item"];
          const start = flat.length;
          flat += typed.str;
          const end = flat.length;
          ranges.push({ start, end, item: typed });
          // Approximate inter-item whitespace the way the old code did
          flat += " ";
        }

        const out: SearchMatch[] = [];
        // matchAll needs a fresh global regex per-page.
        const pageRegex = new RegExp(regex.source, regex.flags);
        let seq = 0;
        for (const m of flat.matchAll(pageRegex)) {
          if (m.index === undefined) continue;
          const matchStart = m.index;
          const matchEnd = matchStart + m[0].length;
          if (matchEnd === matchStart) continue; // zero-width match — skip

          const rects: PageRect[] = [];
          for (const r of ranges) {
            if (r.end <= matchStart || r.start >= matchEnd) continue;
            const t = r.item.transform;
            const tx = t[4];
            const ty = t[5];
            // pdfjs uses bottom-left origin; flip to top-left for CSS coords
            const yTop = viewport.height - ty - r.item.height;
            // pdfjs returns text items as RUNS — a single item can hold
            // many characters ("The cat sat on the mat"). A whole-item
            // rect would paint that entire run for a match on just
            // "cat". Slice the rect down to the matched substring's
            // proportional offsets within the item; for monospaced and
            // most proportional fonts this lands within a pixel of the
            // visible glyphs.
            const itemLen = r.end - r.start;
            const overlapStart = Math.max(r.start, matchStart);
            const overlapEnd = Math.min(r.end, matchEnd);
            const relStart =
              itemLen > 0 ? (overlapStart - r.start) / itemLen : 0;
            const relEnd =
              itemLen > 0 ? (overlapEnd - r.start) / itemLen : 1;
            const subX = tx + r.item.width * relStart;
            const subWidth = r.item.width * (relEnd - relStart);
            rects.push({
              pageNum,
              x: subX / viewport.width,
              y: yTop / viewport.height,
              width: subWidth / viewport.width,
              height: r.item.height / viewport.height,
            });
          }

          const snippetStart = Math.max(0, matchStart - SNIPPET_CONTEXT);
          const snippetEnd = Math.min(flat.length, matchEnd + SNIPPET_CONTEXT);
          const snippet =
            (snippetStart > 0 ? "…" : "") +
            flat.slice(snippetStart, snippetEnd) +
            (snippetEnd < flat.length ? "…" : "");

          out.push({
            id: `pdf:${pageNum}:${seq++}`,
            pageNum,
            snippet,
            snippetMatchStart:
              matchStart - snippetStart + (snippetStart > 0 ? 1 : 0),
            snippetMatchEnd:
              matchEnd - snippetStart + (snippetStart > 0 ? 1 : 0),
            rects,
          });
        }
        return out;
      }

      // Process pages with bounded concurrency. The pdfjs worker pipelines
      // requests, so a small pool is much faster than a sequential loop on
      // big documents while staying friendly to the worker thread.
      const CONCURRENCY = 8;
      const results: SearchMatch[][] = new Array(numPages);
      let nextPage = 1;

      async function worker() {
        while (true) {
          const pageNum = nextPage++;
          if (pageNum > numPages) return;
          results[pageNum - 1] = await searchPage(pageNum);
        }
      }

      const workers: Promise<void>[] = [];
      for (let i = 0; i < Math.min(CONCURRENCY, numPages); i++) {
        workers.push(worker());
      }
      await Promise.all(workers);

      // Flatten in page order so the consumer's "next/prev" navigation is
      // monotonic across pages.
      const matches: SearchMatch[] = [];
      for (let i = 0; i < numPages; i++) {
        const pageMatches = results[i];
        if (pageMatches) matches.push(...pageMatches);
      }
      return matches;
    },

    dispose() {
      if (doc) {
        doc.destroy();
        doc = null;
      }
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = null;
      }
    },
  };
}
