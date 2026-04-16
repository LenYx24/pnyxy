import type { BookStatusTag } from "./database";

// ── Catalog book (shared public catalog) ────────────────────

export type CatalogSource = "open_library" | "google_books" | "user_submitted";
export type CatalogStatus = "pending" | "verified" | "rejected";

export interface CatalogBook {
  id: string;
  title: string;
  authors: string[];
  description: string | null;
  cover_url: string | null;
  isbn_10: string | null;
  isbn_13: string | null;
  publisher: string | null;
  published_date: string | null;
  page_count: number | null;
  language: string | null;
  categories: string[];
  source: CatalogSource;
  source_id: string | null;
  ia_id: string | null;
  download_url: string | null;
  submitted_by: string | null;
  status: CatalogStatus;
  verified_at: string | null;
  verified_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CatalogBookInsert {
  title: string;
  authors: string[];
  description?: string | null;
  cover_url?: string | null;
  isbn_10?: string | null;
  isbn_13?: string | null;
  publisher?: string | null;
  published_date?: string | null;
  page_count?: number | null;
  language?: string | null;
  categories?: string[];
  source?: CatalogSource;
  source_id?: string | null;
  ia_id?: string | null;
  download_url?: string | null;
}

// ── User library junction ───────────────────────────────────

export interface UserLibraryEntry {
  id: string;
  user_id: string;
  catalog_book_id: string;
  folder_id: string | null;
  added_at: string;
}

export interface LibraryBookEntry {
  id: string;
  catalog_book_id: string;
  folder_id: string | null;
  added_at: string;
  catalog_book: CatalogBook;
}

// ── Unified library items (discriminated union) ─────────────

export interface CatalogLibraryItem {
  source: "catalog";
  id: string;           // user_library row id
  folder_id: string | null;
  added_at: string;
  catalog_book_id: string;
  catalog_book: CatalogBook;
  tags?: BookStatusTag[];
}

export interface UploadedLibraryItem {
  source: "uploaded";
  id: string;           // books row id
  folder_id: string | null;
  added_at: string;     // books.created_at
  tags?: BookStatusTag[];
  book: {
    id: string;
    title: string;
    author: string | null;
    cover_url: string | null;
    page_count: number | null;
    format: string;
    file_hash: string | null;
    storage_path: string;
    size_bytes: number | null;
    file_name: string;
  };
}

export type UnifiedLibraryItem = CatalogLibraryItem | UploadedLibraryItem;

// ── Download types ──────────────────────────────────────────

export type DownloadFormat = "pdf" | "epub" | "txt";

export interface DownloadOption {
  format: DownloadFormat;
  url: string;
  label: string;
}

// ── Open Library API response types ─────────────────────────

export type EbookAccess = "public" | "borrowable" | "printdisabled" | "no_ebook";

export interface OpenLibrarySearchDoc {
  key: string; // e.g. "/works/OL123W"
  title: string;
  author_name?: string[];
  first_publish_year?: number;
  isbn?: string[];
  publisher?: string[];
  number_of_pages_median?: number;
  subject?: string[];
  cover_i?: number; // cover ID for building URL
  language?: string[];
  ebook_access?: EbookAccess;
  public_scan_b?: boolean;
  ia?: string[];
}

export interface OpenLibrarySearchResult {
  numFound: number;
  start: number;
  docs: OpenLibrarySearchDoc[];
}

export interface OpenLibraryWork {
  key: string;
  title: string;
  description?: string | { value: string };
  covers?: number[];
  subjects?: string[];
}
