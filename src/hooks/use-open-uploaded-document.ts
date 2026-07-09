import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router";
import { supabase } from "@/lib/supabase";
import { createAdapterForFile } from "@/features/reader/adapters";
import { useReaderStore } from "@/stores/reader-store";
import { useUIStore } from "@/stores/ui-store";
import { registerFile } from "@/lib/file-store";
import { saveLastOpenedBook } from "@/lib/last-opened-book";
import { loadBookBlob, saveBookBlob } from "@/lib/offline-books";
import { logError } from "@/lib/logger";
import { showToast } from "@/stores/toast-store";
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
 *     cores), older phones / low-end laptops are skipped to avoid
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

  // Skip very large files, a 200MB blob shoved into RAM "for later"
  // is exactly the kind of "lag the device" risk we want to avoid.
  if (opts.sizeBytes && opts.sizeBytes > PREFETCH_MAX_BYTES) {
    return () => {};
  }

  const controller = new AbortController();
  let cancelled = false;

  const ric = typeof window !== "undefined" ? window.requestIdleCallback : undefined;
  const schedule = ric
    ? (cb: () => void) => ric(cb, { timeout: 2000 })
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
    if (typeof handle === "number") {
      window.cancelIdleCallback?.(handle);
    }
  };
}

export function useOpenUploadedDocument() {
  const navigate = useNavigate();
  const location = useLocation();
  // Capture wherever the user opened from so the reader's back arrow
  // can return there. Read at hook scope; the value snapshots into
  // the callback below via closure. Without this, the reader always
  // hard-navigates to /library on back, which is wrong when the user
  // opened from a book detail page.
  const openedFrom = location.pathname + location.search;

  const openUploadedBook = useCallback(
    async (entry: UploadedLibraryItem) => {
      const { setLoading } = useUIStore.getState();
      setLoading(true, "Downloading file...");

      try {
        const { storage_path, file_name } = entry.book;
        // Shell books (manual entries) have no file to open.
        if (!storage_path || !file_name) {
          throw new Error("This book has no file to open.");
        }

        // In-session cache → persistent offline store → network, so a book
        // opened before re-opens offline (the offline store survives restart).
        let blob = blobCache.get(storage_path);

        if (!blob) {
          const offline = await loadBookBlob(storage_path);
          if (offline) {
            blob = offline;
            blobCache.set(storage_path, blob);
          }
        }

        if (!blob) {
          const { data, error } = await supabase.storage
            .from("book-files")
            .download(storage_path);

          if (error || !data) {
            throw new Error(error?.message ?? "Failed to download file");
          }

          blob = data;
          blobCache.set(storage_path, blob);
          // persist for offline re-opening
          void saveBookBlob(storage_path, blob);
        }

        setLoading(true, "Loading document...");

        // Convert to File so the adapter pipeline can pick the right format.
        const file = new File([blob], file_name);

        const adapter = createAdapterForFile(file);
        setLoading(true, "Extracting table of contents...");
        const docId = await useReaderStore.getState().addDocument(adapter, file);

        registerFile(docId, file);
        saveLastOpenedBook({
          source: "uploaded",
          id: entry.id,
          title: entry.book.title,
        });
        navigate(`/reader/${docId}`, { state: { from: openedFrom } });
      } catch (error) {
        logError("openUploadedBook", error);
        showToast(
          "Couldn't open this document. Check your connection and try again.",
          "error",
        );
      } finally {
        setLoading(false);
      }
    },
    [navigate, openedFrom],
  );

  return { openUploadedBook };
}
