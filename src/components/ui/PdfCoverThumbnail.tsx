import { useMemo, useState, useEffect } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/cn";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf-assets/pdf.worker.min.mjs";

// Module-level cache for signed URLs (avoids re-fetching within the session)
const signedUrlCache = new Map<string, string>();

interface PdfCoverThumbnailProps {
  storagePath: string;
  className?: string;
  fallbackLetter?: string;
}

/**
 * Renders the first page of a stored PDF as a cover thumbnail. The
 * component always fills its parent (h-full w-full) so the parent
 * controls sizing — drop it inside an `aspect-[2/3]` container and
 * the thumbnail will sit flush at all card sizes. This is what fixes
 * the old mobile bug where a hard-coded `height` prop left the
 * cover stranded as a small block at the top of a tall card.
 */
export function PdfCoverThumbnail({
  storagePath,
  className,
  fallbackLetter = "?",
}: PdfCoverThumbnailProps) {
  const [url, setUrl] = useState<string | null>(
    signedUrlCache.get(storagePath) ?? null,
  );
  const [error, setError] = useState(false);

  useEffect(() => {
    if (url) return;

    let cancelled = false;

    (async () => {
      const { data, error: urlError } = await supabase.storage
        .from("book-files")
        .createSignedUrl(storagePath, 3600);

      if (cancelled) return;

      if (urlError || !data?.signedUrl) {
        setError(true);
        return;
      }

      signedUrlCache.set(storagePath, data.signedUrl);
      setUrl(data.signedUrl);
    })();

    return () => {
      cancelled = true;
    };
  }, [storagePath, url]);

  const documentOptions = useMemo(
    () => ({ cMapUrl: "/pdf-assets/cmaps/", cMapPacked: true }),
    [],
  );

  if (error || !url) {
    return (
      <div
        className={cn(
          "flex h-full w-full items-center justify-center bg-gradient-to-br from-accent-purple/30 to-accent-blue/30",
          className,
        )}
      >
        {error ? (
          <span className="text-4xl font-bold text-white/20">
            {fallbackLetter}
          </span>
        ) : (
          <div className="h-full w-full animate-pulse bg-glass-bg" />
        )}
      </div>
    );
  }

  return (
    <Document
      file={url}
      options={documentOptions}
      loading={
        <div
          className={cn(
            "h-full w-full animate-pulse bg-glass-bg",
            className,
          )}
        />
      }
      error={
        <div
          className={cn(
            "flex h-full w-full items-center justify-center bg-gradient-to-br from-accent-purple/30 to-accent-blue/30",
            className,
          )}
        >
          <span className="text-4xl font-bold text-white/20">
            {fallbackLetter}
          </span>
        </div>
      }
    >
      {/* The Page renders at a fixed pixel width so react-pdf can
          rasterize a sharp canvas; the wrapper then scales it down
          via [&_canvas]:h-full and object-cover so the canvas covers
          the whole parent (h-full w-full). 300px width is a balance
          between sharpness on retina and not blowing up the worker
          render time. */}
      <div className={cn("h-full w-full overflow-hidden", className)}>
        <Page
          pageNumber={1}
          width={300}
          renderTextLayer={false}
          renderAnnotationLayer={false}
          className="h-full w-full [&_canvas]:h-full [&_canvas]:w-full [&_canvas]:object-cover"
          loading={<div className="h-full w-full animate-pulse bg-glass-bg" />}
        />
      </div>
    </Document>
  );
}
