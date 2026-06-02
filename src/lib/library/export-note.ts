import type { Note } from "@/stores/note-store";

/**
 * Serialize a note to a portable Markdown document.
 *
 * The note's body is already Markdown, so the only thing we add is an
 * H1 title header when the note has a title. This keeps the export
 * round-trippable and openable in any text editor — the anti-vendor-
 * lock-in goal: a note is just a `.md` file the user fully owns.
 */
export function noteToMarkdown(note: Pick<Note, "title" | "content">): string {
  const title = note.title.trim();
  const body = note.content ?? "";
  if (!title) return body;
  // One blank line between the title and the body so the H1 renders as
  // its own block rather than running into the first paragraph.
  return body ? `# ${title}\n\n${body}\n` : `# ${title}\n`;
}

/** Filesystem-safe filename stem from a note title (falls back to id). */
function noteFileStem(note: Pick<Note, "id" | "title">): string {
  const base = note.title.trim() || `note-${note.id.slice(0, 8)}`;
  return base
    // Strip characters that are illegal in filenames on common OSes.
    .replace(/[\\/:*?"<>|]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120)
    || `note-${note.id.slice(0, 8)}`;
}

/**
 * Trigger a browser download of the note as a `.md` file. Used by the
 * library card's "Export as Markdown" action so users can pull a note
 * out of the app and edit it locally (e.g. in the desktop app).
 */
export function downloadNoteMarkdown(note: Note): void {
  const md = noteToMarkdown(note);
  const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${noteFileStem(note)}.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the click has a chance to start the
  // download before the object URL is invalidated.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
