import ePub, { type Book } from "epubjs";
import type {
  DocumentAdapter,
  DocumentMeta,
  SearchMatch,
  SearchOptions,
  TocItem,
} from "@/types/document";
import { buildSearchRegex } from "@/lib/text-search";

const SNIPPET_CONTEXT = 60;

interface NavItem {
  id?: string;
  label?: string;
  href?: string;
  subitems?: NavItem[];
}

interface SpineItem {
  href?: string;
  idref?: string;
  load: (...args: unknown[]) => Promise<Document | XMLDocument>;
  unload?: () => void;
}

interface EpubAdapter extends DocumentAdapter {
  /** Expose the underlying epubjs Book for the viewer to render. */
  getBook(): Book | null;
}

function navToToc(nav: NavItem[] = []): TocItem[] {
  return nav.map((item) => ({
    title: item.label?.trim() ?? "",
    pageIndex: 0,
    children: item.subitems ? navToToc(item.subitems) : [],
  }));
}

async function computeFileHash(file: File): Promise<string> {
  const chunk = file.slice(0, 65536);
  const buffer = await chunk.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Walk an `epubjs` spine using `spine.each` (which is present across
 * v0.3.x releases). Returns the spine items in reading order.
 */
function collectSpine(book: Book): SpineItem[] {
  const items: SpineItem[] = [];
  const spine = (book as unknown as { spine?: { each?: (fn: (item: unknown) => void) => void; items?: unknown[] } }).spine;
  if (!spine) return items;
  if (typeof spine.each === "function") {
    spine.each((item: unknown) => {
      if (item) items.push(item as SpineItem);
    });
  } else if (Array.isArray(spine.items)) {
    for (const item of spine.items) items.push(item as SpineItem);
  }
  return items;
}

export function createEpubAdapter(): EpubAdapter {
  let book: Book | null = null;
  let objectUrl: string | null = null;

  return {
    async load(file: File): Promise<DocumentMeta> {
      const buffer = await file.arrayBuffer();
      book = ePub(buffer as ArrayBuffer);
      await book.ready;

      const metadata = await book.loaded.metadata;
      const id = await computeFileHash(file);
      objectUrl = URL.createObjectURL(file);

      return {
        id,
        title: metadata?.title?.trim() || file.name.replace(/\.epub$/i, ""),
        author:
          (metadata as { creator?: string } | undefined)?.creator?.trim() ||
          "Unknown",
        format: "epub",
        totalPages: 1,
        fileUrl: objectUrl,
        capabilities: {
          paginated: false,
          editable: false,
          searchable: true,
        },
      };
    },

    async extractToc(): Promise<TocItem[]> {
      if (!book) return [];
      const nav = await book.loaded.navigation;
      const toc = (nav as { toc?: NavItem[] } | undefined)?.toc;
      return navToToc(toc ?? []);
    },

    async search(
      query: string,
      opts: SearchOptions,
    ): Promise<SearchMatch[]> {
      if (!book) return [];
      const regex = buildSearchRegex(query, opts);
      if (!regex) return [];

      const results: SearchMatch[] = [];
      let seq = 0;
      const items = collectSpine(book);

      for (const item of items) {
        let doc: Document | XMLDocument | null = null;
        try {
          doc = await item.load(book.load.bind(book));
        } catch {
          continue;
        }
        const text = doc?.body?.textContent ?? doc?.documentElement?.textContent ?? "";
        if (!text) {
          item.unload?.();
          continue;
        }

        const spineHref = item.href ?? item.idref;
        const pass = new RegExp(regex.source, regex.flags);
        for (const m of text.matchAll(pass)) {
          if (m.index === undefined) continue;
          const matchStart = m.index;
          const matchEnd = matchStart + m[0].length;
          if (matchEnd === matchStart) continue;

          const snippetStart = Math.max(0, matchStart - SNIPPET_CONTEXT);
          const snippetEnd = Math.min(text.length, matchEnd + SNIPPET_CONTEXT);
          const snippet =
            (snippetStart > 0 ? "…" : "") +
            text.slice(snippetStart, snippetEnd) +
            (snippetEnd < text.length ? "…" : "");

          results.push({
            id: `epub:${seq++}`,
            spineHref,
            snippet,
            snippetMatchStart:
              matchStart - snippetStart + (snippetStart > 0 ? 1 : 0),
            snippetMatchEnd:
              matchEnd - snippetStart + (snippetStart > 0 ? 1 : 0),
          });
        }

        item.unload?.();
      }

      return results;
    },

    dispose() {
      book?.destroy?.();
      book = null;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = null;
      }
    },

    getBook() {
      return book;
    },
  };
}
