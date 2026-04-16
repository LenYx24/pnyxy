import type { SearchMatch, SearchOptions } from "@/types/document";

const SNIPPET_CONTEXT = 60;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build a global RegExp from a search query + options.
 * Returns `null` for an empty query or an invalid user-provided regex.
 */
export function buildSearchRegex(
  query: string,
  opts: SearchOptions,
): RegExp | null {
  if (!query) return null;
  let pattern = opts.regex ? query : escapeRegExp(query);
  if (opts.wholeWord) pattern = `\\b(?:${pattern})\\b`;
  try {
    return new RegExp(pattern, opts.caseSensitive ? "g" : "gi");
  } catch {
    return null;
  }
}

/**
 * Run a search over an in-memory text string. Used by the text adapter
 * and by the EPUB adapter when walking spine items. Matches are tagged
 * with `sourceOffset` so the overlay can navigate editable documents.
 */
export function runTextSearch(
  text: string,
  query: string,
  opts: SearchOptions,
): SearchMatch[] {
  const regex = buildSearchRegex(query, opts);
  if (!regex) return [];

  const matches: SearchMatch[] = [];
  let seq = 0;
  for (const m of text.matchAll(regex)) {
    if (m.index === undefined) continue;
    const matchStart = m.index;
    const matchEnd = matchStart + m[0].length;
    // Skip zero-width matches so `replaceAll` doesn't loop forever.
    if (matchEnd === matchStart) continue;

    const snippetStart = Math.max(0, matchStart - SNIPPET_CONTEXT);
    const snippetEnd = Math.min(text.length, matchEnd + SNIPPET_CONTEXT);
    const snippet =
      (snippetStart > 0 ? "…" : "") +
      text.slice(snippetStart, snippetEnd) +
      (snippetEnd < text.length ? "…" : "");

    matches.push({
      id: `text:${seq++}`,
      sourceOffset: matchStart,
      snippet,
      snippetMatchStart:
        matchStart - snippetStart + (snippetStart > 0 ? 1 : 0),
      snippetMatchEnd:
        matchEnd - snippetStart + (snippetStart > 0 ? 1 : 0),
    });
  }
  return matches;
}
