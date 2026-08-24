import { useBook } from "../BookPageContext";
import { ReadingSessionCard } from "../ReadingSessionCard";

/** Reading-session tracker on its own book-page tab (moved out of the
 *  Overview to keep that page lean). */
export function ReadingTab() {
  const data = useBook();
  // docId matches what the reader / resume-state use for this book
  const docId = data.book.id;
  const pageCount = data.book.page_count ?? null;
  return (
    <div className="max-w-2xl">
      <ReadingSessionCard docId={docId} pageCount={pageCount} />
    </div>
  );
}
