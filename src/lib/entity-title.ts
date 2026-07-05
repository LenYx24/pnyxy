/**
 * Display-title logic for user-created entities (notes, whiteboards,
 * quizzes, roadmaps, chats).
 *
 * Two strategies: content-bearing entities (note, whiteboard) derive a
 * live title from their content and fall back to a date stamp; content-less
 * renamable ones (quiz, roadmap) persist a date-stamped default at creation.
 * Minute-precision stamp so entities made seconds apart still differ.
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

/** Unique default like "Whiteboard · Jul 1, 14:30". */
export function datedDefaultTitle(
  t: TFunction,
  kind: DerivedTitleKind,
  ts: number = Date.now(),
): string {
  return t(`library.allBooks.derivedTitle.${kind}`, { date: formatStamp(ts) });
}

/** First meaningful markdown line as plain text, syntax stripped. "" if none. */
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

/** Note title: explicit title, else first markdown line, else date stamp. */
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
 * Whiteboard title: explicit title, else first text element, else date stamp.
 * Whiteboards have no rename UI so the stored title is normally empty.
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
 * Chat title: stored title if present, else date stamp. Only bites for empty
 * or auto-title-failed threads. `created_at` is an ISO string on the row.
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
