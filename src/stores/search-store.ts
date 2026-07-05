import { create } from "zustand";
import type { SearchMatch, SearchOptions } from "@/types/document";
import { useReaderStore } from "@/stores/reader-store";
import { buildSearchRegex } from "@/lib/text-search";

export type SearchMode = "find" | "replace";

interface SearchState {
  isOpen: boolean;
  mode: SearchMode;
  query: string;
  replacement: string;
  options: SearchOptions;
  matches: SearchMatch[];
  /** -1 when there are no matches yet (or the query is empty). */
  currentIdx: number;
  isSearching: boolean;
  error: string | null;

  open(mode?: SearchMode): void;
  close(): void;
  setMode(mode: SearchMode): void;
  setQuery(query: string): void;
  setReplacement(replacement: string): void;
  setOptions(patch: Partial<SearchOptions>): void;
  next(): void;
  prev(): void;
  search(): Promise<void>;
  replaceCurrent(): Promise<void>;
  replaceAll(): Promise<void>;
}

const QUERY_DEBOUNCE_MS = 200;
let debounceHandle: ReturnType<typeof setTimeout> | null = null;
let currentSearchToken = 0;

function readActiveDoc() {
  return useReaderStore.getState().getActiveDoc();
}

function isActiveDocEditable(): boolean {
  const doc = readActiveDoc();
  return !!doc?.meta.capabilities.editable;
}

function scrollToMatch(match: SearchMatch | undefined): void {
  if (!match) return;
  const doc = readActiveDoc();
  if (!doc) return;
  if (doc.meta.capabilities.paginated && match.pageNum !== undefined) {
    useReaderStore.getState().requestScrollToPage(match.pageNum);
  }
  // For non-paginated formats the viewer handles scrolling via
  // mark[data-current] in response to `currentIdx` changing.
}

export const useSearchStore = create<SearchState>((set, get) => ({
  isOpen: false,
  mode: "find",
  query: "",
  replacement: "",
  options: { caseSensitive: false, wholeWord: false, regex: false },
  matches: [],
  currentIdx: -1,
  isSearching: false,
  error: null,

  open(mode = "find") {
    const requested: SearchMode =
      mode === "replace" && !isActiveDocEditable() ? "find" : mode;
    set({ isOpen: true, mode: requested });
  },

  close() {
    if (debounceHandle) {
      clearTimeout(debounceHandle);
      debounceHandle = null;
    }
    set({
      isOpen: false,
      matches: [],
      currentIdx: -1,
      error: null,
      isSearching: false,
    });
  },

  setMode(mode) {
    const requested: SearchMode =
      mode === "replace" && !isActiveDocEditable() ? "find" : mode;
    set({ mode: requested });
  },

  setQuery(query) {
    set({ query });
    if (debounceHandle) clearTimeout(debounceHandle);
    if (!query) {
      set({ matches: [], currentIdx: -1, error: null, isSearching: false });
      return;
    }
    debounceHandle = setTimeout(() => {
      void get().search();
    }, QUERY_DEBOUNCE_MS);
  },

  setReplacement(replacement) {
    set({ replacement });
  },

  setOptions(patch) {
    set((s) => ({ options: { ...s.options, ...patch } }));
    // Re-run the search immediately, toggles should feel instant.
    void get().search();
  },

  next() {
    const { matches, currentIdx } = get();
    if (matches.length === 0) return;
    const nextIdx = (currentIdx + 1) % matches.length;
    set({ currentIdx: nextIdx });
    scrollToMatch(matches[nextIdx]);
  },

  prev() {
    const { matches, currentIdx } = get();
    if (matches.length === 0) return;
    const prevIdx = currentIdx <= 0 ? matches.length - 1 : currentIdx - 1;
    set({ currentIdx: prevIdx });
    scrollToMatch(matches[prevIdx]);
  },

  async search() {
    // Validate the query's regex up-front so we can surface a visible error.
    const { query, options } = get();
    if (!query) {
      set({ matches: [], currentIdx: -1, error: null, isSearching: false });
      return;
    }
    const regex = buildSearchRegex(query, options);
    if (!regex) {
      set({
        matches: [],
        currentIdx: -1,
        error: options.regex
          ? "Invalid regular expression"
          : "Invalid search query",
        isSearching: false,
      });
      return;
    }

    const doc = readActiveDoc();
    if (!doc?.adapter.search) {
      set({ matches: [], currentIdx: -1, error: null, isSearching: false });
      return;
    }

    const token = ++currentSearchToken;
    set({ isSearching: true, error: null });
    try {
      const matches = await doc.adapter.search(query, options);
      if (token !== currentSearchToken) return; // another search superseded us
      const next = matches.length > 0 ? 0 : -1;
      set({ matches, currentIdx: next, isSearching: false });
      if (next === 0) scrollToMatch(matches[0]);
    } catch (err) {
      if (token !== currentSearchToken) return;
      set({
        matches: [],
        currentIdx: -1,
        error: err instanceof Error ? err.message : "Search failed",
        isSearching: false,
      });
    }
  },

  async replaceCurrent() {
    const doc = readActiveDoc();
    if (!doc || !doc.meta.capabilities.editable) return;
    if (!doc.adapter.getContent || !doc.adapter.setContent) return;

    const { matches, currentIdx, replacement, query, options } = get();
    if (currentIdx < 0 || currentIdx >= matches.length) return;
    const current = matches[currentIdx];
    if (current.sourceOffset === undefined) return;

    const content = await doc.adapter.getContent();
    // Find the match bounds from the source offset, matchAll is the
    // source of truth, but we already have the offset so use it.
    const regex = buildSearchRegex(query, options);
    if (!regex) return;
    // Re-locate the match so we replace exactly the substring the
    // regex matched (its length may differ from `replacement`).
    const nodeRegex = new RegExp(regex.source, regex.flags);
    nodeRegex.lastIndex = current.sourceOffset;
    const m = nodeRegex.exec(content);
    if (!m || m.index !== current.sourceOffset) return;
    const matchedLength = m[0].length;

    const nextContent =
      content.slice(0, current.sourceOffset) +
      replacement +
      content.slice(current.sourceOffset + matchedLength);

    // Anchor so that after re-searching we land on the next match
    // (the one that was immediately after the one we just replaced).
    const anchorOffset =
      current.sourceOffset + replacement.length;

    await doc.adapter.setContent(nextContent);
    await get().search();

    const refreshed = get().matches;
    if (refreshed.length === 0) {
      set({ currentIdx: -1 });
      return;
    }
    // Pick the first match at or after the anchor (wrap to 0 if none).
    const idx = refreshed.findIndex(
      (mm) => (mm.sourceOffset ?? 0) >= anchorOffset,
    );
    const target = idx === -1 ? 0 : idx;
    set({ currentIdx: target });
    scrollToMatch(refreshed[target]);
  },

  async replaceAll() {
    const doc = readActiveDoc();
    if (!doc || !doc.meta.capabilities.editable) return;
    if (!doc.adapter.getContent || !doc.adapter.setContent) return;
    const { query, options, replacement } = get();
    const regex = buildSearchRegex(query, options);
    if (!regex) return;

    const content = await doc.adapter.getContent();
    const next = content.replace(regex, replacement);
    await doc.adapter.setContent(next);
    set({ matches: [], currentIdx: -1 });
  },
}));
