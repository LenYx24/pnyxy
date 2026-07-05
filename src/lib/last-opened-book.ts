// Remembers the last book opened in the reader, per device. The reader
// store is in-memory only (empties on reload), so without this a page
// refresh or a fresh visit shows a bare "no book open" screen even though
// the user was mid-read. We persist just enough to re-resolve the book from
// the library and re-open it; the page position itself is restored
// separately from the cross-device `book_resume_state` table, so opening
// the remembered book continues where any device left off.

export interface LastOpenedBook {
  /** "uploaded" = the user's own file; "catalog" = a public catalog book. */
  source: "uploaded" | "catalog";
  /** Library entry id (uploaded) or catalog book id — used to re-resolve. */
  id: string;
  title: string;
}

const KEY = "pnyxy:last-opened-book";

export function saveLastOpenedBook(book: LastOpenedBook): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(book));
  } catch {
    // private mode / quota — remembering the last book is best-effort
  }
}

export function loadLastOpenedBook(): LastOpenedBook | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      ((parsed as LastOpenedBook).source === "uploaded" ||
        (parsed as LastOpenedBook).source === "catalog") &&
      typeof (parsed as LastOpenedBook).id === "string" &&
      typeof (parsed as LastOpenedBook).title === "string"
    ) {
      return parsed as LastOpenedBook;
    }
  } catch {
    // corrupt value — treat as "nothing remembered"
  }
  return null;
}

export function clearLastOpenedBook(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
