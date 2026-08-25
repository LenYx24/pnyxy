/**
 * AI context presets: named markdown blocks that are prepended to the
 * system prompt of every AI conversation where they apply. A preset can
 * be the global default and/or bound to a book, a library folder or an
 * organization; `resolve.ts` picks the winner by precedence.
 */

export interface AiContextPreset {
  id: string;
  name: string;
  /** Markdown body, injected as-is into the persona block. */
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface AiContextBindings {
  /** Keyed by the reader doc id: `catalog_books.id` for catalog books,
   *  `books.id` for uploads (see `bookBindingKey`). */
  books: Record<string, string>;
  /** Keyed by library folder id. */
  folders: Record<string, string>;
  /** Keyed by organization id. */
  orgs: Record<string, string>;
}

export type AiContextBindingKind = keyof AiContextBindings;

export const AI_CONTEXT_BINDING_KINDS: readonly AiContextBindingKind[] = [
  "books",
  "folders",
  "orgs",
] as const;

export function emptyAiContextBindings(): AiContextBindings {
  return { books: {}, folders: {}, orgs: {} };
}

export function newAiContextPresetId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `ctx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Soft cap so a preset can't blow the token budget by accident. */
export const AI_CONTEXT_BODY_MAX_CHARS = 8000;
