import { pdfjs } from "react-pdf";
import type { DocumentAdapter, DocumentMeta, TocItem } from "@/types/document";

type PDFDocumentProxy = Awaited<
  ReturnType<typeof pdfjs.getDocument>["promise"]
>;

async function computeFileHash(file: File): Promise<string> {
  const chunk = file.slice(0, 65536);
  const buffer = await chunk.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function createPdfAdapter(): DocumentAdapter {
  let doc: PDFDocumentProxy | null = null;
  let objectUrl: string | null = null;

  return {
    async load(file: File): Promise<DocumentMeta> {
      objectUrl = URL.createObjectURL(file);
      const loadedDoc = await pdfjs.getDocument({
        url: objectUrl,
        cMapUrl: "/pdf-assets/cmaps/",
        cMapPacked: true,
      }).promise;
      doc = loadedDoc;

      const pdfMeta = await loadedDoc.getMetadata();
      const info = pdfMeta.info as Record<string, unknown>;
      const fileHash = await computeFileHash(file);

      return {
        id: fileHash,
        title: (info?.Title as string) || file.name.replace(/\.pdf$/i, ""),
        author: (info?.Author as string) || "Unknown",
        format: "pdf",
        totalPages: loadedDoc.numPages,
        fileUrl: objectUrl,
      };
    },

    async extractToc(): Promise<TocItem[]> {
      if (!doc) return [];
      const currentDoc = doc;

      const outline = await currentDoc.getOutline();
      if (!outline) return [];

      async function resolveItems(
        items: Awaited<ReturnType<PDFDocumentProxy["getOutline"]>>,
      ): Promise<TocItem[]> {
        if (!items) return [];

        const result: TocItem[] = [];
        for (const item of items) {
          let pageIndex = 0;
          if (item.dest) {
            try {
              const dest =
                typeof item.dest === "string"
                  ? await currentDoc.getDestination(item.dest)
                  : item.dest;
              if (dest) {
                const ref = dest[0];
                pageIndex = await currentDoc.getPageIndex(ref);
              }
            } catch {
              // fallback to page 0
            }
          }

          result.push({
            title: item.title,
            pageIndex,
            children: await resolveItems(item.items),
          });
        }
        return result;
      }

      return resolveItems(outline);
    },

    dispose() {
      if (doc) {
        doc.destroy();
        doc = null;
      }
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = null;
      }
    },
  };
}
