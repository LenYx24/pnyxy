// Picks the thinking depth per turn so the user never has to switch a
// mode on. Gemini already scales its thinking inside a level; this only
// decides whether a turn gets the deeper level, from the latest user
// message: long multi-part tasks, maths, code, optimisation or proof
// style requests think more, everything else stays quick.

const DEEP_KEYWORDS = [
  // hu
  "számol", "számít", "kiszámol", "optimális", "optimaliz", "bizonyít",
  "levezet", "lépésről lépésre", "validál", "ellenőrizd", "hasonlítsd össze",
  "elemezd", "tervezd meg", "algoritmus", "egyenlet", "integrál", "derivál",
  "valószínűség", "mátrix",
  // en
  "calculate", "compute", "optimal", "optimi", "prove", "proof", "derive",
  "step by step", "validate", "compare", "analyse", "analyze", "design a",
  "algorithm", "equation", "integral", "derivative", "probability", "matrix",
];

const LONG_MESSAGE_CHARS = 600;

export function wantsDeepThinking(text: string): boolean {
  const t = text.toLowerCase();
  if (t.length >= LONG_MESSAGE_CHARS) return true;
  if (t.includes("```")) return true;
  if (/[=∑∫√≤≥]|\d\s*[*/^]\s*\d|\$[^$]+\$/.test(t)) return true;
  return DEEP_KEYWORDS.some((k) => t.includes(k));
}
