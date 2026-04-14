import { create } from "zustand";
import { pdfjs } from "react-pdf";

export interface SearchResult {
  pageNum: number;
  text: string;
  matchStart: number;
  matchEnd: number;
}

interface SearchState {
  query: string;
  results: SearchResult[];
  isSearching: boolean;
  totalMatches: number;

  setQuery: (query: string) => void;
  search: (fileUrl: string, totalPages: number) => Promise<void>;
  clearResults: () => void;
}

const SNIPPET_CONTEXT = 60;

export const useSearchStore = create<SearchState>((set, get) => ({
  query: "",
  results: [],
  isSearching: false,
  totalMatches: 0,

  setQuery: (query) => set({ query }),

  search: async (fileUrl, totalPages) => {
    const { query } = get();
    if (!query || query.length < 2) {
      set({ results: [], totalMatches: 0 });
      return;
    }

    set({ isSearching: true, results: [], totalMatches: 0 });

    try {
      const pdf = await pdfjs.getDocument(fileUrl).promise;
      const results: SearchResult[] = [];
      const lowerQuery = query.toLowerCase();

      for (let i = 1; i <= totalPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items
          .map((item) => ("str" in item ? item.str : ""))
          .join(" ");

        const lowerPageText = pageText.toLowerCase();
        let searchFrom = 0;

        while (searchFrom < lowerPageText.length) {
          const idx = lowerPageText.indexOf(lowerQuery, searchFrom);
          if (idx === -1) break;

          const snippetStart = Math.max(0, idx - SNIPPET_CONTEXT);
          const snippetEnd = Math.min(
            pageText.length,
            idx + query.length + SNIPPET_CONTEXT,
          );
          const text = (snippetStart > 0 ? "..." : "") +
            pageText.slice(snippetStart, snippetEnd) +
            (snippetEnd < pageText.length ? "..." : "");

          results.push({
            pageNum: i,
            text,
            matchStart: idx - snippetStart + (snippetStart > 0 ? 3 : 0),
            matchEnd:
              idx - snippetStart + query.length + (snippetStart > 0 ? 3 : 0),
          });

          searchFrom = idx + query.length;
        }

        // Check if query changed while searching
        if (get().query !== query) return;
      }

      set({ results, totalMatches: results.length, isSearching: false });
    } catch {
      set({ isSearching: false });
    }
  },

  clearResults: () => set({ query: "", results: [], totalMatches: 0, isSearching: false }),
}));
