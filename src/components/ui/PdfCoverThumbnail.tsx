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
  height?: number;
}

export function PdfCoverThumbnail({
  storagePath,
  className,
  fallbackLetter = "?",
  height,
}: PdfCoverThumbnailProps) {
  const [url, setUrl] = useState<string | null>(
    signedUrlCache.get(storagePath) ?? null,
  );
  const [error, setError] = useState(false);

  const heightStyle = height ? { height } : undefined;
  const heightClass = height ? undefined : "h-48";

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
          "flex items-center justify-center bg-gradient-to-br from-accent-purple/30 to-accent-blue/30",
          heightClass,
          className,
        )}
        style={heightStyle}
      >
        {error ? (
          <span className="text-4xl font-bold text-white/20">
            {fallbackLetter}
          </span>
        ) : (
          <div
            className={cn("w-full animate-pulse bg-glass-bg", heightClass)}
            style={heightStyle}
          />
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
          className={cn("w-full animate-pulse bg-glass-bg", heightClass, className)}
          style={heightStyle}
        />
      }
      error={
        <div
          className={cn(
            "flex items-center justify-center bg-gradient-to-br from-accent-purple/30 to-accent-blue/30",
            heightClass,
            className,
          )}
          style={heightStyle}
        >
          <span className="text-4xl font-bold text-white/20">
            {fallbackLetter}
          </span>
        </div>
      }
    >
      <div
        className={cn(
          "w-full overflow-hidden",
          heightClass,
          className,
        )}
        style={heightStyle}
      >
        <Page
          pageNumber={1}
          width={300}
          renderTextLayer={false}
          renderAnnotationLayer={false}
          className="w-full [&_canvas]:w-full [&_canvas]:object-cover"
          loading={
            <div
              className={cn("w-full animate-pulse bg-glass-bg", heightClass)}
              style={heightStyle}
            />
          }
        />
      </div>
    </Document>
  );
}
