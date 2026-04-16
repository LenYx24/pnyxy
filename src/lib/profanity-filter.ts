/**
 * Zero-dependency profanity filter.
 *
 * Design goals:
 * - No runtime dep — we want predictable bundle size and no ESM/CJS surprises.
 * - Catch the obvious stuff, including simple leet-speak (`sh1t`, `a$$hole`).
 * - Err on the side of false positives only for the egregious English words
 *   this list ships with; the curated wordlist is intentionally short. Extend
 *   `PROFANE_WORDS` as moderators identify new offenders.
 *
 * This is NOT a perfect moderation layer — it is a speed bump that blocks
 * casual abuse in display names, shared book metadata, and comments.
 * Server-side moderation (admin review queue) remains the source of truth.
 */

/**
 * Curated list of terms to block. Keep entries lowercase; the matcher
 * handles word-boundary detection and leet-speak normalization.
 * Purposefully conservative — add entries as needed.
 */
const PROFANE_WORDS: readonly string[] = [
  "fuck",
  "shit",
  "bitch",
  "asshole",
  "bastard",
  "cunt",
  "dick",
  "pussy",
  "piss",
  "cock",
  "whore",
  "slut",
  "faggot",
  "nigger",
  "nigga",
  "retard",
  "retarded",
  "motherfucker",
  "douche",
  "wanker",
  "twat",
];

/** Common leet-speak substitutions. Keys are lowercased input chars. */
const LEET_MAP: Record<string, string> = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "@": "a",
  $: "s",
  "!": "i",
};

/**
 * Normalize a string for profanity matching: lowercase, map leet chars,
 * and drop everything that isn't a letter so inserted punctuation doesn't
 * mask matches (e.g. `s.h.i.t` → `shit`).
 */
function normalize(text: string): string {
  let out = "";
  for (const ch of text.toLowerCase()) {
    const mapped = LEET_MAP[ch] ?? ch;
    if (mapped >= "a" && mapped <= "z") out += mapped;
  }
  return out;
}

/**
 * True when `text` contains any word from the profanity list (after
 * normalizing leet speak and stripping non-letters). Word boundaries are
 * approximated by scanning the normalized string for each word as a
 * substring — since we already stripped punctuation, this matches embedded
 * forms like "youareshit" as well as standalone "shit".
 */
export function containsProfanity(text: string | null | undefined): boolean {
  if (!text) return false;
  const normalized = normalize(text);
  if (!normalized) return false;
  for (const word of PROFANE_WORDS) {
    if (normalized.includes(word)) return true;
  }
  return false;
}

/**
 * Replace letters inside profane substrings with `*` while preserving
 * surrounding casing/punctuation. Used as a last-resort sanitizer when
 * we can't block submission (e.g. imported metadata from a public URL).
 *
 * The algorithm walks the original string alongside a normalized index
 * map so we can zero out the matched ranges in the original positions.
 */
export function cleanUserText(text: string | null | undefined): string {
  if (!text) return text ?? "";
  // Build mapping: for each char in original, normalized letter or "".
  const originalChars = [...text];
  const mappedPositions: number[] = []; // indices in `originalChars` that produced a letter in `normalized`
  let normalized = "";
  for (let i = 0; i < originalChars.length; i++) {
    const ch = originalChars[i].toLowerCase();
    const mapped = LEET_MAP[ch] ?? ch;
    if (mapped >= "a" && mapped <= "z") {
      normalized += mapped;
      mappedPositions.push(i);
    }
  }
  if (!normalized) return text;

  // Find all match ranges in the normalized string, then project them back.
  const toMask = new Set<number>();
  for (const word of PROFANE_WORDS) {
    let start = normalized.indexOf(word);
    while (start !== -1) {
      for (let k = 0; k < word.length; k++) {
        toMask.add(mappedPositions[start + k]);
      }
      start = normalized.indexOf(word, start + 1);
    }
  }

  if (toMask.size === 0) return text;
  return originalChars
    .map((ch, i) => (toMask.has(i) ? "*" : ch))
    .join("");
}
