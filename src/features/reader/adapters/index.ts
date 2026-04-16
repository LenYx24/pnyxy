import type { DocumentAdapter, DocumentFormat } from "@/types/document";
import { createPdfAdapter } from "./pdf-adapter";
import { createTextAdapter } from "./text-adapter";
import { createEpubAdapter } from "./epub-adapter";

export function detectFormat(file: File): DocumentFormat {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf") || file.type === "application/pdf") return "pdf";
  if (name.endsWith(".epub") || file.type === "application/epub+zip") {
    return "epub";
  }
  if (name.endsWith(".md") || name.endsWith(".markdown")) return "markdown";
  // Default: treat unknown files as plain text.
  return "text";
}

export function createAdapterForFile(file: File): DocumentAdapter {
  switch (detectFormat(file)) {
    case "pdf":
      return createPdfAdapter();
    case "epub":
      return createEpubAdapter();
    case "markdown":
      return createTextAdapter("markdown");
    case "text":
      return createTextAdapter("text");
  }
}

export { createPdfAdapter } from "./pdf-adapter";
export { createTextAdapter } from "./text-adapter";
export { createEpubAdapter } from "./epub-adapter";
