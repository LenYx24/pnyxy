import { useBrowseStore } from "@/stores/browse-store";
import { useBook } from "./BookPageContext";

/**
 * Whether the current book counts as being in the user's library.
 *
 * Uploaded books are inherently the user's own, so they're always
 * "in library". A catalog book only counts once the user has added it
 * (tracked in browse-store.userLibraryIds). Library-only actions —
 * generating quizzes/whiteboards/exams, picking a reading status —
 * gate on this so they aren't available for a catalog book the user
 * is merely previewing.
 */
export function useIsBookInLibrary(): boolean {
  const data = useBook();
  const userLibraryIds = useBrowseStore((s) => s.userLibraryIds);
  if (data.source === "uploaded") return true;
  return userLibraryIds.has(data.book.id);
}
