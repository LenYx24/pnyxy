import { useCallback } from "react";
import { useNavigate } from "react-router";
import { supabase } from "@/lib/supabase";
import { createAdapterForFile } from "@/features/reader/adapters";
import { useReaderStore } from "@/stores/reader-store";
import { useUIStore } from "@/stores/ui-store";
import { registerFile } from "@/lib/file-store";
import type { UploadedLibraryItem } from "@/types/catalog";

// Module-level cache: once downloaded, re-opening is instant within session
const blobCache = new Map<string, Blob>();
// Track in-flight prefetches so duplicate requests for the same file
// share a single download.
const prefetchInFlight = new Map<string, Promise<Blob | null>>();

const PREFETCH_MAX_BYTES = 50 * 1024 * 1024; // 50 MB

/**
 * Background-download a book's binary into the in-memory blob cache so
 * a later openUploadedBook() resolves instantly. Designed to be cheap:
 *
 *   - Runs only when the device is reasonably capable (>= 4 logical
 *     cores) — older phones / low-end laptops are skipped to avoid
 *     contention with the user's foreground work.
 *   - Cancellable via the returned cleanup function (typical use:
 *     useEffect → return cleanup → abort if user navigates away).
 *   - No-op when the blob is already cached or a fetch is in flight.
 *   - Safe to call multiple times for the same path; only one network
 *     request will actually go out.
 *
 * Returns a cleanup function the caller can invoke on unmount.
 */
export function prefetchBookBlob(
  storagePath: string,
  opts: { sizeBytes?: number | null } = {},
): () => void {
  if (!storagePath) return () => {};
  if (blobCache.has(storagePath) || prefetchInFlight.has(storagePath)) {
    return () => {};
  }

  // Skip prefetch on low-end devices (hardwareConcurrency is the most
  // widely-supported cheap signal). The book still opens normally on
  // click, just without the warmup.
  const cores =
    typeof navigator !== "undefined"
      ? (navigator.hardwareConcurrency ?? 4)
      : 4;
  if (cores < 4) return () => {};

  // Skip very large files — a 200MB blob shoved into RAM "for later"
  // is exactly the kind of "lag the device" risk we want to avoid.
  if (opts.sizeBytes && opts.sizeBytes > PREFETCH_MAX_BYTES) {
    return () => {};
  }

  const controller = new AbortController();
  let cancelled = false;

  const schedule =
    typeof window !== "undefined" && "requestIdleCallback" in window
      ? (cb: () => void) =>
          (window as unknown as { requestIdleCallback: (cb: () => void, opts: { timeout: number }) => number })
            .requestIdleCallback(cb, { timeout: 2000 })
      : (cb: () => void) => window.setTimeout(cb, 200);

  const handle = schedule(() => {
    if (cancelled) return;
    const promise = (async () => {
      try {
        const { data, error } = await supabase.storage
          .from("book-files")
          .download(storagePath);
        if (cancelled || controller.signal.aborted) return null;
        if (error || !data) return null;
        if (data.size > PREFETCH_MAX_BYTES) return null;
        blobCache.set(storagePath, data);
        return data;
      } catch {
        return null;
      } finally {
        prefetchInFlight.delete(storagePath);
      }
    })();
    prefetchInFlight.set(storagePath, promise);
  });

  return () => {
    cancelled = true;
    controller.abort();
    if (
      typeof window !== "undefined" &&
      "cancelIdleCallback" in window &&
      typeof handle === "number"
    ) {
      (
        window as unknown as { cancelIdleCallback: (id: number) => void }
      ).cancelIdleCallback(handle);
    }
  };
}

export function useOpenUploadedDocument() {
  const navigate = useNavigate();

  const openUploadedBook = useCallback(
    async (entry: UploadedLibraryItem) => {
      const { setLoading } = useUIStore.getState();
      setLoading(true, "Downloading file...");

      try {
        const { storage_path, file_name } = entry.book;

        // Check cache first
        let blob = blobCache.get(storage_path);

        if (!blob) {
          const { data, error } = await supabase.storage
            .from("book-files")
            .download(storage_path);

          if (error || !data) {
            throw new Error(error?.message ?? "Failed to download file");
          }

          blob = data;
          blobCache.set(storage_path, blob);
        }

        setLoading(true, "Loading document...");

        // Convert to File so the adapter pipeline can pick the right format.
        const file = new File([blob], file_name);

        const adapter = createAdapterForFile(file);
        setLoading(true, "Extracting table of contents...");
        const docId = await useReaderStore.getState().addDocument(adapter, file);

        registerFile(docId, file);
        navigate(`/reader/${docId}`);
      } finally {
        setLoading(false);
      }
    },
    [navigate],
  );

  return { openUploadedBook };
}
