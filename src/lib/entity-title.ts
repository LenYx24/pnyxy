/**
 * Shared display-title logic for user-created entities (notes,
 * whiteboards, quizzes, roadmaps).
 *
 * The problem this solves: the library filetree used to fill up with a
 * dozen identical "Untitled whiteboard" / "Untitled note" rows because
 * every new entity got the same static placeholder. Two strategies here,
 * picked per entity:
 *
 *  - Content-bearing entities (note, whiteboard) derive a *live* display
 *    title from their content — the first line of a note, the first text
 *    element on a whiteboard — so the name reflects what's inside without
 *    the user having to type anything. When there's no content yet we
 *    fall back to a date-stamped label, which is at least unique.
 *
 *  - Content-less but renamable entities (quiz, roadmap) instead persist
 *    a date-stamped default at creation time (see `datedDefaultTitle`),
 *    so the many bare `{entity.title}` render sites keep working and the
 *    user's own rename always wins.
 *
 * The date-stamp is deliberately minute-precision so two entities made
 * seconds apart still differ. Locale + word come from i18n
 * (`library.allBooks.derivedTitle.*`); the date itself is formatted with
 * the runtime locale via Intl.
 */

import type { TFunction } from "i18next";

export type DerivedTitleKind =
  | "note"
  | "whiteboard"
  | "quiz"
  | "roadmap"
  | "chat";

const MAX_LEN = 60;

/** Runtime-locale short date + time, e.g. "Jul 1, 14:30". */
function formatStamp(ts: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ts));
}

/**
 * A unique, human-readable default like "Whiteboard · Jul 1, 14:30".
 * Used both as the content-less fallback below and as the persisted
 * default for quizzes/roadmaps at creation time.
 */
export function datedDefaultTitle(
  t: TFunction,
  kind: DerivedTitleKind,
  ts: number = Date.now(),
): string {
  return t(`library.allBooks.derivedTitle.${kind}`, { date: formatStamp(ts) });
}

/**
 * Extract the first meaningful line of Markdown as a plain-text title,
 * stripping the common leading/inline syntax so "# My heading" becomes
 * "My heading" and "- [ ] todo" becomes "todo". Returns "" if the note
 * body has no textual line.
 */
function firstMarkdownLine(markdown: string): string {
  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine
      .replace(/^\s{0,3}#{1,6}\s+/, "") // ATX headings
      .replace(/^\s{0,3}>\s?/, "") // blockquote marker
      .replace(/^\s{0,3}[-*+]\s+\[[ xX]\]\s+/, "") // task-list item
      .replace(/^\s{0,3}[-*+]\s+/, "") // bullet list
      .replace(/^\s{0,3}\d+[.)]\s+/, "") // ordered list
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // images → drop
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links → link text
      .replace(/[*_`~]/g, "") // emphasis / code / strikethrough marks
      .trim();
    if (line) return line.slice(0, MAX_LEN);
  }
  return "";
}

/**
 * Display title for a note: the user's explicit title, else the first
 * line of its Markdown body, else a date-stamped default.
 */
export function noteDisplayTitle(
  note: { title: string; content: string; createdAt: number },
  t: TFunction,
): string {
  const explicit = note.title.trim();
  if (explicit) return explicit;
  const derived = firstMarkdownLine(note.content);
  if (derived) return derived;
  return datedDefaultTitle(t, "note", note.createdAt);
}

/**
 * Display title for a whiteboard: the user's explicit title, else the
 * text of the first text element on the canvas, else a date-stamped
 * default. (Whiteboards have no rename UI, so the stored title is
 * normally empty and the derived name is what the user sees.)
 */
export function whiteboardDisplayTitle(
  wb: {
    title: string;
    elements: ReadonlyArray<{ type: string; text?: string }>;
    createdAt: number;
  },
  t: TFunction,
): string {
  const explicit = wb.title.trim();
  if (explicit) return explicit;
  const firstText = wb.elements.find(
    (el) => el.type === "text" && !!el.text?.trim(),
  )?.text;
  if (firstText) {
    const oneLine = firstText.split(/\r?\n/)[0]?.trim() ?? "";
    if (oneLine) return oneLine.slice(0, MAX_LEN);
  }
  return datedDefaultTitle(t, "whiteboard", wb.createdAt);
}

/**
 * Display title for a chat conversation. Conversations normally get an
 * LLM-generated title from their first message, so this only matters for
 * empty or auto-title-failed threads: the user's/LLM title if present,
 * else a date-stamped default so identical "Untitled chat" rows don't
 * pile up in the library. `created_at` is an ISO string on the row.
 */
export function conversationDisplayTitle(
  conversation: { title: string; created_at: string },
  t: TFunction,
): string {
  const explicit = conversation.title.trim();
  if (explicit) return explicit;
  const ts = Date.parse(conversation.created_at);
  return datedDefaultTitle(t, "chat", Number.isNaN(ts) ? Date.now() : ts);
}
