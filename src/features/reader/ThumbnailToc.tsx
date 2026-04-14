import { useMemo } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { cn } from "@/lib/cn";
import { useReaderStore, useActiveDocument } from "@/stores/reader-store";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf-assets/pdf.worker.min.mjs";

const THUMB_WIDTH = 150;

export function ThumbnailToc() {
  const activeDoc = useActiveDocument();
  const goToPage = useReaderStore((s) => s.goToPage);

  const meta = activeDoc?.meta ?? null;
  const totalPages = activeDoc?.totalPages ?? 0;
  const currentPage = activeDoc?.currentPage ?? 1;

  const documentOptions = useMemo(
    () => ({ cMapUrl: "/pdf-assets/cmaps/", cMapPacked: true }),
    [],
  );

  if (!meta) return null;

  return (
    <Document
      file={meta.fileUrl}
      options={documentOptions}
      loading={null}
      error={null}
    >
      <div className="flex flex-col items-center gap-3 p-3">
        {Array.from({ length: totalPages }, (_, i) => {
          const pageNum = i + 1;
          const isActive = currentPage === pageNum;

          return (
            <button
              key={pageNum}
              onClick={() => goToPage(pageNum)}
              className={cn(
                "flex flex-col items-center gap-1 rounded-lg p-1.5 transition-colors cursor-pointer",
                isActive
                  ? "ring-2 ring-accent-purple bg-accent-purple/10"
                  : "hover:bg-glass-hover",
              )}
            >
              <Page
                pageNumber={pageNum}
                width={THUMB_WIDTH}
                renderTextLayer={false}
                renderAnnotationLayer={false}
                loading={
                  <div
                    className="bg-glass-bg rounded animate-pulse"
                    style={{ width: THUMB_WIDTH, height: THUMB_WIDTH * 1.4142 }}
                  />
                }
              />
              <span
                className={cn(
                  "text-xs",
                  isActive ? "text-accent-purple font-medium" : "text-text-muted",
                )}
              >
                {pageNum}
              </span>
            </button>
          );
        })}
      </div>
    </Document>
  );
}
