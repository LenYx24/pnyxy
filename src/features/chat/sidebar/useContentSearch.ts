import { useEffect, useRef, useState } from "react";
import {
  searchConversationContent,
  type ContentSearchHit,
} from "@/stores/chat/chat-content-search";

/** Typing pause before the search leaves the browser. */
const DEBOUNCE_MS = 350;
/** Below this a full-text search matches half the library; let the title
 *  filter handle it until there's enough to go on. */
const MIN_QUERY_LENGTH = 3;

export interface ContentSearchState {
  /** Conversation ids whose messages matched, empty while idle. */
  hits: Map<string, ContentSearchHit>;
  searching: boolean;
  /** True once the database answered "no such function": the toggle hides
   *  itself rather than failing on every keystroke. */
  unavailable: boolean;
}

/**
 * Debounced message-content search for the sidebar. Off (and idle) unless
 * `enabled`, so the default sidebar keeps costing nothing.
 */
export function useContentSearch(
  query: string,
  enabled: boolean,
): ContentSearchState {
  const [state, setState] = useState<ContentSearchState>({
    hits: new Map(),
    searching: false,
    unavailable: false,
  });
  // newest query wins: a slow response must not overwrite a newer one
  const seqRef = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();
    if (!enabled || trimmed.length < MIN_QUERY_LENGTH) {
      seqRef.current += 1;
      setState((s) =>
        s.hits.size === 0 && !s.searching
          ? s
          : { ...s, hits: new Map(), searching: false },
      );
      return;
    }
    const seq = ++seqRef.current;
    setState((s) => ({ ...s, searching: true }));
    const timer = window.setTimeout(async () => {
      const result = await searchConversationContent(trimmed);
      if (seq !== seqRef.current) return;
      if (result.status === "ok") {
        setState({
          hits: new Map(result.hits.map((h) => [h.conversationId, h])),
          searching: false,
          unavailable: false,
        });
      } else {
        setState({
          hits: new Map(),
          searching: false,
          unavailable: result.status === "unavailable",
        });
      }
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query, enabled]);

  return state;
}
