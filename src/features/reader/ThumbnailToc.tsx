import { useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { useReaderStore, useActiveDocument } from "@/stores/reader-store";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf-assets/pdf.worker.min.mjs";

const THUMB_WIDTH = 150;
// A4 ratio as the placeholder height — most book PDFs are close
// enough that the scroll geometry stays stable when the real page
// renders. Wrong-aspect pages will adjust on render; the surrounding
// layout doesn't depend on per-thumb height being exact.
const THUMB_PLACEHOLDER_HEIGHT = THUMB_WIDTH * 1.4142;

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
      loading={
        <div className="flex items-center justify-center py-16">
          <Loader2 size={24} className="animate-spin text-accent-purple" />
        </div>
      }
      error={null}
    >
      <div className="flex flex-col items-center gap-3 p-3">
        {Array.from({ length: totalPages }, (_, i) => {
          const pageNum = i + 1;
          return (
            <ThumbnailItem
              key={pageNum}
              pageNum={pageNum}
              isActive={currentPage === pageNum}
              onClick={() => goToPage(pageNum)}
            />
          );
        })}
      </div>
    </Document>
  );
}

/**
 * Lazy-mounted thumbnail. Renders a placeholder skeleton until the
 * row scrolls into (or near) the viewport, then mounts the real
 * `<Page>` and keeps it mounted for the rest of the session — so
 * scrolling back up or quickly jumping around the TOC doesn't pay
 * the render cost again.
 *
 * Without this, opening the TOC on a 500-page PDF used to fire 500
 * concurrent thumbnail renders the moment the panel mounted; on
 * mid-tier hardware that froze the worker for several seconds. Now
 * only ~10 thumbnails (rootMargin overscan + visible) render up
 * front; the rest fill in as the user scrolls.
 */
function ThumbnailItem({
  pageNum,
  isActive,
  onClick,
}: {
  pageNum: number;
  isActive: boolean;
  onClick: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  // Once mounted, stay mounted. Re-rendering an already-rendered
  // canvas is wasteful, and a TOC has finite vertical extent so
  // memory growth is bounded by total pages × ~30 KB / canvas.
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (mounted) return;
    const el = ref.current;
    if (!el) return;
    // 400px above/below the panel's viewport — gives the worker a
    // head start so thumbnails appear "ready" by the time the user
    // scrolls them into actual view, instead of flashing in.
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setMounted(true);
          observer.disconnect();
        }
      },
      { rootMargin: "400px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [mounted]);

  return (
    <button
      ref={ref}
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-1 rounded-lg p-1.5 transition-colors cursor-pointer",
        isActive
          ? "ring-2 ring-accent-purple bg-accent-purple/10"
          : "hover:bg-glass-hover",
      )}
    >
      {mounted ? (
        <Page
          pageNumber={pageNum}
          width={THUMB_WIDTH}
          renderTextLayer={false}
          renderAnnotationLayer={false}
          loading={
            <div
              className="bg-glass-bg rounded animate-pulse"
              style={{ width: THUMB_WIDTH, height: THUMB_PLACEHOLDER_HEIGHT }}
            />
          }
        />
      ) : (
        <div
          className="bg-glass-bg/50 rounded"
          style={{ width: THUMB_WIDTH, height: THUMB_PLACEHOLDER_HEIGHT }}
        />
      )}
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
}
