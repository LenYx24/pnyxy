import { searchBooks, mapDocToCatalogBook, getWorkDetails } from "@/lib/open-library";
import type { BookProvider, ProviderSearchResult } from "./types";

export const openLibraryProvider: BookProvider = {
  id: "open_library",
  name: "Open Library",

  async search(query, page = 1, limit = 10): Promise<ProviderSearchResult> {
    const result = await searchBooks(query, page, limit);

    const books = await Promise.all(
      result.docs.map(async (doc) => {
        let workDetails;
        try {
          workDetails = await getWorkDetails(doc.key);
        } catch {
          // description will be null
        }

        const mapped = mapDocToCatalogBook(doc, workDetails);
        return {
          ...mapped,
          downloadable: doc.ebook_access === "public",
        };
      }),
    );

    return { books, total: result.numFound };
  },
};
