export type DocumentFormat = "pdf" | "epub";

export interface DocumentMeta {
  id: string;
  title: string;
  author: string;
  format: DocumentFormat;
  totalPages: number;
  fileUrl: string;
}

export interface TocItem {
  title: string;
  pageIndex: number;
  children: TocItem[];
}

export interface DocumentAdapter {
  load(file: File): Promise<DocumentMeta>;
  extractToc(): Promise<TocItem[]>;
  dispose(): void;
}
