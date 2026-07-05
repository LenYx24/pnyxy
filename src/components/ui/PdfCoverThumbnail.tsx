import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/cn";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf-assets/pdf.worker.min.mjs";

// Module-level cache for signed URLs (avoids re-fetching within the session)
const signedUrlCache = new Map<string, string>();
// Module-level cache of rasterized first-page covers, keyed by
// storagePath. Once rendered, subsequent mounts (e.g., navigating
// /home → /library → /home) reuse the data URL via a plain <img>
// instead of spinning up a new pdf.js worker render. Cleared only
// when the page reloads.
const coverDataUrlCache = new Map<string, string>();

interface PdfCoverThumbnailProps {
  /** Null for file-less "shell" books, renders the letter fallback. */
  storagePath: string | null;
  className?: string;
  fallbackLetter?: string;
}

/**
 * Renders the first page of a stored PDF as a cover thumbnail. The
 * component always fills its parent (h-full w-full) so the parent
 * controls sizing, drop it inside an `aspect-[5/7]` container and
 * the thumbnail will sit flush at all card sizes.
 *
 * Three rendering paths in order of preference:
 *   1. Cached data URL (instant), returned by every previous render.
 *   2. <img> with cached data URL when this component re-mounts.
 *   3. react-pdf <Document>/<Page> first-time render; on success we
 *      snapshot the canvas to a JPEG data URL and seed the cache.
 */
export function PdfCoverThumbnail({
  storagePath,
  className,
  fallbackLetter = "?",
}: PdfCoverThumbnailProps) {
  const [url, setUrl] = useState<string | null>(
    signedUrlCache.get(storagePath ?? "") ?? null,
  );
  const [error, setError] = useState(false);
  const [dataUrl, setDataUrl] = useState<string | null>(
    coverDataUrlCache.get(storagePath ?? "") ?? null,
  );
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!storagePath) return;
    if (url) return;
    if (coverDataUrlCache.has(storagePath)) return;

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

  // Snapshot the rasterized canvas to a JPEG data URL once react-pdf
  // finishes drawing page 1. JPEG keeps the cache compact (covers are
  // photographic-ish at this size) and avoids the alpha channel we
  // don't need. Failures are silently ignored, worst case, the next
  // mount re-renders via react-pdf as it does today.
  const handlePageRenderSuccess = useCallback(() => {
    if (!storagePath) return;
    if (coverDataUrlCache.has(storagePath)) return;
    const canvas = containerRef.current?.querySelector("canvas");
    if (!canvas) return;
    try {
      const url = canvas.toDataURL("image/jpeg", 0.85);
      if (url && url.length > "data:image/jpeg;base64,".length) {
        coverDataUrlCache.set(storagePath, url);
        setDataUrl(url);
      }
    } catch {
      // toDataURL can throw on tainted canvases, bail silently
    }
  }, [storagePath]);

  // Shell book with no uploaded file, there's no PDF to rasterize,
  // so render the letter fallback directly.
  if (!storagePath) {
    return (
      <div
        className={cn(
          "flex h-full w-full items-center justify-center bg-bg-tertiary",
          className,
        )}
      >
        <span className="text-4xl font-bold text-white/20">
          {fallbackLetter}
        </span>
      </div>
    );
  }

  // Fast path: a previous render already cached a data URL. Skip
  // react-pdf entirely and serve a plain <img>.
  if (dataUrl) {
    return (
      <div className={cn("h-full w-full overflow-hidden", className)}>
        <img
          src={dataUrl}
          alt=""
          aria-hidden="true"
          // See LibraryBookCard: native image drag would otherwise
          // swallow dnd-kit's pointer stream and break card dragging.
          draggable={false}
          className="h-full w-full object-cover object-top"
        />
      </div>
    );
  }

  if (error || !url) {
    return (
      <div
        className={cn(
          "flex h-full w-full items-center justify-center bg-bg-tertiary",
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
            "flex h-full w-full items-center justify-center bg-bg-tertiary",
            className,
          )}
        >
          <span className="text-4xl font-bold text-white/20">
            {fallbackLetter}
          </span>
        </div>
      }
    >
      {/* The Page renders at a fixed 300px raster width so react-pdf
          produces a sharp canvas; CSS (`.pnyxy-pdf-cover canvas`) then
          forces it to fully cover the aspect-[5/7] slot via
          object-fit: cover, object-position: top. We snapshot the
          rasterized canvas to a JPEG data URL on first render and
          cache by storagePath, so subsequent mounts skip pdf.js
          entirely (see the dataUrl fast path above). */}
      <div
        ref={containerRef}
        className={cn("pnyxy-pdf-cover h-full w-full overflow-hidden", className)}
      >
        <Page
          pageNumber={1}
          width={300}
          renderTextLayer={false}
          renderAnnotationLayer={false}
          className="h-full w-full"
          loading={<div className="h-full w-full animate-pulse bg-glass-bg" />}
          onRenderSuccess={handlePageRenderSuccess}
        />
      </div>
    </Document>
  );
}
