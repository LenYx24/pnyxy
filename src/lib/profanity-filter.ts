// Zero-dep profanity filter. Just a speed bump for display names/metadata,
// admin review queue is the real moderation layer.

// keep entries lowercase

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

// leet-speak substitutions, keys are lowercased input chars
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

// lowercase, map leet chars, strip non-letters so "s.h.i.t" -> "shit"
function normalize(text: string): string {
  let out = "";
  for (const ch of text.toLowerCase()) {
    const mapped = LEET_MAP[ch] ?? ch;
    if (mapped >= "a" && mapped <= "z") out += mapped;
  }
  return out;
}

// substring match on the normalized text, so "youareshit" matches too
export function containsProfanity(text: string | null | undefined): boolean {
  if (!text) return false;
  const normalized = normalize(text);
  if (!normalized) return false;
  for (const word of PROFANE_WORDS) {
    if (normalized.includes(word)) return true;
  }
  return false;
}

// Mask letters inside profane substrings with `*`, keeping original casing/punctuation.
// Walks the original string next to a normalized index map to project matches back.
export function cleanUserText(text: string | null | undefined): string {
  if (!text) return text ?? "";
  const originalChars = [...text];
  const mappedPositions: number[] = []; // original indices that produced a letter in `normalized`
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
