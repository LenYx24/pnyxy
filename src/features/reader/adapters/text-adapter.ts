import type {
  DocumentAdapter,
  DocumentMeta,
  SearchMatch,
  SearchOptions,
  TocItem,
} from "@/types/document";
import { runTextSearch } from "@/lib/text-search";

async function computeFileHash(file: File): Promise<string> {
  const chunk = file.slice(0, 65536);
  const buffer = await chunk.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Walk the markdown source line-by-line and build a nested heading
 * hierarchy (H1 → H2 → H3). Page index is always 0, the viewer
 * scrolls by heading id instead.
 */
export function parseMarkdownHeadings(markdown: string): TocItem[] {
  const headingRegex = /^(#{1,6})\s+(.+?)\s*$/gm;
  const flat: { level: number; title: string }[] = [];
  for (const m of markdown.matchAll(headingRegex)) {
    flat.push({ level: m[1].length, title: m[2].trim() });
  }
  if (flat.length === 0) return [];

  // Build a nested tree by tracking a stack of parents per level.
  const root: TocItem[] = [];
  const stack: { level: number; node: TocItem }[] = [];
  for (const entry of flat) {
    const node: TocItem = {
      title: entry.title,
      pageIndex: 0,
      children: [],
    };
    while (stack.length > 0 && stack[stack.length - 1].level >= entry.level) {
      stack.pop();
    }
    if (stack.length === 0) {
      root.push(node);
    } else {
      stack[stack.length - 1].node.children.push(node);
    }
    stack.push({ level: entry.level, node });
  }
  return root;
}

export function createTextAdapter(
  format: "text" | "markdown",
): DocumentAdapter {
  let content = "";
  let id = "";
  let title = "";
  let objectUrl: string | null = null;
  const subscribers = new Set<() => void>();

  return {
    async load(file: File): Promise<DocumentMeta> {
      content = await file.text();
      id = await computeFileHash(file);
      title = file.name.replace(/\.(md|markdown|txt)$/i, "");
      objectUrl = URL.createObjectURL(file);
      return {
        id,
        title,
        author: "Unknown",
        format,
        totalPages: 1,
        fileUrl: objectUrl,
        capabilities: {
          paginated: false,
          editable: true,
          searchable: true,
        },
      };
    },

    async extractToc(): Promise<TocItem[]> {
      if (format !== "markdown") return [];
      return parseMarkdownHeadings(content);
    },

    async getContent(): Promise<string> {
      return content;
    },

    async setContent(next: string): Promise<void> {
      content = next;
      for (const fn of subscribers) fn();
    },

    subscribeContent(fn: () => void): () => void {
      subscribers.add(fn);
      return () => {
        subscribers.delete(fn);
      };
    },

    async search(
      query: string,
      opts: SearchOptions,
    ): Promise<SearchMatch[]> {
      return runTextSearch(content, query, opts);
    },

    dispose() {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = null;
      }
      subscribers.clear();
    },
  };
}
