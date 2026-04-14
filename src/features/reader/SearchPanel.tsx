import { useCallback, useEffect, useRef } from "react";
import { Search, Loader2 } from "lucide-react";
import { useSearchStore } from "@/stores/search-store";
import { useReaderStore, useActiveDocument } from "@/stores/reader-store";
import type { IDockviewPanelProps } from "dockview";

function SearchPanelContent() {
  const query = useSearchStore((s) => s.query);
  const results = useSearchStore((s) => s.results);
  const isSearching = useSearchStore((s) => s.isSearching);
  const totalMatches = useSearchStore((s) => s.totalMatches);
  const setQuery = useSearchStore((s) => s.setQuery);
  const search = useSearchStore((s) => s.search);
  const clearResults = useSearchStore((s) => s.clearResults);

  const activeDoc = useActiveDocument();
  const goToPage = useReaderStore((s) => s.goToPage);

  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Clean up on unmount
  useEffect(() => {
    return () => clearResults();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleQueryChange = useCallback(
    (value: string) => {
      setQuery(value);
      clearTimeout(debounceRef.current);

      if (value.length < 2) {
        clearResults();
        return;
      }

      debounceRef.current = setTimeout(() => {
        if (activeDoc?.meta?.fileUrl && activeDoc.totalPages > 0) {
          search(activeDoc.meta.fileUrl, activeDoc.totalPages);
        }
      }, 300);
    },
    [activeDoc, setQuery, search, clearResults],
  );

  // Group results by page
  const groupedResults = results.reduce<
    Map<number, typeof results>
  >((map, result) => {
    const existing = map.get(result.pageNum) || [];
    existing.push(result);
    map.set(result.pageNum, existing);
    return map;
  }, new Map());

  const sortedGroups = Array.from(groupedResults.entries()).sort(
    ([a], [b]) => a - b,
  );

  return (
    <div className="h-full flex flex-col bg-bg-secondary/50">
      {/* Search input */}
      <div className="p-3 border-b border-glass-border">
        <div className="relative">
          <Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted"
          />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            placeholder="Search in document..."
            className="w-full rounded-md border border-glass-border bg-glass-bg pl-8 pr-3 py-1.5 text-sm text-text-primary outline-none focus:border-accent-purple placeholder:text-text-muted"
          />
        </div>
        {query.length >= 2 && !isSearching && (
          <p className="mt-1.5 text-xs text-text-muted">
            {totalMatches} match{totalMatches !== 1 ? "es" : ""} found
          </p>
        )}
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {isSearching && (
          <div className="flex items-center justify-center gap-2 py-8 text-text-secondary">
            <Loader2 size={16} className="animate-spin" />
            <span className="text-sm">Searching...</span>
          </div>
        )}

        {!isSearching && query.length >= 2 && totalMatches === 0 && (
          <p className="px-3 py-8 text-center text-sm text-text-muted">
            No results found
          </p>
        )}

        {!isSearching &&
          sortedGroups.map(([pageNum, pageResults]) => (
            <div key={pageNum}>
              <div className="sticky top-0 bg-bg-secondary/90 backdrop-blur-sm px-3 py-1.5 border-b border-glass-border">
                <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                  Page {pageNum}
                </span>
              </div>
              <div className="p-1 space-y-0.5">
                {pageResults.map((result, idx) => (
                  <button
                    key={idx}
                    onClick={() => goToPage(result.pageNum)}
                    className="block w-full rounded-md px-3 py-2 text-left text-sm text-text-secondary hover:bg-glass-hover hover:text-text-primary transition-colors cursor-pointer"
                  >
                    <span>
                      {result.text.slice(0, result.matchStart)}
                      <mark className="bg-accent-purple/30 text-text-primary rounded-sm px-0.5">
                        {result.text.slice(result.matchStart, result.matchEnd)}
                      </mark>
                      {result.text.slice(result.matchEnd)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}

export function SearchPanel(_props: IDockviewPanelProps) {
  return <SearchPanelContent />;
}
