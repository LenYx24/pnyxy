import type { CatalogBookInsert } from "@/types/catalog";

/**
 * A book provider is an external source that can be searched for books.
 * Implement this interface to add a new book source to the app.
 *
 * Built-in providers: Open Library
 * Future providers: Google Books, Project Gutenberg, etc.
 */
export interface BookProvider {
  /** Unique identifier, matches CatalogSource when applicable */
  id: string;
  /** Human-readable name shown in the UI */
  name: string;
  /** Search for books by query */
  search(query: string, page?: number, limit?: number): Promise<ProviderSearchResult>;
}

export interface ProviderSearchResult {
  books: ProviderBook[];
  total: number;
}

/** A book result from a provider, extending CatalogBookInsert with download info */
export interface ProviderBook extends CatalogBookInsert {
  /** Whether this book can be legally downloaded for free */
  downloadable: boolean;
}
