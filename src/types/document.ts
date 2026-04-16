export type DocumentFormat = "pdf" | "epub" | "markdown" | "text";

export interface DocumentCapabilities {
  /** Content is laid out in discrete pages (PDF). */
  paginated: boolean;
  /** Content source can be edited / replaced via `setContent`. */
  editable: boolean;
  /** Adapter implements `search()`. */
  searchable: boolean;
}

export interface DocumentMeta {
  id: string;
  title: string;
  author: string;
  format: DocumentFormat;
  /** 1 for non-paginated (flow) formats. */
  totalPages: number;
  fileUrl: string;
  capabilities: DocumentCapabilities;
}

export interface TocItem {
  title: string;
  pageIndex: number;
  children: TocItem[];
}

export interface SearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

/** Rectangle relative to a PDF page, fraction coordinates (0-1). */
export interface PageRect {
  pageNum: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SearchMatch {
  id: string;
  /** Set for paginated formats (PDF). */
  pageNum?: number;
  /** Offset into editable source text (TXT / MD). */
  sourceOffset?: number;
  /** Chapter/section href for EPUB. */
  spineHref?: string;
  /** Short snippet for display in lists / tooltips. */
  snippet: string;
  snippetMatchStart: number;
  snippetMatchEnd: number;
  /** PDF-only: rects the highlight layer paints on the page. */
  rects?: PageRect[];
}

export interface DocumentAdapter {
  load(file: File): Promise<DocumentMeta>;
  extractToc(): Promise<TocItem[]>;
  dispose(): void;
  /** Present only on editable formats. Returns the current source text. */
  getContent?(): Promise<string>;
  /** Present only on editable formats. Replaces the source text. */
  setContent?(next: string): Promise<void>;
  /** Present on searchable formats. Returns an ordered list of matches. */
  search?(query: string, opts: SearchOptions): Promise<SearchMatch[]>;
  /** Present on editable formats. Notifies subscribers after `setContent`. */
  subscribeContent?(fn: () => void): () => void;
}
