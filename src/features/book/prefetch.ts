// Warm the lazy book-page route chunks (BookPage + its default
// OverviewTab) on hover/press intent so navigating to a book doesn't
// wait on a JS chunk fetch. Dynamic import() is cached, and the flag
// makes it a one-time cost after the first hover anywhere.
let done = false;

export function prefetchBookPage(): void {
  if (done) return;
  done = true;
  void import("@/features/book/BookPage");
  void import("@/features/book/tabs/OverviewTab");
}
