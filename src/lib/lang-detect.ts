/**
 * Cheap language heuristic shared by every text-selection lookup
 * surface (annotation context menu's Translate/Wiki/Explain panels,
 * EpubSelectionPopover). The selection text is short and the goal is
 * to pick the *right default*, the user can always override via the
 * panel's language toggle.
 *
 * Returns "hu" when the text contains a character only Hungarian
 * (plus a few Slavic neighbours) uses among the Pnyxy audience's
 * realistic source languages; "en" otherwise. Good enough for the
 * dominant Hungarian-textbook / English-paper split of the audience
 * without a full-blown CLD round trip.
 */
export function detectSourceLang(text: string): string {
  if (/[őűáéíóúöüÁÉÍÓÚŐŰÖÜ]/.test(text)) return "hu";
  return "en";
}
